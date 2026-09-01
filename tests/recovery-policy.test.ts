import { describe, expect, test } from "bun:test";
import {
  recoveryDecision,
  recoveryFailureFingerprint,
  type DeliveryFailure,
} from "../src/domain/recovery/recovery";

const recoverableFailure: DeliveryFailure = {
  source: "worker",
  kind: "worker_blocker",
  phase: "implement",
  reason: "tests fail after the generated adapter changed",
  safeWorkspaceAvailable: true,
};

describe("assisted recovery policy", () => {
  test("attempts one assisted recovery for an actionable worker blocker", () => {
    expect(recoveryDecision(recoverableFailure, { enabled: true, maxAttemptsPerPhase: 1 }, 0)).toEqual({
      kind: "attempt_recovery",
    });
  });

  test("blocks terminal provider and human-gate failures without spending tokens", () => {
    for (const failure of [
      { ...recoverableFailure, source: "provider" as const, kind: "provider_unavailable" as const },
      { ...recoverableFailure, source: "provider" as const, kind: "authentication" as const },
      { ...recoverableFailure, source: "provider" as const, kind: "permission" as const },
      { ...recoverableFailure, source: "reconcile" as const, kind: "human_gate" as const },
      { ...recoverableFailure, source: "preflight" as const, kind: "configuration" as const },
      { ...recoverableFailure, source: "preflight" as const, kind: "missing_workspace" as const },
      { ...recoverableFailure, source: "worker" as const, kind: "unknown" as const },
    ]) {
      expect(recoveryDecision(failure, { enabled: true, maxAttemptsPerPhase: 1 }, 0).kind).toBe("block_immediately");
    }
  });

  test("requires a safe workspace and respects disabled or exhausted recovery", () => {
    expect(recoveryDecision(
      { ...recoverableFailure, safeWorkspaceAvailable: false },
      { enabled: true, maxAttemptsPerPhase: 1 },
      0,
    ).kind).toBe("block_immediately");
    expect(recoveryDecision(recoverableFailure, { enabled: false, maxAttemptsPerPhase: 1 }, 0).kind).toBe("block_immediately");
    expect(recoveryDecision(recoverableFailure, { enabled: true, maxAttemptsPerPhase: 1 }, 1).kind).toBe("block_immediately");
  });

  test("allows native, dependency, postcondition and exhausted no-progress failures", () => {
    for (const failure of [
      { ...recoverableFailure, source: "native" as const, kind: "native_operation" as const },
      { ...recoverableFailure, source: "postcondition" as const, kind: "postcondition" as const },
      { ...recoverableFailure, source: "postcondition" as const, kind: "no_progress" as const },
      { ...recoverableFailure, source: "native" as const, kind: "dependency_reconciliation" as const },
    ]) {
      expect(recoveryDecision(failure, { enabled: true, maxAttemptsPerPhase: 1 }, 0)).toEqual({
        kind: "attempt_recovery",
      });
    }
  });

  test("creates stable fingerprints without persisting raw diagnostic text", () => {
    const first = recoveryFailureFingerprint(recoverableFailure);
    const same = recoveryFailureFingerprint({ ...recoverableFailure, reason: "  TESTS   fail after the generated adapter changed " });
    const otherPhase = recoveryFailureFingerprint({ ...recoverableFailure, phase: "archive" });

    expect(first).toBe(same);
    expect(first).toHaveLength(12);
    expect(otherPhase).not.toBe(first);
    expect(first).not.toContain("tests");
  });
});
