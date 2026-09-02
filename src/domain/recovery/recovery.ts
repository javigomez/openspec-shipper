import { createHash } from "node:crypto";
import type { DeliverPhase } from "../queue/queue.js";

export type DeliveryFailureSource = "worker" | "provider" | "native" | "postcondition" | "preflight" | "reconcile";

export type DeliveryFailureKind =
  | "worker_blocker"
  | "native_operation"
  | "postcondition"
  | "no_progress"
  | "dependency_reconciliation"
  | "provider_unavailable"
  | "authentication"
  | "permission"
  | "configuration"
  | "human_gate"
  | "missing_workspace"
  | "unknown";

export type DeliveryFailure = {
  source: DeliveryFailureSource;
  kind: DeliveryFailureKind;
  phase: DeliverPhase;
  reason: string;
  safeWorkspaceAvailable: boolean;
  exitCode?: number | null;
};

export type RecoveryPolicy = {
  enabled: boolean;
  maxAttemptsPerPhase: number;
};

export type RecoveryDecision =
  | { kind: "attempt_recovery" }
  | { kind: "block_immediately"; reason: string };

const RECOVERABLE_FAILURES = new Set<DeliveryFailureKind>([
  "worker_blocker",
  "native_operation",
  "postcondition",
  "no_progress",
  "dependency_reconciliation",
  "missing_workspace",
  "unknown",
]);

export function recoveryDecision(
  failure: DeliveryFailure,
  policy: RecoveryPolicy,
  attemptsForPhase: number,
): RecoveryDecision {
  if (!policy.enabled) {
    return { kind: "block_immediately", reason: "assisted recovery is disabled" };
  }
  if (!failure.safeWorkspaceAvailable) {
    return { kind: "block_immediately", reason: "no safe recovery workspace is available" };
  }
  if (!RECOVERABLE_FAILURES.has(failure.kind)) {
    return { kind: "block_immediately", reason: `${failure.kind} failures are not eligible for assisted recovery` };
  }
  if (attemptsForPhase >= policy.maxAttemptsPerPhase) {
    return { kind: "block_immediately", reason: "assisted recovery attempts are exhausted for this phase" };
  }
  return { kind: "attempt_recovery" };
}

export function recoveryFailureFingerprint(failure: DeliveryFailure): string {
  const normalizedReason = failure.reason.trim().replace(/\s+/g, " ").toLowerCase();
  return createHash("sha256")
    .update([failure.phase, failure.source, failure.kind, normalizedReason].join("\0"))
    .digest("hex")
    .slice(0, 12);
}
