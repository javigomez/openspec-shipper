# Providers

OpenCode, Codex CLI, and Claude Code implement the same intelligent phases:
`implement` and `archive`. Git, GitHub, worktree, publication, and cleanup work
remains native Shipper behavior.

For guidance on *which* model to run on each provider (and why cheap
implementation models pair well with expensive planning models), see
[Pick the right model for each job](../guide/choosing-models.md).

## Codex CLI

```bash
npx openspec-shipper init --provider codex-cli
```

Prompts and workflow overrides live under `.openspec-shipper/codex/`. The
default configuration uses `gpt-5.6-luna` with extra-high (`xhigh`) reasoning effort.

`init` uses Codex CLI as its default provider. Choose another provider explicitly
with `--provider opencode` or `--provider claude-code`.

Model selection:

```json
{ "executor": { "provider": "codex-cli", "codex": { "model": "gpt-5.6-luna", "reasoningEffort": "xhigh" } } }
```

Override per run with `OPENSPEC_SHIPPER_CODEX_MODEL` and
`OPENSPEC_SHIPPER_CODEX_REASONING_EFFORT`.

## OpenCode

```bash
npx openspec-shipper init --provider opencode
```

Project overrides live under `.opencode/`. Packaged command defaults remain
available when an override is absent.

Model selection:

```json
{ "executor": { "provider": "opencode", "opencode": { "model": "opencode-go/deepseek-v4-pro" } } }
```

Override per run with `OPENSPEC_SHIPPER_OPENCODE_MODEL`.

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

Model selection:

```json
{ "executor": { "provider": "claude-code", "claude": { "model": "sonnet", "effort": "low" } } }
```

Also settable at init with `--model` and `--effort`, or per run with
`OPENSPEC_SHIPPER_CLAUDE_MODEL` and `OPENSPEC_SHIPPER_CLAUDE_EFFORT`.

## Switching provider

Run `init` or `update` with the desired provider and review the resulting config
and assets. Old provider files are not deleted automatically because they may
contain project customizations.
