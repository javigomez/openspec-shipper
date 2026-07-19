import { execute, ready, transition, type DeliveryPhaseDefinition } from "../phase.js";

export const publishArchivePhase: DeliveryPhaseDefinition = {
  phase: "publish_archive",
  preChecks(evidence) {
    if (evidence.archivePublished || evidence.hasMergedArchivePullRequest) {
      return transition("cleanup_worktree", "archive is published on the base branch");
    }

    if (evidence.hasOpenArchivePullRequest) {
      return transition("waiting_for_archive_merge", "archive pull request is open");
    }

    return ready("publish_archive");
  },
  run() {
    return execute("publish_archive");
  },
  postChecks(evidence) {
    return evidence.hasOpenArchivePullRequest
      ? transition("waiting_for_archive_merge", "archive pull request is open")
      : transition("cleanup_worktree", "archive published");
  },
};
