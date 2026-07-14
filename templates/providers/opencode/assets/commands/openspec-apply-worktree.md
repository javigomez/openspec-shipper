---
description: Apply one prepared OpenSpec change in its deterministic worktree
agent: openspec-apply-worker
---

Run the OpenSpec apply worker for this repository right now.

Manual command: `/openspec-apply-worktree`

Arguments: `$ARGUMENTS`

Treat this command as the OpenCode entrypoint for an orchestrator `implement` queue
task.

Goals:

- Discover the requested OpenSpec change from the root `main` checkout.
- Continue exactly one prepared change in its deterministic worktree.
- Implement scoped progress, validate appropriately, and commit useful progress.
- Stop and report clearly if blocked.

Important:

- If arguments identify a target change, such as
  `openspec/changes/<change-name>` or `<change-name>`, process only that change.
  If that exact change is not eligible, stop and report the blocker instead of
  selecting another change.
- Follow the specialized `openspec-apply-worker` agent instructions.
- If blocked, end with exactly one
  `OPENSPEC_SHIPPER_BLOCKED: <short reason>` line.
- Do not create PRs or archive changes in this command.
- Do not create branches or worktrees in this command; the shipper runner's
  native `prepare_worktree` phase owns that setup.
