# Getting Started

## Requirements

- Git and a repository with an `origin` remote.
- GitHub CLI (`gh`), authenticated with `gh auth login`.
- OpenSpec configured in the target repository.
- OpenCode, Codex CLI, or Claude Code.
- npm, pnpm, or Bun, according to the selected project profile.

## Install

Install Shipper in the target repository and run its explicit installer:

```bash
npm install -D openspec-shipper
npx openspec-shipper init
```

`init` asks for the provider, package manager, queue location, model, sandbox,
and publication options. It does not use `postinstall` to mutate the target
repository.

Review and commit the installed project assets before starting delivery:

```bash
git status --short
git add <reviewed-files>
git commit -m "chore: install openspec shipper"
git push
```

Runtime files such as `.openspec-shipper/.env`, `queue.md`, logs, temporary
workspaces, and `worktrees/` remain ignored.

## Validate

```bash
npx openspec-shipper doctor
```

Claude Code users can additionally verify the complete production CLI contract,
including authentication, structured output, and sandbox initialization:

```bash
npx openspec-shipper doctor --deep
```

## Deliver a change

Commit a valid OpenSpec change, add it to the queue, and inspect the next action:

```bash
npx openspec-shipper queue add add-name-greeting
npx openspec-shipper queue dry-run
npx openspec-shipper queue run
```

Shipper may stop at a pull request merge or a recoverable blocker. Follow the
instruction written immediately below the task in `queue.md`.
