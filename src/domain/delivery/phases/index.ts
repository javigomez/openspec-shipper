import { archivePhase } from "./archive.js";
import { cleanupPhase } from "./cleanup.js";
import { applyPhase } from "./apply.js";
import { preparePhase } from "./prepare.js";
import { shipPhase } from "./ship.js";
import { syncPhase } from "./sync.js";
import { waitingForMergePhase } from "./waiting-for-merge.js";
import { waitingForPrPhase } from "./waiting-for-pr.js";
import type { DeliveryPhaseDefinition } from "../phase.js";
import type { DeliverPhase } from "../../queue/queue.js";

export const deliveryPhases: Record<DeliverPhase, DeliveryPhaseDefinition> = {
  prepare: preparePhase,
  apply: applyPhase,
  ship: shipPhase,
  waiting_for_pr: waitingForPrPhase,
  waiting_for_merge: waitingForMergePhase,
  sync: syncPhase,
  archive: archivePhase,
  cleanup: cleanupPhase,
};

export function phaseDefinition(phase: DeliverPhase): DeliveryPhaseDefinition {
  return deliveryPhases[phase];
}
