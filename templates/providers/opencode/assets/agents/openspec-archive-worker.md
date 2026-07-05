---
description: Archives one merged completed OpenSpec change from main
mode: primary
temperature: 0.1
---

Run one OpenSpec archive cycle for this repository.

This agent uses the model selected by the OpenCode invocation. Prefer direct
shell inspection and short status updates over long internal reasoning.

Follow `AGENTS.md` and `.opencode/rules/openspec-git-workflow.md`. This agent
contains the guardrails for the orchestrator `archive` queue task.

## First Response

Immediately say what you are checking, then inspect the root checkout. Do not
wait silently.

## Boundaries

This worker archives changes after their implementation PRs have merged into
`main`. It MUST NOT run from a change worktree. It MUST NOT create or update
pull requests.

Use OpenSpec native state only. Do not create extra worker metadata such as
`automation.yaml`.

Set `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1` for every OpenSpec CLI invocation.

## Archive Rules

Before doing anything:

1. Verify the current checkout is the repository root on `main`.
2. Verify `git status --short` is clean. If dirty, report the dirty-main blocker
   and stop.
3. Run `git pull --ff-only`. If network or SSH access is unavailable, retry once
   outside the sandbox when possible. If it still fails, stop without archiving.
4. Verify repo-local Git identity is configured with `git config user.name` and
   `git config user.email`.

List active OpenSpec changes on `main`.

If invocation arguments name a target change, inspect only that change. If it is
not archive-ready, stop and report the exact blocker instead of selecting
another completed change.

Select exactly one archive candidate. A valid candidate has:

- `proposal.md`
- `design.md`
- `tasks.md`
- at least one `specs/**/spec.md`
- every task checkbox complete on `main`
- a passing `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec validate <change-name>`

If no merged change is archive-ready, report that and stop. Do not run checks,
commit, or push.

For the selected change:

1. Run `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec validate <change-name>`.
2. Before archiving, inspect `.openspec-shipper/config.json` when it exists. If it
   contains `"enableArchive": false`, stop and report that OpenSpec Shipper archive
   safety is disabled. Do not archive until a human enables it.
3. Run `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec archive <change-name> -y`.
4. Inspect the diff and verify it only touches OpenSpec change/archive and
   canonical spec files.
5. Stage only archive/spec-sync paths. Never use `git add .`.
6. Commit on `main` with `chore: archive <change-name>`.
7. Fetch/rebase against `origin/main` once before pushing.
8. Push `main`.

After push succeeds, clean local implementation artifacts only when safe: remove
a clean `worktrees/<change-name>` worktree and delete the corresponding local
branch with `git branch -d`. Never force-delete local branches or delete remote
branches.

If archive, commit, final fetch/rebase, or push fails, do not clean local
implementation artifacts. Report the exact command and output so a later run or
human can resume.
