import { execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const preparePhase: DeliveryPhaseDefinition = {
  phase: "prepare",
  preChecks(evidence) {
    if (evidence.hasLocalClaim) {
      return transition("apply", "local implementation workspace exists");
    }

    return ready("prepare");
  },
  run() {
    return execute("prepare");
  },
  postChecks() {
    return transition("apply", "workspace prepared");
  },
};
