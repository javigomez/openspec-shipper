import { noop, wait, type DeliveryPhaseDefinition } from "../phase.js";

export const waitingForMergePhase: DeliveryPhaseDefinition = {
  phase: "waiting_for_merge",
  preChecks() {
    return wait("waiting_for_merge", "waits for its PR to merge");
  },
  run() {
    return noop("waiting_for_merge", "waiting for external merge");
  },
  postChecks() {
    return wait("waiting_for_merge", "waits for its PR to merge");
  },
};
