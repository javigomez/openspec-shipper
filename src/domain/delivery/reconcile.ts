import { deliverPhase, type DeliverPhase, type QueueTask } from "../queue/queue.js";
import { phaseDefinition } from "./phases/index.js";
import type { DeliveryEvidence, PhaseDecision } from "./phase.js";

export type DeliveryReconcileDecision =
  | { kind: "unchanged"; phase: DeliverPhase; decision: PhaseDecision }
  | { kind: "transition"; phase: DeliverPhase; reason: string; decision: PhaseDecision }
  | { kind: "blocked"; phase: DeliverPhase; reason: string; decision: PhaseDecision };

export function reconcileDeliveryTask(task: QueueTask, evidence: DeliveryEvidence): DeliveryReconcileDecision {
  const declaredPhase = deliverPhase(task);
  const decision = phaseDefinition(declaredPhase).preChecks(evidence);

  if (decision.kind === "transition") {
    return {
      kind: "transition",
      phase: decision.phase,
      reason: decision.reason,
      decision,
    };
  }

  if (decision.kind === "blocked") {
    return {
      kind: "blocked",
      phase: decision.phase,
      reason: decision.reason,
      decision,
    };
  }

  return {
    kind: "unchanged",
    phase: decision.phase,
    decision,
  };
}
