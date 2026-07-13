import type { DeliverPhase } from "../queue/queue.js";

export type DeliveryEvidence = {
  changeName: string;
  declaredPhase: DeliverPhase;
  hasLocalClaim: boolean;
  hasRemoteBranch: boolean;
  hasOpenPullRequest: boolean;
  tasksComplete: boolean;
};

export type PhaseDecision =
  | { kind: "ready"; phase: DeliverPhase }
  | { kind: "transition"; phase: DeliverPhase; reason: string }
  | { kind: "wait"; phase: DeliverPhase; reason: string }
  | { kind: "blocked"; phase: DeliverPhase; reason: string };

export type PhaseRunDecision =
  | { kind: "execute"; phase: DeliverPhase }
  | { kind: "noop"; phase: DeliverPhase; reason: string };

export type DeliveryPhaseDefinition = {
  phase: DeliverPhase;
  preChecks(evidence: DeliveryEvidence): PhaseDecision;
  run(evidence: DeliveryEvidence): PhaseRunDecision;
  postChecks(evidence: DeliveryEvidence): PhaseDecision;
};

export function ready(phase: DeliverPhase): PhaseDecision {
  return { kind: "ready", phase };
}

export function transition(phase: DeliverPhase, reason: string): PhaseDecision {
  return { kind: "transition", phase, reason };
}

export function wait(phase: DeliverPhase, reason: string): PhaseDecision {
  return { kind: "wait", phase, reason };
}

export function blocked(phase: DeliverPhase, reason: string): PhaseDecision {
  return { kind: "blocked", phase, reason };
}

export function execute(phase: DeliverPhase): PhaseRunDecision {
  return { kind: "execute", phase };
}

export function noop(phase: DeliverPhase, reason: string): PhaseRunDecision {
  return { kind: "noop", phase, reason };
}
