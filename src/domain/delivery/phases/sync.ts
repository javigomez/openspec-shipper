import { execute, ready, type DeliveryPhaseDefinition } from "../phase.js";

export const syncPhase: DeliveryPhaseDefinition = {
  phase: "sync_main",
  preChecks() {
    return ready("sync_main");
  },
  run() {
    return execute("sync_main");
  },
  postChecks() {
    return ready("archive");
  },
};
