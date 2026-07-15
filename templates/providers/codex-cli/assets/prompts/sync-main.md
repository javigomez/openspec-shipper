# OpenSpec Shipper Codex Phase: sync_main

Run one OpenSpec `sync_main` phase in repository `{{PROJECT_DIR}}`.

Read and follow `.openspec-shipper/codex/workflow.md` and `AGENTS.md`. This is a
Git maintenance phase. Prefer direct shell inspection and concise status
updates.

## Blocker Contract

If you cannot complete this phase, include exactly one final line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use it for missing tools, failed Git commands, dirty state, unsafe git state, or
anything requiring human action. Do not include it after success.

## Boundaries

Do not edit product code, edit OpenSpec files, run `openspec archive`, create
worktrees, create feature commits, create PRs, or delete branches.

## Main Sync Rules

From repository root:

1. Verify the current checkout is on `main`.
2. Verify `git status --short` is clean except ignored shipper runtime state.
3. Verify repo-local `git config user.name` and `git config user.email`.
4. Run:

```bash
git fetch origin main
git log --oneline origin/main..main
git log --oneline main..origin/main
```

Then apply exactly one case:

- Neither side has commits: report that `main` is already synchronized.
- Remote-only commits exist: run `git pull --ff-only`.
- Local-only commits exist: run `git push origin main`.
- Both sides have commits: run `git rebase origin/main`, verify the checkout is
  clean, then push.

If rebase conflicts, stop, report conflicted files, and include the blocker
line. Do not create merge commits on `main`.
