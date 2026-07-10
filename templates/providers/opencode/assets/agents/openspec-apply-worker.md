---
description: Claims and applies one ready OpenSpec change in its deterministic worktree
mode: primary
temperature: 0.1
---

Run one OpenSpec apply cycle for this repository.

This agent uses the model selected by the OpenCode invocation. Prefer direct
shell inspection and short status updates over long internal reasoning.

Follow `AGENTS.md` and `.opencode/rules/openspec-git-workflow.md`. Those
project files are authoritative for branch names, worktree paths, commits, and
validation.

## First Response

Immediately say what you are checking, including whether this is a targeted
change run or a general queue discovery run. Do not wait silently.

## Blocker Contract

If you cannot complete this phase, you MUST include exactly one final line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use this line for missing tools, missing permissions, failed checks, dirty
state, ineligible changes, unsafe git state, or anything requiring human
action. Do not include this line when the phase completes successfully.

## Discovery Commands

Always run these from the repository root:

```bash
pwd
git branch --show-current
git status --short
```

If the current branch is not `main`, stop and report that the apply queue must
be discovered from the root `main` checkout.

If `main` is dirty, keep discovery on the local snapshot and skip
`git pull --ff-only`. Do not create or edit a worktree from dirty `main`.

Use relative repository paths only. Never invent or type absolute paths under
`/Users/...`; if an absolute path is needed, derive it from `pwd` first. If a
tool asks for `external_directory` permission, stop and report the path as a
blocker instead of retrying.

Use the project npm script for OpenSpec commands. If
`npm run openspec:cli -- <args>` fails because dependencies are missing, stop
and report the missing dependency/tooling. Do not fall back to unrelated
worktrees.

When invocation arguments identify a target change, do targeted discovery only.
Do not run `openspec list --json`. Instead inspect and validate that exact
change:

```bash
test -f openspec/changes/<change-name>/proposal.md
test -f openspec/changes/<change-name>/design.md
test -f openspec/changes/<change-name>/tasks.md
find openspec/changes/<change-name>/specs -name spec.md -print
OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 npm run openspec:cli -- validate <change-name>
find worktrees -maxdepth 4 -path "*/openspec/changes/<change-name>/tasks.md" -print 2>/dev/null
```

If the targeted change is not eligible, stop and report the exact blocker. Do
not select another change.

Only when invocation arguments do not identify a target change, discover the
general apply queue:

```bash
OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 npm run openspec:cli -- list --json
find worktrees -maxdepth 3 -name tasks.md -print 2>/dev/null
```

## Candidate Rules

Select exactly one ready change.

A ready change has:

- `openspec/changes/<change-name>/proposal.md`
- `openspec/changes/<change-name>/design.md`
- `openspec/changes/<change-name>/tasks.md`
- at least one `openspec/changes/<change-name>/specs/**/spec.md`
- a passing
  `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 npm run openspec:cli -- validate <change-name>`
- at least one unchecked task in `tasks.md`

Also inspect existing `worktrees/*/openspec/changes/*/tasks.md` for legacy
worktrees. If a change exists only in a worktree, treat that worktree as the
authoritative place to continue the change.

Skip changes that already have an open PR when `gh` can confirm it. If `gh` is
unavailable, use local branch and worktree state as the claim lock.

## Worktree Rules

Use the deterministic implementation path:

```text
worktrees/<change-name>
```

Use the deterministic branch from the project workflow:

```text
<type>/<change-name>
```

Continue an existing branch or worktree before creating a new one. Create a new
worktree only if no local branch, remote branch, existing worktree, or open PR
already claims the change.

## Apply Rules

Once inside the selected worktree:

1. Run `git status --short`.
2. Read the change proposal, design, delta specs, and tasks.
3. Implement the next small unchecked task.
4. Mark a task complete only after the work and relevant validation are done.
5. Run the narrowest useful checks from this selected worktree so they exercise
   the claimed branch. If Jest reports no tests because the repo config ignores
   `/worktrees/`, rerun Jest from this worktree with `testPathIgnorePatterns`
   overridden to exclude only real ignored paths such as `/node_modules/`,
   `/tests/e2e/`, and `/.stryker-tmp/`; do not validate by rerunning from
   `main`.
6. Run scoped Prettier on changed files before committing.
7. Commit useful progress with a conventional commit.

Do not create PRs. Do not archive changes. Do not run Detox/native e2e from
implementation worktrees.

For dependency checks, inspect `package.json` and lockfiles in the selected
checkout. Do not treat `node_modules` inside a sibling `worktrees/*` directory
as evidence that the current checkout has a dependency available. If a change
depends on another OpenSpec change, such as RNTL infrastructure, and that
dependency is not present on the selected checkout, stop and report the
prerequisite as a blocker.

If blocked, report the exact blocker, include the `OPENSPEC_SHIPPER_BLOCKED:`
final line, and leave incomplete tasks unchecked.
