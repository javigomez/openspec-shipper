# OpenSpec Shipper Codex Phase: cleanup_worktree

Run one OpenSpec Shipper `cleanup_worktree` phase for change `{{CHANGE_NAME}}`
in repository `{{PROJECT_DIR}}`.

Read and follow `.openspec-shipper/codex/workflow.md` and `AGENTS.md`. Prefer
direct shell inspection and concise status updates.

## Blocker Contract

If you cannot complete this phase, include exactly one final line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use it for dirty worktrees, unsafe branch deletion, missing tools, unexpected
Git failures, or anything requiring human action. Do not include it after
success.

## Boundaries

Only clean local OpenSpec Shipper artifacts after the change is archived. Do
not run `openspec archive`, edit OpenSpec specs, commit, push, create PRs,
delete remote branches, or force-delete local branches.

## Cleanup Rules

From repository root:

1. Verify current checkout is `main`.
2. Verify main has no non-runtime dirty changes.
3. Verify `openspec/changes/archive/*-{{CHANGE_NAME}}/` exists. If not, block
   because cleanup is not safe before archive.
4. If `worktrees/{{CHANGE_NAME}}` exists, inspect its current branch before
   removal and verify `git -C worktrees/{{CHANGE_NAME}} status --short` is
   clean.
5. Remove a clean worktree with:

```bash
git worktree remove worktrees/{{CHANGE_NAME}}
```

6. Detect the local implementation branch. Prefer the branch read from the
   worktree before removing it. If there is no worktree, look for a local branch
   ending in `/{{CHANGE_NAME}}`.
7. Delete the local branch with `git branch -d`. If it refuses, block and report
   the exact reason. Never use `git branch -D`.
8. Missing worktree and missing local branch are successful no-ops.

Exit successfully when cleanup is complete or nothing remains to clean.
