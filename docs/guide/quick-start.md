# Quick Start

Goal of this page: go from an empty setup to your first shipped change.

If you'd rather watch first, clone the [one-minute demo repo](https://github.com/javigomez/clean-repo-for-openspec-shipper-demo) and follow its README — it comes pre-loaded with OpenSpec changes ready to ship.

## What you need

- Git and a repository with an `origin` remote on GitHub.
- GitHub CLI (`gh`), authenticated: `gh auth login`.
- [OpenSpec](https://github.com/Fission-AI/OpenSpec) set up in the repository.
- One AI executor: OpenCode, Codex CLI, or Claude Code.

## 1. Install Shipper in your repo

```bash
npm install -D openspec-shipper
npx openspec-shipper init
```

`init` asks which AI executor you use, which package manager, and a few options. Codex CLI is the default provider; you can choose OpenCode or Claude Code during the prompts or with `--provider`. It installs everything under `.openspec-shipper/` (plus provider assets) — it never touches your app's code or your root `README.md`.

Commit what it installed, so the queue can see it from the remote base branch:

```bash
git add .
git commit -m "chore: install openspec shipper"
git push
```

## 2. Check your setup

```bash
npx openspec-shipper doctor
```

`doctor` verifies `git`, `gh` authentication, your executor, and the project checks. Fix anything it reports before moving on. Claude Code users can run `doctor --deep` for a full end-to-end probe of the CLI contract.

## 3. Queue a change and ship it

You need a committed OpenSpec change (a folder under `openspec/changes/<name>` with a `tasks.md`). Then:

```bash
npx openspec-shipper queue add <change-name>
npx openspec-shipper queue run
```

Shipper creates an isolated worktree, asks your AI executor to implement the tasks, pushes a branch, and opens a PR. Your terminal shows the progress; your working checkout stays untouched.

## 4. Review and merge

Open the PR link that Shipper wrote into the queue, review the code, and merge it on GitHub. The next `queue run` notices the merge, archives the OpenSpec change, and cleans up the worktree. Done — the change went from spec to merged without you touching a branch.

## What's next

Learn how the queue file works and how to control it: [Master the queue](./queue.md).
