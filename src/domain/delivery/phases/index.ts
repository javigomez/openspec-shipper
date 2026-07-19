import { archivePhase } from "./archive.js";
import { cleanupWorktreePhase } from "./cleanup-worktree.js";
import { implementPhase } from "./implement.js";
import { prepareWorktreePhase } from "./prepare-worktree.js";
import { pushPhase } from "./push.js";
import { publishArchivePhase } from "./publish-archive.js";
import { refreshBranchPhase } from "./refresh-branch.js";
import { waitingForArchiveMergePhase } from "./waiting-for-archive-merge.js";
import { waitingForMergePhase } from "./waiting-for-merge.js";
import type { DeliveryPhaseDefinition } from "../phase.js";
import type { DeliverPhase } from "../../queue/queue.js";

export const deliveryPhases: Record<DeliverPhase, DeliveryPhaseDefinition> = {
  prepare_worktree: prepareWorktreePhase,
  implement: implementPhase,
  refresh_branch: refreshBranchPhase,
  push: pushPhase,
  waiting_for_merge: waitingForMergePhase,
  archive: archivePhase,
  publish_archive: publishArchivePhase,
  waiting_for_archive_merge: waitingForArchiveMergePhase,
  cleanup_worktree: cleanupWorktreePhase,
};

export function phaseDefinition(phase: DeliverPhase): DeliveryPhaseDefinition {
  return deliveryPhases[phase];
}
