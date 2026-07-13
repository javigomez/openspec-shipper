import { execute, ready, type DeliveryPhaseDefinition } from "../phase.js";

export const syncPhase: DeliveryPhaseDefinition = {
  phase: "sync",
  preChecks() {
    return ready("sync");
  },
  run() {
    return execute("sync");
  },
  postChecks() {
    return ready("archive");
  },
};
