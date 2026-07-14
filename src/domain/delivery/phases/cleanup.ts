import { execute, ready, type DeliveryPhaseDefinition } from "../phase.js";

export const cleanupPhase: DeliveryPhaseDefinition = {
  phase: "cleanup_worktree",
  preChecks() {
    return ready("cleanup_worktree");
  },
  run() {
    return execute("cleanup_worktree");
  },
  postChecks() {
    return ready("cleanup_worktree");
  },
};
