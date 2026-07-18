# OpenSpec Shipper Codex Workflow

This repository uses OpenSpec as the canonical backlog and Git worktrees as the
execution surface for implementation agents.

## Core Model

- The configured base branch is the canonical OpenSpec planning, sync, and
  archive checkout. It defaults to `main`.
- Implementation work runs only in `worktrees/<change-name>`.
- The shipper runner owns the native `prepare_worktree` phase. Codex must not
  create branches or worktrees during `implement`.
- The shipper runner owns branch push and pull request creation through `git`
  and `gh`. Codex must not push branches or create PRs during `implement`.
- Archive runs only after the implementation PR has merged.
- Cleanup is native shipper housekeeping after OpenSpec archive has completed
  and pushed.

## Branches And Worktrees

Use branch names:

```text
<type>/<change-name>
```

Allowed types:

```text
feat fix docs refactor test chore ci build perf
```

Use worktree paths:

```text
worktrees/<change-name>
```

If a branch, worktree, remote branch, or PR already exists, treat it as the
durable claim lock for that change.

## Safety

Use relative repository paths. Do not write temporary files under `/tmp`,
`/var`, `$HOME`, or other absolute external directories. Use repo-local ignored
locations such as `.openspec-shipper/tmp/` when temporary files are needed.

When any phase cannot complete, end with exactly one final machine-readable
line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Do not include that line after successful phases.

## Conventional Commits

Use loose Conventional Commits:

```text
<type>(optional-scope): <summary>
```

Keep the first line under 90 characters. Prefer a scope when obvious. Do not
invent a scope.

## Phase Boundaries

- `implement` may edit product code and OpenSpec task checkboxes inside the
  selected worktree.
- `push` is native OpenSpec Shipper logic: it validates the completed worktree,
  pushes the selected implementation branch, and creates or reuses a PR with
  `gh`.
- `sync_main` is native OpenSpec Shipper logic: it reconciles the root base
  branch checkout with its origin branch.
- `archive` runs OpenSpec archive from the root base branch checkout and leaves
  the archive/spec diff for the runner. It must not commit, push, or clean
  worktrees.
- `cleanup_worktree` is native OpenSpec Shipper logic: it removes only clean
  local implementation worktrees and merged local branches.
