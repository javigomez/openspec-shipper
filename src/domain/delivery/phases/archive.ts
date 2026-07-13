import { execute, ready, type DeliveryPhaseDefinition } from "../phase.js";

export const archivePhase: DeliveryPhaseDefinition = {
  phase: "archive",
  preChecks() {
    return ready("archive");
  },
  run() {
    return execute("archive");
  },
  postChecks() {
    return ready("archive");
  },
};
