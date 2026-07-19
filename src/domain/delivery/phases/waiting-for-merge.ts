import { blocked, noop, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const waitingForMergePhase: DeliveryPhaseDefinition = {
  phase: "waiting_for_merge",
  preChecks(evidence) {
    if (evidence.hasMergedPullRequest) {
      return transition("archive", "pull request is merged");
    }

    return blocked("waiting_for_merge", "waits for its PR to merge");
  },
  run() {
    return noop("waiting_for_merge", "waiting for external merge");
  },
  postChecks(evidence) {
    if (evidence.hasMergedPullRequest) {
      return transition("archive", "pull request is merged");
    }

    return blocked("waiting_for_merge", "waits for its PR to merge");
  },
};
