# Providers

OpenCode, Codex CLI, and Claude Code implement the same intelligent phases:
`implement` and `archive`. Git, GitHub, worktree, publication, and cleanup work
remains native Shipper behavior.

## OpenCode

```bash
npx openspec-shipper init --provider opencode
```

Project overrides live under `.opencode/`. Packaged command defaults remain
available when an override is absent.

## Codex CLI

```bash
npx openspec-shipper init --provider codex-cli
```

Prompts and workflow overrides live under `.openspec-shipper/codex/`. The
default configuration uses `gpt-5.5` with low reasoning effort.

## Claude Code

```bash
npm install -g @anthropic-ai/claude-code
claude auth login
npx openspec-shipper init --provider claude-code --claude-sandbox strict
npx openspec-shipper doctor --deep
```

Claude assets live under `.openspec-shipper/claude/`; Shipper does not modify
the target repository's `.claude/` directory. Sandbox modes are `strict`,
`permissive`, and `off`. Weaker modes are deliberate safety tradeoffs and are
reported by `doctor`.

## Switching provider

Run `init` or `update` with the desired provider and review the resulting config
and assets. Old provider files are not deleted automatically because they may
contain project customizations.
