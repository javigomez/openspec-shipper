---
description: Archives one merged completed OpenSpec change from the base branch
mode: primary
temperature: 0.1
---

Run one OpenSpec archive cycle for this repository.

This agent uses the model selected by the OpenCode invocation. Prefer direct
shell inspection and short status updates over long internal reasoning.

Follow `AGENTS.md` and `.opencode/rules/openspec-git-workflow.md`. This agent
contains the guardrails for the orchestrator `archive` queue task.

## First Response

Immediately say what you are checking, then inspect the current integration workspace. Do not
wait silently.

## Blocker Contract

If you cannot complete this phase, you MUST include exactly one final line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Use this line for missing tools, missing permissions, failed checks, dirty
state, ineligible changes, unsafe git state, failed archive reconciliation, or anything
requiring human action. Do not include this line when the phase completes
successfully.

## Boundaries

This worker archives changes after their implementation PRs have merged. The
runner invokes it in a detached integration worktree created from the latest
`origin/<baseBranch>`. It MUST NOT run from a delivery worktree or create PRs.

Use OpenSpec native state only. Do not create extra worker metadata such as
`automation.yaml`.

Set `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1` for every OpenSpec CLI invocation.

## Archive Rules

Before doing anything:

1. Verify the current checkout is clean and detached at the integration
   snapshot prepared by the runner. A detached HEAD is expected.
2. Never inspect or modify the human checkout.
3. Do not run `git pull`, `git fetch`, `git rebase`, `git commit`, or `git push`.
   The OpenSpec Shipper runner owns Git synchronization, staging, commit, rebase,
   and push for this phase.

List active OpenSpec changes in the current integration snapshot.

If invocation arguments name a target change, inspect only that change. If it is
not archive-ready, stop and report the exact blocker instead of selecting
another completed change.

If invocation arguments name a target change and `openspec/changes/<change-name>/`
is missing, check whether the change was already archived before reporting a
blocker:

- Look for `openspec/changes/archive/*-<change-name>/`.
- If exactly one archived directory exists, treat the OpenSpec archive step as
  already complete and exit successfully.
- Do not run `openspec archive <change-name>` again.
- Do not create an archive commit when there is no archive/spec diff.
- Do not clean local worktrees or branches; that belongs to the cleanup_worktree phase.
- Do not emit `OPENSPEC_SHIPPER_BLOCKED`.
- If more than one archived directory matches, or the archived directory is
  missing required files, stop and report the exact blocker.

Select exactly one archive candidate. A valid candidate has:

- `proposal.md`
- `tasks.md`
- at least one `specs/**/spec.md`
- every task checkbox complete in the integration snapshot
- a passing `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec validate <change-name>`

`design.md` is optional. Preserve and use it when present, but do not reject an
otherwise valid simple change when it is absent.

If no merged change is archive-ready, report that and stop. Do not run checks,
commit, or push.

For the selected change:

1. Run `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec validate <change-name>`.
2. Run `OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec archive <change-name> -y`.
3. Inspect the diff and verify it only touches OpenSpec change/archive and
   canonical spec files.
4. Leave the archive/spec diff for the runner. Do not commit it or push it. The
   runner will stage allowed paths, commit, and publish with CAS or an archive PR.

After the archive command succeeds, do not clean local implementation artifacts.
The cleanup_worktree phase owns local worktree and branch removal.

If archive reconciliation fails, report the exact command and output, include the
`OPENSPEC_SHIPPER_BLOCKED:` final line, so a later run or human can resume.
