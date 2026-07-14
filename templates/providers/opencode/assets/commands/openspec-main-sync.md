---
description: Reconcile the root main checkout with origin/main
agent: openspec-main-sync-worker
---

Run one OpenSpec main-sync worker cycle for this repository right now.

Manual command: `/openspec-main-sync`

Treat this command as the OpenCode entrypoint for an orchestrator `sync_main` queue
task.

Goals:

- Verify the root checkout is clean and on `main`.
- Inspect divergence between local `main` and `origin/main`.
- Fast-forward, push, or rebase/push according to the project workflow.
- Stop and report clearly if blocked.

Important:

- Follow the specialized `openspec-main-sync-worker` agent instructions.
- If blocked, end with exactly one
  `OPENSPEC_SHIPPER_BLOCKED: <short reason>` line.
- Do not edit product code.
- Do not edit OpenSpec files.
- Do not create worktrees, commits unrelated to main sync, pull requests, or
  archives in this command.
