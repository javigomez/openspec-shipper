import { noop, transition, wait, type DeliveryPhaseDefinition } from "../phase.js";

export const waitingForArchiveMergePhase: DeliveryPhaseDefinition = {
  phase: "waiting_for_archive_merge",
  preChecks(evidence) {
    return evidence.hasMergedArchivePullRequest || evidence.archivePublished
      ? transition("cleanup_worktree", "archive pull request is merged")
      : wait("waiting_for_archive_merge", "waits for its archive pull request to merge");
  },
  run() {
    return noop("waiting_for_archive_merge", "waiting for external archive merge");
  },
  postChecks(evidence) {
    return evidence.hasMergedArchivePullRequest || evidence.archivePublished
      ? transition("cleanup_worktree", "archive pull request is merged")
      : wait("waiting_for_archive_merge", "waits for its archive pull request to merge");
  },
};
