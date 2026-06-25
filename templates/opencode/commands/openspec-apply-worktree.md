---
description: Claim or continue one ready OpenSpec change in its deterministic worktree
agent: openspec-apply-worker
---

Run the OpenSpec apply worker for this repository right now.

Manual command: `/openspec-apply-worktree`

Arguments: `$ARGUMENTS`

Treat this command as the OpenCode entrypoint for an orchestrator `apply` queue
task.

Goals:

- Discover the ready OpenSpec apply queue from the root `main` checkout.
- Claim or continue exactly one eligible change in its deterministic worktree.
- Implement scoped progress, validate appropriately, and commit useful progress.
- Stop and report clearly if blocked.

Important:

- If arguments identify a target change, such as
  `openspec/changes/<change-name>` or `<change-name>`, process only that change.
  If that exact change is not eligible, stop and report the blocker instead of
  selecting another change.
- Follow the specialized `openspec-apply-worker` agent instructions.
- Do not create PRs or archive changes in this command.
- Do not create more than one new worktree claim in a single run.
