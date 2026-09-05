# OpenSpec Shipper contributor instructions

## Product philosophy

OpenSpec Shipper is an unattended batch orchestrator. A complete queue may run
for hours while it implements, validates, publishes, and archives several
independent OpenSpec changes. Optimize for reliable forward progress without
unnecessary human intervention; do not optimize one worker invocation in a way
that makes the whole queue fragile.

Every model-driven implementation is governed by an explicit OpenSpec change.
`proposal.md`, `design.md`, delta specs, and `tasks.md` define the authorized
scope and acceptance criteria. The runner owns the delivery state machine and
Git/GitHub mechanics. Provider prompts and repository instructions constrain
the agent to the selected change and phase.

Git worktrees provide concurrency isolation, not a security boundary. Their
purpose is to let a human and several queued changes work in the same repository
without sharing a checkout. An implementation agent may need to read the whole
repository and must be able to write both its selected worktree and the parent
repository's shared Git metadata.

## Executor permissions are a deliberate reliability decision

Treat configured coding agents as trusted tools with the same repository and
host permissions they would have when a human launches them manually. In
particular, normal Codex CLI implementation MUST use `danger-full-access` with
non-interactive approval. Do not replace it with `workspace-write`, `--add-dir`,
or an equivalent filesystem sandbox: linked worktree commits write through the
parent repository's `.git/worktrees/*` administrative directories and have
repeatedly failed under narrower sandboxes.

The behavioral boundary remains strict even though the OS sandbox is not:

- Work only on the OpenSpec change selected by Shipper.
- Perform implementation in `worktrees/<change-name>`.
- Do not modify the human checkout or another change's worktree.
- Do not broaden the feature beyond its OpenSpec artifacts.
- Let the runner own push, PR, merge waiting, archive publication, and cleanup.
- Preserve and report blockers instead of improvising around missing specs or
  dependencies.

Do not introduce or tighten a provider sandbox as a routine security cleanup.
Any change to this permission model requires an explicit design proposal,
documentation of the reliability trade-off, and integration tests proving that
the agent can stage and commit from a linked worktree, update task artifacts,
run repository tooling, and complete a realistic delivery cycle unattended.

## Long-running queue reliability

The queue may legitimately run for hours; a single internal phase normally
should not. Keep per-invocation timeouts, streamed provider-error detection,
heartbeats, durable logs, no-progress detection, and phase cycle breakers.

A cycle breaker must distinguish repetition from progress. If an implementation
pass creates a commit, changes its worktree, or advances OpenSpec task state,
that is durable progress and it receives a fresh phase-cycle budget. Repeated
successful-looking calls with no observable progress should retry only within a
small bounded budget, use assisted recovery when appropriate, and then block
with an actionable diagnostic rather than consuming the full queue runtime.

Changing a task marker from `[!]` to `[ ]` is an explicit human retry after the
underlying problem was addressed. Reset the current phase's stale execution and
recovery counters so the corrected attempt is actually allowed to run; retain
history for unrelated phases.

## Change discipline

- Add or update tests before changing runner, queue, provider, timeout, recovery,
  or permission behavior.
- Prefer observable repository evidence over model claims when advancing a
  phase.
- Preserve useful partial progress and make retries resumable and idempotent.
- Never hide provider output that explains authentication, quota, permission,
  timeout, or transport failures.
- Run `bun test`, `npm run typecheck`, and `npm run build` before committing.
