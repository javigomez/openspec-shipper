---
description: Validate and push one completed OpenSpec worktree branch
agent: openspec-ship-worker
---

Run one OpenSpec push worker cycle for this repository right now.

Manual command: `/openspec-ship-worktree`

Arguments: `$ARGUMENTS`

Treat this command as the OpenCode entrypoint for an orchestrator `push` queue
task.

Goals:

- Discover completed OpenSpec implementation worktrees.
- Select exactly one push-ready completed change.
- Validate the selected worktree, commit any final verification updates, and
  push its deterministic branch.
- Let the target repo's branch-push workflow create or reuse the pull request
  after push, when configured.
- Stop and report clearly if blocked.

Important:

- If arguments identify a target change, such as
  `openspec/changes/<change-name>` or `<change-name>`, process only that change.
  If that exact change is not eligible, stop and report the blocker instead of
  selecting another change.
- Follow the specialized `openspec-ship-worker` agent instructions.
- If blocked, end with exactly one
  `OPENSPEC_SHIPPER_BLOCKED: <short reason>` line.
- Do not archive changes in this command.
- Do not create pull requests manually in this command.
- Do not process more than one completed worktree in a single run.
