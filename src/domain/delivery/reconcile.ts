import { deliverPhase, type DeliverPhase, type QueueTask } from "../queue/queue.js";
import { phaseDefinition } from "./phases/index.js";
import type { DeliveryEvidence, PhaseDecision } from "./phase.js";

export type DeliveryReconcileDecision =
  | { kind: "unchanged"; phase: DeliverPhase; decision: PhaseDecision }
  | { kind: "transition"; phase: DeliverPhase; reason: string; decision: PhaseDecision }
  | { kind: "done"; phase: DeliverPhase; reason: string }
  | { kind: "blocked"; phase: DeliverPhase; reason: string; decision: PhaseDecision };

export function reconcileDeliveryTask(task: QueueTask, evidence: DeliveryEvidence): DeliveryReconcileDecision {
  const declaredPhase = deliverPhase(task);
  const inferred = inferDeliveryState(evidence);

  if (inferred.kind === "done") {
    return inferred;
  }

  if (inferred.kind === "transition" && inferred.phase !== declaredPhase) {
    return inferred;
  }

  if (inferred.kind === "blocked") {
    return {
      kind: "blocked",
      phase: inferred.phase,
      reason: inferred.reason,
      decision: {
        kind: "blocked",
        phase: inferred.phase,
        reason: inferred.reason,
      },
    };
  }

  const decision = phaseDefinition(declaredPhase).preChecks(evidence);

  if (decision.kind === "transition") {
    return {
      kind: "transition",
      phase: decision.phase,
      reason: decision.reason,
      decision,
    };
  }

  if (decision.kind === "blocked") {
    return {
      kind: "blocked",
      phase: decision.phase,
      reason: decision.reason,
      decision,
    };
  }

  return {
    kind: "unchanged",
    phase: decision.phase,
    decision,
  };
}

type DeliveryStateInference =
  | { kind: "done"; phase: DeliverPhase; reason: string }
  | { kind: "transition"; phase: DeliverPhase; reason: string; decision: PhaseDecision }
  | { kind: "blocked"; phase: DeliverPhase; reason: string }
  | { kind: "unchanged" };

function inferDeliveryState(evidence: DeliveryEvidence): DeliveryStateInference {
  if (evidence.hasArchivedChange && evidence.cleanupComplete) {
    return { kind: "done", phase: "cleanup_worktree", reason: "change is archived and local cleanup is complete" };
  }

  if (evidence.hasArchivedChange) {
    return transitionInference("cleanup_worktree", "change is already archived");
  }

  if (evidence.hasMergedArchivePullRequest || evidence.archivePublished) {
    return transitionInference("cleanup_worktree", "archive is published");
  }

  if (evidence.hasOpenArchivePullRequest) {
    return transitionInference("waiting_for_archive_merge", "archive pull request is open");
  }

  if (evidence.hasLocalClaim && !evidence.worktreeDependenciesReady && phasePrecedesOrMatches(evidence.declaredPhase, "implement")) {
    return transitionInference("prepare_worktree", "implementation workspace dependencies are not installed");
  }

  if (evidence.hasLocalClaim && !evidence.tasksComplete) {
    return transitionInference("implement", "local implementation workspace exists but tasks are not complete");
  }

  if (evidence.hasLocalClaim && evidence.tasksComplete && !evidence.localClaimPublished) {
    return transitionInference("refresh_branch", "local implementation is complete but not published");
  }

  if (evidence.hasMergedPullRequest && phasePrecedes(evidence.declaredPhase, "archive")) {
    return transitionInference("archive", "pull request is merged");
  }

  if (evidence.hasOpenPullRequest && evidence.refreshRequired && phasePrecedesOrMatches(evidence.declaredPhase, "waiting_for_merge")) {
    return transitionInference("refresh_branch", "open pull request needs its delivery branch refreshed");
  }

  if (evidence.hasOpenPullRequest && phasePrecedes(evidence.declaredPhase, "waiting_for_merge")) {
    return transitionInference("waiting_for_merge", "open pull request exists");
  }

  if (evidence.hasRemoteBranch && phasePrecedes(evidence.declaredPhase, "waiting_for_merge")) {
    return transitionInference("push", "remote implementation branch exists without an open pull request");
  }

  if (evidence.hasActiveChange && !evidence.hasLocalClaim && phasePrecedesOrMatches(evidence.declaredPhase, "implement")) {
    return transitionInference("prepare_worktree", "a committed OpenSpec planning source exists without a delivery workspace");
  }

  if (evidence.hasActiveChange || evidence.hasLocalClaim) {
    return { kind: "unchanged" };
  }

  return phasePrecedesOrMatches(evidence.declaredPhase, "implement")
    ? {
        kind: "blocked",
        phase: evidence.declaredPhase,
        reason: `OpenSpec change ${evidence.changeName} was not found in active changes, archive, local worktrees, local branches, remote branches, or pull requests`,
      }
    : { kind: "unchanged" };
}

function transitionInference(phase: DeliverPhase, reason: string): DeliveryStateInference {
  return {
    kind: "transition",
    phase,
    reason,
    decision: {
      kind: "transition",
      phase,
      reason,
    },
  };
}

function phasePrecedes(left: DeliverPhase, right: DeliverPhase): boolean {
  return phaseRank(left) < phaseRank(right);
}

function phasePrecedesOrMatches(left: DeliverPhase, right: DeliverPhase): boolean {
  return phaseRank(left) <= phaseRank(right);
}

function phaseRank(phase: DeliverPhase): number {
  switch (phase) {
    case "implement":
      return 1;
    case "prepare_worktree":
      return 0;
    case "refresh_branch":
      return 2;
    case "push":
      return 3;
    case "waiting_for_merge":
      return 4;
    case "archive":
      return 5;
    case "publish_archive":
      return 6;
    case "waiting_for_archive_merge":
      return 7;
    case "cleanup_worktree":
      return 8;
  }
}
