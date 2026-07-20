# Delivery Flow

Every `deliver` task moves through the same evidence-driven lifecycle:

```text
prepare_worktree -> implement -> refresh_branch -> push -> waiting_for_merge
-> archive -> publish_archive -> [waiting_for_archive_merge] -> cleanup_worktree
```

## Phases

### `prepare_worktree`

Resolves a committed planning snapshot, creates `worktrees/<change>`, and
installs dependencies when `worktree.install` is enabled.

### `implement`

Asks the selected provider to implement the next unchecked OpenSpec task and
run the target repository checks. Runs without observable progress are limited
to prevent silent token-consuming loops.

### `refresh_branch`

Integrates the current `origin/<baseBranch>` into the delivery branch before it
is published. The configured refresh policy also handles open PRs that conflict
or fall behind a protected base.

### `push`

Validates the completed change, pushes the delivery branch, and creates or
reuses its pull request through `gh`.

### `waiting_for_merge`

Hands control to the human. The queue includes the PR URL and resumes only after
GitHub reports that it has been merged.

### `archive`

Uses an agent to perform the semantic OpenSpec archive and canonical-spec
reconciliation inside a separate integration worktree.

### `publish_archive`

Publishes the archive commit directly with compare-and-swap protection, or
opens an archive PR when `archive.publishMode` is `pull-request`.

### `cleanup_worktree`

Removes the delivery worktree and local branch only after positive merge and
archive evidence. Cleanup succeeds as a no-op when nothing remains.

## Reconciliation

Before every command, Shipper inspects committed changes, worktrees, branches,
remote branches, pull requests, merges, and archives. It infers the most
advanced valid phase instead of trusting stale badges or blindly restarting.

Archive ordering inferred from shared `### Requirement:` headings is ephemeral:
it affects scheduling but is never persisted as human intent in `queue.md`.
