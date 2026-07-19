import { blocked, execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const pushPhase: DeliveryPhaseDefinition = {
  phase: "push",
  preChecks(evidence) {
    if (!evidence.hasLocalClaim) {
      return transition("prepare_worktree", "no local implementation branch or worktree exists");
    }

    if (!evidence.tasksComplete) {
      return blocked("push", "implementation tasks are not complete");
    }

    if (!evidence.localClaimPublished) {
      return ready("push");
    }

    if (evidence.hasMergedPullRequest) {
      return transition("archive", "pull request is merged");
    }

    if (evidence.hasOpenPullRequest) {
      return transition("waiting_for_merge", "open pull request exists");
    }

    if (evidence.hasRemoteBranch) {
      return ready("push");
    }

    return ready("push");
  },
  run() {
    return execute("push");
  },
  postChecks(evidence) {
    if (evidence.hasMergedPullRequest) {
      return transition("archive", "pull request is merged");
    }

    return evidence.hasOpenPullRequest
      ? transition("waiting_for_merge", "open pull request exists")
      : blocked("push", "push phase completed but no pull request exists");
  },
};
