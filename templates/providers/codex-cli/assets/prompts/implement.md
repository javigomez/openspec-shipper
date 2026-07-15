# OpenSpec Shipper Codex Phase: implement

Run one OpenSpec `implement` phase for change `{{CHANGE_NAME}}` in repository
`{{PROJECT_DIR}}`.

Read and follow `.openspec-shipper/codex/workflow.md`, `AGENTS.md`, and the
OpenSpec artifacts for this change. Prefer direct shell inspection and concise
status updates.

## Blocker Contract

If you cannot complete this phase, include exactly one final line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use it for missing tools, missing permissions, failed checks, dirty state,
missing worktrees, unsafe git state, or anything requiring human action. Do not
include it after success.

## Discovery

Use `.openspec-shipper/config.json` for configured project commands. Use
`checks.openspec` for OpenSpec CLI invocations; the default npm profile expands
to `npm run openspec:cli --`.

Run from repository root:

```bash
pwd
git branch --show-current
git status --short
test -f openspec/changes/{{CHANGE_NAME}}/proposal.md
test -f openspec/changes/{{CHANGE_NAME}}/design.md
test -f openspec/changes/{{CHANGE_NAME}}/tasks.md
find openspec/changes/{{CHANGE_NAME}}/specs -name spec.md -print
OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 <configured openspec command> validate {{CHANGE_NAME}}
test -d worktrees/{{CHANGE_NAME}}
test -f worktrees/{{CHANGE_NAME}}/openspec/changes/{{CHANGE_NAME}}/tasks.md
```

If root `main` is dirty, do not edit it. Continue only inside the already
prepared `worktrees/{{CHANGE_NAME}}` checkout. If that worktree is missing,
stop with:

```text
OPENSPEC_SHIPPER_BLOCKED: prepared worktree missing for {{CHANGE_NAME}}
```

## Implementation Rules

Inside `worktrees/{{CHANGE_NAME}}`:

1. Run `git status --short`.
2. Read proposal, design, delta specs, and tasks.
3. Implement the next small unchecked task.
4. Mark a task complete only after the work and relevant validation are done.
5. Run the narrowest useful checks from this worktree.
6. Run scoped formatting on changed files when the repo provides a formatter.
7. Commit useful progress with a Conventional Commit.

Do not create PRs. Do not archive changes. Do not create branches or worktrees.
Leave incomplete tasks unchecked when blocked.
