import { execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const refreshBranchPhase: DeliveryPhaseDefinition = {
  phase: "refresh_branch",
  preChecks(evidence) {
    if (!evidence.hasLocalClaim) {
      return transition("prepare_worktree", "no delivery worktree exists");
    }

    if (!evidence.tasksComplete) {
      return transition("implement", "implementation tasks are not complete");
    }

    return evidence.refreshRequired === false
      ? transition("push", "delivery branch already satisfies the refresh policy")
      : ready("refresh_branch");
  },
  run() {
    return execute("refresh_branch");
  },
  postChecks() {
    return transition("push", "delivery branch refreshed");
  },
};
