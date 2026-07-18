# OpenSpec Shipper Claude Phase: archive

Run one OpenSpec `archive` phase for change `{{CHANGE_NAME}}` in repository
`{{PROJECT_DIR}}`.

Read and follow `.openspec-shipper/claude/workflow.md`, `CLAUDE.md`, `AGENTS.md`,
and the OpenSpec artifacts for this change.

## Blocker Contract

If you cannot complete this phase, return structured status `blocked` with an
actionable reason and include exactly one final textual line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use it for missing tools, failed checks, dirty state, ineligible changes, unsafe
Git state, failed archive reconciliation, or anything requiring human action.

## Boundaries

Archive runs only from the root base-branch checkout. Do not run from a change
worktree. Do not create or update PRs. Do not clean worktrees or branches. Do
not run `git pull`, `git fetch`, `git rebase`, `git commit`, or `git push`.
Shipper owns synchronization, staging, commit, rebase, and push.

Set `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1` for every OpenSpec invocation.

## Archive Rules

From repository root:

1. Verify the current checkout is the configured base branch.
2. Verify `git status --short` is clean except ignored Shipper runtime state.
3. Inspect only `openspec/changes/{{CHANGE_NAME}}`.

If the active change is missing, check whether it is already archived:

```bash
find openspec/changes/archive -maxdepth 1 -type d -name "*-{{CHANGE_NAME}}" -print 2>/dev/null
```

If exactly one valid archive exists, return `completed` without changing files.

For an active change:

1. Verify proposal, design, tasks, and at least one `specs/**/spec.md` exist.
2. Verify every task checkbox is complete on the base branch.
3. Run the configured OpenSpec validation command from
   `.openspec-shipper/config.json` (`checks.openspec`).
4. Run the configured equivalent of
   `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec archive {{CHANGE_NAME}} -y`.
5. Verify the diff only touches OpenSpec change/archive and canonical spec files.
6. Leave the diff for the runner. Do not stage, commit, rebase, or push.

If archive reconciliation fails, report the exact command and output and return
`blocked`.
