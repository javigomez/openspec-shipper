import { execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const prepareWorktreePhase: DeliveryPhaseDefinition = {
  phase: "prepare_worktree",
  preChecks(evidence) {
    if (evidence.hasLocalClaim) {
      return transition("implement", "local implementation workspace exists");
    }

    return ready("prepare_worktree");
  },
  run() {
    return execute("prepare_worktree");
  },
  postChecks() {
    return transition("implement", "workspace prepared");
  },
};
