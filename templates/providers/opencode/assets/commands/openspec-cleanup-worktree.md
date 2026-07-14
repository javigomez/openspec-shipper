---
description: Clean local OpenSpec Shipper worktree and branch after archive
agent: openspec-cleanup-worker
---

Run one OpenSpec Shipper cleanup_worktree worker cycle for this repository right now.

Manual command: `/openspec-cleanup-worktree`

Arguments: `$ARGUMENTS`

Treat this command as the OpenCode entrypoint for an orchestrator `cleanup_worktree`
queue task.

Goals:

- Run only from the root `main` checkout.
- Verify the target change has already been archived.
- Remove the clean local implementation worktree when it exists.
- Delete the merged local implementation branch with `git branch -d` when safe.
- Stop and report clearly if blocked.

Important:

- A target change argument is required.
- Do not run `openspec archive`.
- Do not commit, push, create pull requests, or delete remote branches.
- Do not force-delete local branches.
- Follow the specialized `openspec-cleanup-worker` agent instructions.
- If blocked, end with exactly one
  `OPENSPEC_SHIPPER_BLOCKED: <short reason>` line.
