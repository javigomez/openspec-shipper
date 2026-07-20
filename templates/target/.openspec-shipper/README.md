# OpenSpec Shipper

This repository has OpenSpec Shipper installed. It turns committed OpenSpec
changes into isolated implementation worktrees, pull requests, canonical specs,
and cleaned local state without taking over the human checkout.

## Required After Init

Review and commit the installed project assets. They must be available from the
repository's remote base before delivery starts:

```bash
git status --short
git add <reviewed installed files>
git commit -m "chore: install openspec shipper"
git push
```

Authenticate GitHub CLI and check the installation:

```bash
gh auth login
npx openspec-shipper doctor
```

`init` installs dependencies by default. If it was run with `--no-install`, run
the selected package manager before `doctor`.

## Human Handoff

Create and validate a change on main, an ordinary branch, or a worktree. Commit
the complete planning snapshot, then edit the queue directly:

```md
- [ ] deliver add-name-greeting
- [ ] deliver add-spanish-greeting <!-- depends_on: add-name-greeting -->
```

The equivalent convenience command is:

```bash
npx openspec-shipper queue add add-name-greeting
```

The pending markdown line is the handoff. Shipper resolves the committed source
once and records its immutable `source_commit` in that same task. The human
checkout may then stay on any branch and may contain unrelated planning work;
delivery phases never switch, stash, reset, clean, or commit it.

## Delivery Flow

```text
prepare_worktree -> implement -> refresh_branch -> push -> waiting_for_merge
-> archive -> publish_archive -> [waiting_for_archive_merge] -> cleanup_worktree
```

- `prepare_worktree` creates `worktrees/<change>` from the remote base, adopts
  the committed planning snapshot, and runs `checks.install` when required.
- `implement` is the intelligent coding phase.
- `refresh_branch` integrates the current remote base before first push, and
  refreshes open PRs only when conflicts, branch protection, or config require it.
- `push` validates, pushes, and creates or reuses a PR through `gh`.
- `archive` performs semantic OpenSpec reconciliation in the detached
  `.openspec-shipper/workspaces/integration` worktree.
- `publish_archive` uses a CAS push by default or an archive PR when
  `archive.publishMode` is `pull-request`.
- `cleanup_worktree` removes the delivery worktree and local branch only after
  positive archive/merge evidence.

`queue.md` is reconciled from repository and GitHub evidence before every
command. If it is recreated without phase metadata, Shipper infers the most
advanced valid phase instead of blindly starting over.

`design.md` is optional for simple OpenSpec changes. Shipper reads and preserves
it when present but does not require it during implementation, push, archive,
or reconciliation. The configured OpenSpec validation command remains the
authority for the selected schema.

When independent changes touch the same `### Requirement:`, Shipper adds
`archive_after` automatically. Their implementation can remain concurrent while
canonical-spec publication is serialized.

## Run

```bash
npx openspec-shipper queue dry-run
npx openspec-shipper queue run
```

Waiting for a human and actual errors both use `[!]`. The task comment contains
the reason and the badge links to the complete run log. After fixing or merging,
change `[!]` to `[ ]` and run the queue again; Shipper reconciles before retrying.

## Local State

These paths are local and ignored:

```text
.openspec-shipper/.env
.openspec-shipper/queue.md
.openspec-shipper/shipper.lock
.openspec-shipper/stop
.openspec-shipper/runs/
.openspec-shipper/tmp/
.openspec-shipper/workspaces/
worktrees/
```

Provider prompts have package defaults. Installed OpenCode, Codex, and Claude
assets are project overrides, so local customization remains possible without
making a missing prompt a runtime blocker. Claude sandbox settings remain local
and are validated by `doctor`.

The queue lock contains a PID and heartbeat. A later run recovers it only when
the local owner process is no longer alive.
