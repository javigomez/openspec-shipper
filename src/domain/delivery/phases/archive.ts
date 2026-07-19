import { execute, ready, transition, wait, type DeliveryPhaseDefinition } from "../phase.js";

export const archivePhase: DeliveryPhaseDefinition = {
  phase: "archive",
  preChecks(evidence) {
    if (evidence.archiveOrderReady === false) {
      return wait("archive", "waits for archive dependencies");
    }
    return ready("archive");
  },
  run() {
    return execute("archive");
  },
  postChecks() {
    return transition("publish_archive", "archive workspace is ready to publish");
  },
};
