# Git and OpenSpec Workflow

This repo uses OpenSpec as the canonical backlog and Git worktrees as the
execution surface for agents.

## Core Model

- `origin/<baseBranch>` is the integration boundary. The human checkout is not
  a Shipper execution surface and may remain on any branch.
- Planning may happen on the base branch, an ordinary branch, or a worktree.
- The queue adopts one immutable committed planning snapshot.
- The shipper runner prepares deterministic worktrees before model-driven
  implementation starts.
- Implementation runs in `worktrees/<change-name>`.
- Never edit product code for an OpenSpec change directly on the base branch.
- Pull requests are created after implementation, before archive.
- Archive runs in `.openspec-shipper/workspaces/integration`, rebuilt from the
  latest remote base after the implementation PR merges.
- The runner owns refresh, push, PR creation, archive publication, and cleanup.

## Branches and Worktrees

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

Rules:

- The worktree directory must match the OpenSpec change name.
- Do not prefix the worktree directory with the branch type.
- Do not use `scratch`.
- Do not add suffixes like `-2`, `-retry`, timestamps, or agent names.
- If a branch, worktree, remote branch, or PR already exists, treat it as the
  durable claim lock for that change.

## Sandbox And Temporary Files

Use relative repository paths only. Do not write temporary files under `/tmp`,
`/var`, `$HOME`, or any other absolute external directory. If a temporary copy
is needed, create it inside the current repository checkout, for example
`.openspec-shipper/tmp/` or `.opencode/tmp/`, and clean it up before committing.

If a tool asks for `external_directory` permission, stop and report the path as
a blocker instead of retrying.

When any worker cannot complete its phase, it must end with exactly one machine
readable blocker line:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```

Do not include that line after successful phases.

## Conventional Commits

Use loose Conventional Commits:

```text
<type>(optional-scope): <summary>
```

Rules:

- Keep the first line under 90 characters.
- Prefer a scope when obvious.
- Do not invent a scope.
- The header must describe one coherent change.
- If the natural summary needs `;`, `and`, or multiple OpenSpec change names,
  split the work into separate commits or move details into the body.

Examples:

```text
feat(auth): add password reset flow
fix(api): handle expired token refresh
docs(openspec): add monitor journey e2e proposal
chore(openspec): archive settings screen web e2e
```

## GitHub Identity

Set repo-local identity before commits:

```bash
git config user.name "YOUR_GITHUB_USER"
git config user.email "YOUR_GITHUB_USER@users.noreply.github.com"
```

If your repo uses an SSH alias, configure `origin` consistently:

```bash
git remote set-url origin git@github.com:YOUR_GITHUB_USER/YOUR_REPO.git
```

## Human Planning

1. Create or continue OpenSpec artifacts in main, a branch, or a worktree.
2. Validate them and commit the complete planning snapshot.
3. Add the change to `.openspec-shipper/queue.md` by command or direct edit.
4. After adoption, later planning commits are not silently added to the run.

## Prepare Phase

1. Do not inspect or modify the human checkout.
2. Do not pull, push, or create worktrees directly; the native
   `prepare_worktree` phase owns that setup.
3. Continue the exact snapshot and delivery worktree selected by the runner.

## Apply Phase

1. Verify the selected `worktrees/<change-name>` already exists.
3. Never create branches or worktrees in implement; the native `prepare_worktree` phase owns
   that setup.
4. Enter the selected worktree.
5. Implement one selected change.
6. Mark tasks complete only when actually implemented and validated.
7. Commit progress with a valid Conventional Commit.

## Native Push Phase

OpenSpec Shipper owns `push` in runner code. OpenCode agents must not push
branches, create pull requests, or call `gh pr create`. After `implement`
finishes all tasks and commits progress in `worktrees/<change-name>`, the
runner validates the completed worktree, pushes the branch, and opens or reuses
the pull request with GitHub CLI.

## Archive Phase

1. Run only from the detached integration worktree prepared from
   `origin/<baseBranch>`.
2. Verify that integration worktree is clean before archiving.
3. Do not run `git pull`, `git fetch`, `git rebase`, `git commit`, or `git push`.
   The runner owns Git synchronization and finalization for archive.
4. Select the named change whose tasks are complete in this snapshot.
5. Select exactly one eligible change per run. Do not archive batches.
6. Run `openspec validate <change-name>`.
7. Run `openspec archive <change-name> -y`.
8. Verify the diff only touches OpenSpec change/archive and canonical spec files.
9. Leave the diff for the runner to stage, commit, and publish.
10. Do not clean local worktrees or branches in this phase.

## Native Delivery Phases

OpenSpec Shipper owns `prepare_worktree`, `refresh_branch`, `push`,
`publish_archive`, and `cleanup_worktree`. OpenCode agents must not duplicate
those operations or call GitHub APIs.
