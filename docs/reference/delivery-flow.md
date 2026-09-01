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
is published. If an existing delivery worktree is clean but falls behind the
current base while implementation is still incomplete, Shipper refreshes it
before invoking the implementation worker. The configured refresh policy also
handles open PRs that conflict or fall behind a protected base.

### `push`

Validates the completed change, pushes the delivery branch, and creates or
reuses its pull request through `gh`. When `github.autoMergePr` is enabled,
Shipper then enables squash auto-merge on that PR. Existing PRs are handled too,
so changing the setting after PR creation is safe. If dependency manifests or
lockfiles changed after implementation, Shipper first runs the configured native
dependency update. A failed native update is offered to assisted recovery before
the task is blocked.

### `waiting_for_merge`

The queue includes the PR URL and resumes only after GitHub reports that it has
been merged. With auto-merge disabled, this hands control to a human. With
auto-merge enabled, GitHub waits for required checks and approvals and merges
the PR automatically. A conflicting PR still requires human intervention;
auto-merge never resolves conflicts.

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

## Assisted recovery before blocking

When a worker or native phase encounters an actionable failure inside an
existing delivery workspace, Shipper gives the configured provider one final,
scoped recovery attempt before writing `[!]`. The recovery agent receives the
original reason and log, may repair only the current delivery or integration
workspace, and cannot advance the delivery phase itself. Shipper leaves the
same phase pending and retries its normal deterministic operation; only that
operation can certify success.

Shipper snapshots the human checkout and every other linked worktree around
the recovery call. If the agent changes any protected checkout, the recovery is
rejected and the task is blocked with that safety violation.

The attempt budget is persisted per phase to survive restarts. Failures in the
provider itself (model availability, usage limits, authentication, permissions
or configuration), missing workspaces, safety gates and pull requests waiting
for a human are blocked without another model call.
