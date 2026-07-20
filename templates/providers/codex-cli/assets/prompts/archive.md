# OpenSpec Shipper Codex Phase: archive

Run one OpenSpec `archive` phase for change `{{CHANGE_NAME}}` in repository
`{{PROJECT_DIR}}`.

Read and follow `.openspec-shipper/codex/workflow.md`, `AGENTS.md`, and the
OpenSpec artifacts for this change. Prefer direct shell inspection and concise
status updates.

## Blocker Contract

If you cannot complete this phase, include exactly one final line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use it for missing tools, failed checks, dirty state, ineligible changes, unsafe
git state, failed archive reconciliation, or anything requiring human action. Do not
include it after success.

## Boundaries

Archive runs only from the detached integration worktree prepared by Shipper
from `origin/<baseBranch>`. Do not run from a delivery worktree or the human
checkout. Do not create PRs or clean local worktrees or branches.
Do not run `git pull`, `git fetch`, `git rebase`, `git commit`, or `git push`.
The runner owns Git synchronization, staging, commit, CAS/PR publication, and
retry for this phase.

Set `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1` for every OpenSpec CLI invocation.

## Archive Rules

From the current integration worktree:

1. Verify HEAD is detached; this is expected for the integration workspace.
2. Verify `git status --short` is clean.
3. Inspect only `openspec/changes/{{CHANGE_NAME}}`.

If `openspec/changes/{{CHANGE_NAME}}/` is missing, check whether it is already
archived:

```bash
find openspec/changes/archive -maxdepth 1 -type d -name "*-{{CHANGE_NAME}}" -print 2>/dev/null
```

If exactly one valid archived directory exists, treat archive as already
complete and exit successfully. Do not emit the blocker line.

For an active change:

1. Verify proposal, tasks, and at least one `specs/**/spec.md` exist. Read and
   preserve `design.md` when present, but do not require it.
2. Verify every task checkbox is complete in this integration snapshot.
3. Run the configured OpenSpec validation command from
   `.openspec-shipper/config.json` (`checks.openspec`). The default npm profile
   expands to `npm run openspec:cli -- validate {{CHANGE_NAME}}`.
4. Run `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec archive {{CHANGE_NAME}} -y`
   or the configured OpenSpec command.
5. Verify the diff only touches OpenSpec change/archive and canonical spec
   files.
6. Leave the diff for the runner. Do not stage, commit, rebase, or push.

If archive reconciliation fails, report the exact command and output and include
the blocker line.
