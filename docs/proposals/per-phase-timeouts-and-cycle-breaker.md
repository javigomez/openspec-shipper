# Proposal: per-phase timeouts, idle detection and bounded recovery

## Status

Proposed. This document records the qg-13 incident and a staged plan; it does
not change the runner yet.

## Incident evidence

On 2026-09-04, `qg-13-plan-verse-semantic-anchors` entered `archive` with a
valid OpenCode model (`glm-5.3-flash`). The executor produced no output for
90 minutes. Shipper timed out the task and started assisted recovery, which
also produced no executor output for more than 25 minutes. During both
periods the queue lock and `running` metadata made the queue appear alive,
while every other task waited behind this single phase.

The implementation worktree passed its complete test suite (404 passing, 4
skipped) and the OpenSpec change was archivable. The blocker was therefore not
product code: it was an unresponsive model/executor invocation in the archive
phase. Manual `openspec archive` completed in under a second once the stuck
runner was stopped.

## Problem

`taskTimeoutMs` is a queue-wide safety net, but it is too coarse for internal
operations. A phase can consume 90 minutes even when it has made no progress,
and assisted recovery can repeat the same unbounded wait. A phase that is
reconciled as runnable after each retry can therefore monopolize the queue.

## Proposed policy

1. Add explicit time budgets per phase and role. Defaults should be short for
   deterministic phases (`prepare_worktree`, `refresh_branch`, `push`,
   `archive`, `publish_archive`, `cleanup_worktree`) and configurable for the
   model phases (`implement`, `implement_requested_changes`, `code_review`).
   The global timeout remains an upper bound, never the normal phase budget.
2. Add an idle/no-progress timeout. Reset it only on executor output, a
   verified commit/tree change, a task checkbox change, or a successful native
   checkpoint. `still running` heartbeat messages must not reset it.
3. Apply the same (or smaller) budget to assisted recovery. Recovery must not
   receive a fresh 90-minute allowance after the primary phase times out.
4. Persist `phase_started_at`, `last_progress_at`, `phase_deadline`,
   `progress_fingerprint`, and `attempt_id` in the run log and queue metadata.
   On restart, calculate remaining budget from persisted timestamps rather
   than starting a new clock.
5. Strengthen the cycle breaker. Before invoking a phase, compare the
   reconciled evidence fingerprint (head SHA, task digest, worktree state,
   PR/archive evidence) with the previous attempt. If unchanged, stop after
   one retry and block immediately; do not spend another full phase budget.
   A changed fingerprint gets at most one bounded retry per phase, followed by
   assisted recovery with its own smaller budget.
6. Classify timeout, idle timeout, unchanged fingerprint and provider failure
   separately in `queue.md`, with a direct next action. Preserve the full log
   and the last executor operation.
7. Make `queue status` and `queue dry-run` report the active phase's elapsed,
   idle and remaining budgets, plus whether the next attempt would be a cycle.

## Suggested defaults

These are starting values to validate with tests and real workloads:

| Phase | Active budget | Idle budget | Recovery budget |
| --- | ---: | ---: | ---: |
| prepare/refresh/push/archive/publish/cleanup | 10 min | 2 min | 2 min |
| implement | 30 min | 5 min | 5 min |
| requested changes/review | 20 min | 4 min | 4 min |

The values must be configuration, not constants. A single queue run may still
exceed 90 minutes because it contains many tasks; no individual phase should
silently inherit that duration.

## Implementation increments

### 1. Runtime and configuration

- Introduce `phaseTimeouts` and `phaseIdleTimeouts` with validation and
  backwards-compatible fallback to the current global timeout.
- Wrap every phase invocation and recovery invocation with one cancellable
  timer and an abort reason.
- Ensure child executor processes are terminated on both active and idle
  timeout, and that the lock is released in a `finally` path.

### 2. Evidence and reconciliation

- Define a stable progress fingerprint and append structured checkpoint events.
- Persist deadlines before starting work; reconcile interrupted attempts using
  the persisted deadline and fingerprint.
- Add explicit `timeout`, `idle_timeout`, `unchanged_phase` and
  `recovery_timeout` metadata and badges.

### 3. Tests and fault injection

- Fake executors that emit heartbeats without progress must hit idle timeout.
- A phase that times out must not receive a fresh full budget in recovery.
- Re-running with an unchanged fingerprint must block before invoking the
  executor again (or after the configured single retry).
- A changed commit/task digest must permit exactly the configured retry.
- Verify queue-level execution can exceed the phase budget while each phase is
  independently bounded.
- Verify stop, restart and stale-lock reconciliation remain safe.

### 4. Operational UX

- Show a one-line budget summary every checkpoint and in `queue status`.
- Include the last operation and the reason for termination in the blocked
  message.
- Add a documented `queue stop --force` recovery path and never instruct users
  to delete a lock blindly.

## Acceptance criteria

- No internal phase can run longer than its configured active deadline.
- No phase with no observable progress can run longer than its idle deadline.
- A timeout/recovery pair cannot consume two full phase budgets.
- Repeated execution with unchanged repository evidence is blocked before an
  infinite loop, while legitimate progress remains retryable.
- Existing queues and configurations continue to reconcile without manual
  metadata edits.
