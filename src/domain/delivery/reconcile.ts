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

  if (evidence.hasMergedPullRequest) {
    return transitionInference("sync_main", "pull request is merged");
  }

  if (evidence.hasOpenPullRequest) {
    return transitionInference("waiting_for_merge", "open pull request exists");
  }

  if (evidence.hasRemoteBranch) {
    return transitionInference("waiting_for_pr", "remote implementation branch exists");
  }

  if (evidence.hasLocalClaim && evidence.tasksComplete && phasePrecedes(evidence.declaredPhase, "push")) {
    return transitionInference("push", "local implementation is complete");
  }

  if (evidence.hasActiveChange && !evidence.hasLocalClaim && phasePrecedesOrMatches(evidence.declaredPhase, "implement")) {
    return transitionInference("prepare_worktree", "active OpenSpec change exists without a prepared workspace");
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
    case "push":
      return 2;
    case "waiting_for_pr":
      return 3;
    case "waiting_for_merge":
      return 4;
    case "sync_main":
      return 5;
    case "archive":
      return 6;
    case "cleanup_worktree":
      return 7;
  }
}
