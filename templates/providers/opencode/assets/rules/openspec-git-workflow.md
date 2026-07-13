# Git and OpenSpec Workflow

This repo uses OpenSpec as the canonical backlog and Git worktrees as the
execution surface for agents.

## Core Model

- `main` is the canonical OpenSpec planning and archive checkout.
- Create, continue, list, status, sync, validate proposal artifacts, and
  archive OpenSpec changes on `main`.
- The shipper runner prepares deterministic worktrees before model-driven
  implementation starts.
- Only apply/implementation work runs in the selected change worktree.
- Never edit product code for an OpenSpec change directly on `main`.
- Pull requests are created after implementation, before archive.
- Archive only after the PR is merged and `main` has been pulled.
- A main sync worker may reconcile local `main` with `origin/main`; it must not
  edit files or create commits.

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

## Proposal Phase

1. Run only from root `main`.
2. Verify `main` is clean.
3. Create or continue the OpenSpec proposal artifacts.
4. Validate the change before treating it as durable.
5. If your repo adds a stricter proposal wrapper, run that wrapper here.
6. Commit complete proposal artifacts on `main`.

## Prepare Phase

1. Run from root `main`.
2. Verify `main` is clean. If it is dirty, keep discovery on the local
   snapshot and stop before creating a new worktree.
3. Pull with `git pull --ff-only` when network is available and `main` is
   clean.
4. List active OpenSpec changes.
5. Skip incomplete scaffolds and 100% complete changes.
6. Skip changes with an existing open PR.
7. Continue an existing branch/worktree when present.
8. Create `worktrees/<change-name>` only when no claim exists.
9. Do not edit product code and do not mark OpenSpec tasks complete.

## Apply Phase

1. Run discovery from root `main`.
2. Verify the selected `worktrees/<change-name>` already exists.
3. Never create branches or worktrees in apply; the native `prepare` phase owns
   that setup.
4. Enter the selected worktree.
5. Implement one selected change.
6. Mark tasks complete only when actually implemented and validated.
7. Commit progress with a valid Conventional Commit.

## Push Phase

1. Inspect registered `worktrees/*`.
2. Select only worktrees whose `tasks.md` is 100% complete.
3. Validate OpenSpec artifacts.
4. Run local checks.
5. Commit final verification changes if needed.
6. Validate commit messages.
7. Push the branch.
8. After push, verify that an open PR exists when `gh` is available. If no PR
   exists, stop and end with
   `OPENSPEC_SHIPPER_BLOCKED: no open pull request exists for <branch>`.
9. Do not call `gh pr create` or any other manual PR creation path from the
   ship worker.

## Archive Phase

1. Run only from root `main`.
2. Verify `main` is clean.
3. Run `git pull --ff-only`.
4. Select changes whose tasks are 100% complete on `main`.
5. Select exactly one eligible change per run. Do not archive batches.
6. Run `openspec validate <change-name>`.
7. Run `openspec archive <change-name> -y`.
8. Stage only OpenSpec archive/spec files.
9. Commit archive result on `main`.
10. Fetch/rebase before push to avoid divergence.
11. Push `main`.
12. If push fails, stop with at most one local archive commit.
13. Do not clean local worktrees or branches in this phase.

## Cleanup Phase

1. Run only from root `main`.
2. Verify the target change exists under `openspec/changes/archive/`.
3. Remove only clean local `worktrees/<change-name>` worktrees.
4. Delete only merged local implementation branches with `git branch -d`.
5. Never force-delete local branches and never delete remote branches.
6. Missing worktree or branch is a successful no-op.

## Main Sync Phase

1. Run only from root `main`.
2. Verify `main` is clean.
3. Fetch `origin/main`.
4. Fast-forward, push local-only commits, or rebase local archive/proposal
   commits on top of `origin/main` when local and remote diverged.
5. Do not edit files, create commits, run OpenSpec commands, or create PRs.
