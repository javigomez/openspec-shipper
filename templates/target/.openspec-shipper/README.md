# OpenSpec Shipper

This repository has OpenSpec Shipper installed. OpenSpec Shipper runs an
OpenSpec delivery queue through an AI executor, using provider assets installed
in this repo.

## Installed Files

The installer created or updated these project assets:

- `.openspec-shipper/config.json`
- `.openspec-shipper/.env.example`
- `.openspec-shipper/queue.md`
- `.openspec-shipper/queue.example.md`
- `.openspec-shipper/openspec-config.example.yaml`
- `.openspec-shipper/scripts/`
- provider assets:
  - OpenCode: `.opencode/commands`, `.opencode/agents`, `.opencode/rules`
  - Codex CLI: `.openspec-shipper/codex/`
- `.github/workflows/open-pr-on-branch-push.yml`
- `package.json`
- `.gitignore`

## Required After Init

Review and commit the installed project assets on `main` before running the
queue. The native `prepare_worktree` phase creates feature worktrees from `HEAD`; if `main` is
dirty after `init`, the new worktree would miss the freshly installed scripts,
workflows, provider commands, and package changes.

`openspec-shipper doctor` checks this and fails when `main` has non-runtime
changes. Ignored runtime files such as `.openspec-shipper/queue.md`, logs, lock
files, and `worktrees/` are allowed.

Local queue state remains ignored and should not be committed:

- `.openspec-shipper/.env`
- `.openspec-shipper/queue.md`
- `.openspec-shipper/shipper.lock`
- `.openspec-shipper/stop`
- `.openspec-shipper/runs/`
- `.openspec-shipper/tmp/`
- `worktrees/`

Suggested commit:

```bash
git status --short
git add <reviewed installed files>
git commit -m "chore: install openspec shipper"
```

## Check The Installation

Before running the queue, enable the repository setting that lets the auto-PR
workflow create pull requests:

```text
GitHub Settings > Actions > General > Workflow permissions >
Allow GitHub Actions to create and approve pull requests
```

If this is disabled, `push` can push the branch but GitHub will reject the
workflow that opens the PR.

OpenSpec Shipper also requires the GitHub CLI for PR state reconciliation:

```bash
gh auth status
```

The runner uses `gh` to detect when the auto-PR has been created and when it has
merged, so `waiting_for_pr` and `waiting_for_merge` can advance without asking
the AI executor to guess.

```bash
npx openspec-shipper doctor
```

## Add Changes To The Queue

Add one or more active OpenSpec changes:

```bash
npx openspec-shipper queue add add-name-greeting
npx openspec-shipper queue add add-spanish-greeting --depends-on add-name-greeting
npx openspec-shipper queue add add-shouting-greeting --depends-on add-spanish-greeting
```

Or edit `.openspec-shipper/queue.md` directly:

```md
- [ ] deliver add-name-greeting
- [ ] deliver add-spanish-greeting <!-- depends_on: add-name-greeting -->
- [ ] deliver add-shouting-greeting <!-- depends_on: add-spanish-greeting -->
```

## Run Conservatively

```bash
npx openspec-shipper queue dry-run
npx openspec-shipper queue run
```

The default `deliver` flow is:

```text
prepare_worktree -> implement -> push -> waiting_for_pr -> waiting_for_merge -> sync_main -> archive -> cleanup_worktree
```

`prepare_worktree` is native runner logic: it creates or reconnects
`worktrees/<change-name>` and the deterministic implementation branch before
any model call. `implement` then implements inside that prepared workspace. `push`
pushes the implementation branch and waits for the auto-PR workflow to open a
pull request. After the PR merges, the queue can continue through `sync_main`
and `archive`, then `cleanup_worktree`.

`archive` is the OpenSpec-native step. `cleanup_worktree` is OpenSpec Shipper
housekeeping: it removes clean local implementation worktrees and merged local
branches when safe. Missing worktree or branch is a successful no-op.

If a task blocks, fix the cause described in the log, then change `[!]` to
`[ ]` in `.openspec-shipper/queue.md` and run the queue again. The shipper will
remove the retry hint under the task and reconcile the correct phase before it
spends tokens.
