# OpenSpec Shipper Codex Phase: push

Run one OpenSpec `push` phase for change `{{CHANGE_NAME}}` in repository
`{{PROJECT_DIR}}`.

Read and follow `.openspec-shipper/codex/workflow.md`, `AGENTS.md`, and the
selected worktree state. Prefer direct shell inspection and concise status
updates.

## Blocker Contract

If you cannot complete this phase, include exactly one final line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use it for missing tools, missing permissions, failed checks, ineligible
changes, unsafe git state, or anything requiring human action. Do not include it
after success.

## Discovery

Run from repository root:

```bash
pwd
git branch --show-current
git status --short
git worktree list
test -d worktrees/{{CHANGE_NAME}}
test -f worktrees/{{CHANGE_NAME}}/openspec/changes/{{CHANGE_NAME}}/tasks.md
```

Inspect only `worktrees/{{CHANGE_NAME}}`. Do not select another change.

## Push Rules

For `worktrees/{{CHANGE_NAME}}`:

1. Verify all checkboxes in
   `worktrees/{{CHANGE_NAME}}/openspec/changes/{{CHANGE_NAME}}/tasks.md` are
   complete. If not, block with the unchecked task.
2. Verify proposal, design, tasks, and at least one `specs/**/spec.md` exist.
3. Run the configured OpenSpec validation command from
   `.openspec-shipper/config.json` (`checks.openspec`) from the worktree. The
   default npm profile expands to `npm run openspec:cli -- validate
   {{CHANGE_NAME}}`.
4. Run applicable checks configured in `.openspec-shipper/config.json`.
5. Commit final verification changes if needed. Do not create empty commits.
6. Validate commit messages when the repo provides commitlint.
7. Inspect `.openspec-shipper/config.json`; if `"enablePush": false`, block.
8. Verify repo-local `git config user.name` and `git config user.email`.
9. Push the current implementation branch to origin.
10. If `gh` is available, you may report whether an open PR already exists for
    the branch. If none exists yet, that is not a blocker: the branch-push
    workflow owns PR creation and the queue will move to `waiting_for_pr`.

Do not call `gh pr create` or any other PR creation API.

Do not archive or clean local worktrees.
