import { blocked, execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const shipPhase: DeliveryPhaseDefinition = {
  phase: "ship",
  preChecks(evidence) {
    if (evidence.hasMergedPullRequest) {
      return transition("sync", "pull request is merged");
    }

    if (evidence.hasOpenPullRequest) {
      return transition("waiting_for_merge", "open pull request exists");
    }

    if (evidence.hasRemoteBranch) {
      return transition("waiting_for_pr", "remote implementation branch exists");
    }

    if (!evidence.hasLocalClaim) {
      return transition("apply", "no local implementation branch or worktree exists");
    }

    if (!evidence.tasksComplete) {
      return blocked("ship", "implementation tasks are not complete");
    }

    return ready("ship");
  },
  run() {
    return execute("ship");
  },
  postChecks(evidence) {
    if (evidence.hasMergedPullRequest) {
      return transition("sync", "pull request is merged");
    }

    return evidence.hasOpenPullRequest
      ? transition("waiting_for_merge", "open pull request exists")
      : transition("waiting_for_pr", "ship pushed branch and PR creation is external");
  },
};
