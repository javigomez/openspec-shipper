import { execute, ready, type DeliveryPhaseDefinition } from "../phase.js";

export const cleanupPhase: DeliveryPhaseDefinition = {
  phase: "cleanup",
  preChecks() {
    return ready("cleanup");
  },
  run() {
    return execute("cleanup");
  },
  postChecks() {
    return ready("cleanup");
  },
};
