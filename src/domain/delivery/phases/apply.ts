import { execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const applyPhase: DeliveryPhaseDefinition = {
  phase: "apply",
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

    if (evidence.hasLocalClaim && evidence.tasksComplete) {
      return transition("ship", "local implementation is complete");
    }

    return ready("apply");
  },
  run() {
    return execute("apply");
  },
  postChecks() {
    return transition("ship", "apply completed");
  },
};
