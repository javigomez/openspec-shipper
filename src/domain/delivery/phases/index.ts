import { archivePhase } from "./archive.js";
import { cleanupWorktreePhase } from "./cleanup-worktree.js";
import { implementPhase } from "./implement.js";
import { prepareWorktreePhase } from "./prepare-worktree.js";
import { pushPhase } from "./push.js";
import { syncMainPhase } from "./sync-main.js";
import { waitingForMergePhase } from "./waiting-for-merge.js";
import { waitingForPrPhase } from "./waiting-for-pr.js";
import type { DeliveryPhaseDefinition } from "../phase.js";
import type { DeliverPhase } from "../../queue/queue.js";

export const deliveryPhases: Record<DeliverPhase, DeliveryPhaseDefinition> = {
  prepare_worktree: prepareWorktreePhase,
  implement: implementPhase,
  push: pushPhase,
  waiting_for_pr: waitingForPrPhase,
  waiting_for_merge: waitingForMergePhase,
  sync_main: syncMainPhase,
  archive: archivePhase,
  cleanup_worktree: cleanupWorktreePhase,
};

export function phaseDefinition(phase: DeliverPhase): DeliveryPhaseDefinition {
  return deliveryPhases[phase];
}
