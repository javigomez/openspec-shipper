# OpenSpec Shipper Codex Workflow

This repository uses OpenSpec as the canonical backlog and Git worktrees as the
execution surface for implementation agents.

## Core Model

- `main` is the canonical OpenSpec planning, sync, and archive checkout.
- Implementation work runs only in `worktrees/<change-name>`.
- The shipper runner owns the native `prepare_worktree` phase. Codex must not
  create branches or worktrees during `implement`.
- Pull requests are created after implementation and before archive.
- Archive runs only after the implementation PR has merged.
- Cleanup runs only after OpenSpec archive has completed and pushed.

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
- `push` validates, commits final verification changes, and pushes the selected
  implementation branch. It must not create PRs manually.
- `sync_main` only reconciles root `main` with `origin/main`.
- `archive` runs OpenSpec archive from root `main` and pushes the archive/spec
  diff. It must not clean worktrees.
- `cleanup_worktree` removes only clean local implementation worktrees and
  merged local branches. It must not edit files, commit, push, or delete remote
  branches.
