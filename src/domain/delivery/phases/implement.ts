import { execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const implementPhase: DeliveryPhaseDefinition = {
  phase: "implement",
  preChecks(evidence) {
    if (!evidence.hasLocalClaim) {
      return transition("prepare_worktree", "no local implementation branch or worktree exists");
    }

    if (!evidence.tasksComplete) {
      return ready("implement");
    }

    if (!evidence.localClaimPublished) {
      return transition("push", "local implementation is complete but not published");
    }

    if (evidence.hasMergedPullRequest) {
      return transition("sync_main", "pull request is merged");
    }

    if (evidence.hasOpenPullRequest) {
      return transition("waiting_for_merge", "open pull request exists");
    }

    if (evidence.hasRemoteBranch) {
      return transition("waiting_for_pr", "remote implementation branch exists");
    }

    return transition("push", "local implementation is complete");
  },
  run() {
    return execute("implement");
  },
  postChecks() {
    return transition("push", "implementation completed");
  },
};
