---
description: Archive one merged completed OpenSpec change from main
agent: openspec-archive-worker
---

Run one OpenSpec archive worker cycle for this repository right now.

Manual command: `/openspec-archive-merged`

Arguments: `$ARGUMENTS`

Treat this command as the OpenCode entrypoint for an orchestrator `archive`
queue task.

Goals:

- Run only from the root `main` checkout.
- Select exactly one merged completed OpenSpec change.
- Validate and archive that change.
- Commit and push the archive/spec-sync result on `main`.
- Stop and report clearly if blocked.

Important:

- If arguments identify a target change, such as
  `openspec/changes/<change-name>` or `<change-name>`, process only that change.
  If that exact change is not eligible, stop and report the blocker instead of
  selecting another change.
- Follow the specialized `openspec-archive-worker` agent instructions.
- If blocked, end with exactly one
  `OPENSPEC_SHIPPER_BLOCKED: <short reason>` line.
- Do not create or update pull requests in this command.
- Do not run from a change worktree.
- Do not archive more than one change in a single run.
