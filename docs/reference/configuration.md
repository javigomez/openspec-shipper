# Configuration

Project configuration lives at `.openspec-shipper/config.json`. Runtime secrets
and machine-specific overrides belong in `.openspec-shipper/.env`; Shipper never
loads the target application's root `.env`.

## Precedence

From highest to lowest priority:

1. CLI flags.
2. `OPENSPEC_SHIPPER_*` process environment variables.
3. `.openspec-shipper/.env`.
4. `.openspec-shipper/config.json`.
5. Defaults.

## Main sections

```json
{
  "version": 2,
  "baseBranch": "main",
  "packageManager": "npm",
  "executor": {
    "provider": "opencode"
  },
  "worktree": {
    "install": true,
    "installTimeoutMs": 600000
  },
  "delivery": {
    "refreshPolicy": "auto"
  },
  "archive": {
    "publishMode": "direct",
    "maxAttempts": 3
  },
  "safety": {
    "enablePush": true,
    "enableArchive": true
  }
}
```

`delivery.refreshPolicy` accepts `auto`, `always`, `conflicts-only`, or `never`.
`archive.publishMode` accepts `direct` or `pull-request`.

The `checks` object adapts Shipper to the target repository. Empty typecheck,
lint, format, or unit commands are valid; Shipper does not assume every project
uses the same language or scripts.

## Executor models

Each provider accepts a model (and, where supported, an effort level) in the
`executor` section:

```json
{
  "executor": {
    "provider": "opencode",
    "opencode": { "model": "opencode-go/deepseek-v4-pro" },
    "codex": { "model": "gpt-5.5", "reasoningEffort": "low" },
    "claude": { "model": "sonnet", "effort": "low" }
  }
}
```

The matching environment overrides are:

```bash
OPENSPEC_SHIPPER_OPENCODE_MODEL=
OPENSPEC_SHIPPER_CODEX_MODEL=
OPENSPEC_SHIPPER_CODEX_REASONING_EFFORT=
OPENSPEC_SHIPPER_CLAUDE_MODEL=
OPENSPEC_SHIPPER_CLAUDE_EFFORT=
```

See [Pick the right model for each job](../guide/choosing-models.md) for how to
choose values.
