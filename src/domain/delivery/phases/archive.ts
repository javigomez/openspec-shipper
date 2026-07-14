import { execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const archivePhase: DeliveryPhaseDefinition = {
  phase: "archive",
  preChecks() {
    return ready("archive");
  },
  run() {
    return execute("archive");
  },
  postChecks() {
    return transition("cleanup_worktree", "archive completed");
  },
};
