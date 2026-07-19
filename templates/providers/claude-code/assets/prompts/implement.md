# OpenSpec Shipper Claude Phase: implement

Run one OpenSpec `implement` phase for change `{{CHANGE_NAME}}` in repository
`{{PROJECT_DIR}}`.

Read and follow `.openspec-shipper/claude/workflow.md`, `CLAUDE.md`, `AGENTS.md`,
and the OpenSpec artifacts for this change. Prefer direct inspection and concise
status updates.

## Blocker Contract

If you cannot complete this phase, return structured status `blocked` with an
actionable reason and include exactly one final textual line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use it for missing tools, missing permissions, failed checks, dirty state,
missing worktrees, unsafe Git state, or anything requiring human action. Do not
include it after success.

## Discovery

Use `.openspec-shipper/config.json` for project commands. Use `checks.openspec`
for OpenSpec CLI invocations; the default npm profile expands to
`npm run openspec:cli --`. The native `prepare_worktree` phase installs the
initial dependencies using `checks.install` before this phase starts.

Locate the prepared worktree from the repository root, then run all discovery
and implementation inside it:

```bash
pwd
cd worktrees/{{CHANGE_NAME}}
git branch --show-current
git status --short
test -f openspec/changes/{{CHANGE_NAME}}/proposal.md
test -f openspec/changes/{{CHANGE_NAME}}/design.md
test -f openspec/changes/{{CHANGE_NAME}}/tasks.md
find openspec/changes/{{CHANGE_NAME}}/specs -name spec.md -print
OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 <configured openspec command> validate {{CHANGE_NAME}}
```

The human checkout may be dirty or on any branch. Never edit, switch, stash,
reset, clean, or commit it. If the prepared worktree is missing, return
`blocked`.

## Implementation Rules

Inside `worktrees/{{CHANGE_NAME}}`:

1. Run `git status --short`.
2. Read proposal, design, delta specs, and tasks.
3. Implement the next small unchecked task.
4. Mark a task complete only after its work and relevant validation are done.
   Keep task items as markdown checkboxes. OpenSpec Shipper accepts `- [ ]`,
   `* [ ]`, `+ [ ]`, or numbered `1. [ ]` checkboxes, but completed work must
   be marked with `[x]`. Do not convert task checkboxes to plain bullets or
   plain numbered lists.
5. Run the narrowest useful checks from this worktree.
6. Run scoped formatting when the repository provides a formatter.
7. Commit useful progress with a Conventional Commit.

Do not install dependencies yourself. If you modify a dependency manifest or
lockfile, commit the implementable progress, leave checks that require the new
dependencies unchecked, and return `completed`. The native runner will execute
`checks.updateDependencies` outside this sandbox and schedule another
`implement` pass to finish validation.

Do not create PRs. Do not archive changes. Do not create branches or worktrees.
Leave incomplete tasks unchecked when blocked.
