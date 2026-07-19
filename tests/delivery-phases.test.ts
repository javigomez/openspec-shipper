import { describe, expect, test } from "bun:test";
import type { DeliveryEvidence } from "../src/domain/delivery/phase";
import { phaseDefinition } from "../src/domain/delivery/phases";

const evidence: DeliveryEvidence = {
  changeName: "add-name-greeting",
  declaredPhase: "prepare_worktree",
  hasActiveChange: true,
  hasArchivedChange: false,
  cleanupComplete: false,
  hasLocalClaim: false,
  worktreeDependenciesReady: true,
  localClaimPublished: false,
  hasRemoteBranch: false,
  hasOpenPullRequest: false,
  hasMergedPullRequest: false,
  tasksComplete: false,
};

describe("delivery phase definitions", () => {
  test("prepare transitions to implementation when a workspace already exists", () => {
    const phase = phaseDefinition("prepare_worktree");

    expect(phase.preChecks(evidence)).toEqual({ kind: "ready", phase: "prepare_worktree" });
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true })).toEqual({
      kind: "transition",
      phase: "implement",
      reason: "local implementation workspace exists",
    });
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true, worktreeDependenciesReady: false })).toEqual({
      kind: "ready",
      phase: "prepare_worktree",
    });
    expect(phase.run(evidence)).toEqual({ kind: "execute", phase: "prepare_worktree" });
    expect(phase.postChecks(evidence)).toEqual({ kind: "transition", phase: "implement", reason: "workspace prepared" });
  });

  test("implement infers every forward transition from repository evidence", () => {
    const phase = phaseDefinition("implement");

    expect(phase.preChecks(evidence).phase).toBe("prepare_worktree");
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true })).toEqual({ kind: "ready", phase: "implement" });
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true, tasksComplete: true }).phase).toBe("refresh_branch");
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true, tasksComplete: true, localClaimPublished: true, hasRemoteBranch: true }).phase).toBe("push");
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true, tasksComplete: true, localClaimPublished: true, hasOpenPullRequest: true }).phase).toBe("waiting_for_merge");
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true, tasksComplete: true, localClaimPublished: true, hasMergedPullRequest: true }).phase).toBe("archive");
    expect(phase.run(evidence)).toEqual({ kind: "execute", phase: "implement" });
    expect(phase.postChecks(evidence).phase).toBe("refresh_branch");
  });

  test("push blocks incomplete work and advances only from PR evidence", () => {
    const phase = phaseDefinition("push");

    expect(phase.preChecks(evidence).phase).toBe("prepare_worktree");
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true })).toEqual({
      kind: "blocked",
      phase: "push",
      reason: "implementation tasks are not complete",
    });
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true, tasksComplete: true })).toEqual({ kind: "ready", phase: "push" });
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true, tasksComplete: true, localClaimPublished: true, hasOpenPullRequest: true }).phase).toBe("waiting_for_merge");
    expect(phase.preChecks({ ...evidence, hasLocalClaim: true, tasksComplete: true, localClaimPublished: true, hasMergedPullRequest: true }).phase).toBe("archive");
    expect(phase.run(evidence)).toEqual({ kind: "execute", phase: "push" });
    expect(phase.postChecks(evidence)).toEqual({ kind: "blocked", phase: "push", reason: "push phase completed but no pull request exists" });
    expect(phase.postChecks({ ...evidence, hasOpenPullRequest: true }).phase).toBe("waiting_for_merge");
    expect(phase.postChecks({ ...evidence, hasMergedPullRequest: true }).phase).toBe("archive");
  });

  test("waiting for merge remains blocked until GitHub reports the merge", () => {
    const phase = phaseDefinition("waiting_for_merge");

    expect(phase.preChecks(evidence).kind).toBe("blocked");
    expect(phase.run(evidence)).toEqual({ kind: "noop", phase: "waiting_for_merge", reason: "waiting for external merge" });
    expect(phase.postChecks(evidence).kind).toBe("blocked");
    expect(phase.preChecks({ ...evidence, hasMergedPullRequest: true }).phase).toBe("archive");
    expect(phase.postChecks({ ...evidence, hasMergedPullRequest: true }).phase).toBe("archive");
  });

  test("native completion phases expose their expected transitions", () => {
    const refresh = phaseDefinition("refresh_branch");
    const archive = phaseDefinition("archive");
    const publishArchive = phaseDefinition("publish_archive");
    const cleanup = phaseDefinition("cleanup_worktree");

    expect(refresh.preChecks({ ...evidence, hasLocalClaim: true, tasksComplete: true, refreshRequired: true })).toEqual({ kind: "ready", phase: "refresh_branch" });
    expect(refresh.run(evidence)).toEqual({ kind: "execute", phase: "refresh_branch" });
    expect(refresh.postChecks(evidence)).toEqual({ kind: "transition", phase: "push", reason: "delivery branch refreshed" });
    expect(archive.preChecks(evidence)).toEqual({ kind: "ready", phase: "archive" });
    expect(archive.run(evidence)).toEqual({ kind: "execute", phase: "archive" });
    expect(archive.postChecks(evidence).phase).toBe("publish_archive");
    expect(publishArchive.preChecks(evidence)).toEqual({ kind: "ready", phase: "publish_archive" });
    expect(publishArchive.run(evidence)).toEqual({ kind: "execute", phase: "publish_archive" });
    expect(cleanup.preChecks(evidence)).toEqual({ kind: "ready", phase: "cleanup_worktree" });
    expect(cleanup.run(evidence)).toEqual({ kind: "execute", phase: "cleanup_worktree" });
    expect(cleanup.postChecks(evidence)).toEqual({ kind: "ready", phase: "cleanup_worktree" });
  });
});
