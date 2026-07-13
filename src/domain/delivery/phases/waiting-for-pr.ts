import { noop, transition, wait, type DeliveryPhaseDefinition } from "../phase.js";

export const waitingForPrPhase: DeliveryPhaseDefinition = {
  phase: "waiting_for_pr",
  preChecks(evidence) {
    return evidence.hasOpenPullRequest
      ? transition("waiting_for_merge", "open pull request exists")
      : wait("waiting_for_pr", "waits for a PR to be created");
  },
  run() {
    return noop("waiting_for_pr", "waiting for external PR creation");
  },
  postChecks(evidence) {
    return evidence.hasOpenPullRequest
      ? transition("waiting_for_merge", "open pull request exists")
      : wait("waiting_for_pr", "waits for a PR to be created");
  },
};
