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
  "github": {
    "autoOpenPr": false,
    "autoMergePr": false,
    "prChecks": false
  },
  "recovery": {
    "enabled": true,
    "maxAttemptsPerPhase": 1
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
`recovery.enabled` controls the final assisted recovery attempt before an
actionable failure is marked blocked. `recovery.maxAttemptsPerPhase` defaults
to one and is persisted in the queue, so restarting the runner cannot create a
retry loop. Recovery runs from the repository root with the selected provider's
non-interactive full-access mode so it can repair Git metadata and recreate a
broken target worktree. Provider, authentication, permission, configuration,
missing repository root, and human-merge failures are never sent to assisted
recovery.
`doctor` rejects non-positive attempt budgets and non-boolean enablement.
`archive.publishMode` accepts `direct` or `pull-request`.

`github.autoMergePr` defaults to `false`. When enabled, the `push` phase runs
`gh pr merge <pr> --auto --squash` after creating or finding the implementation
PR. The operation is idempotent: Shipper also applies it to PRs that already
exist and skips the command when GitHub reports auto-merge is already enabled.
You can override the file setting per machine with:

```bash
OPENSPEC_SHIPPER_GITHUB_AUTO_MERGE_PR=true
```

Auto-merge does not resolve conflicts. A `CONFLICTING` PR remains blocked for
intervention. GitHub may merge immediately when a repository has no required
checks or branch protection, so enable this only alongside appropriate
protection for the base branch and a CI workflow.

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
    "codex": { "model": "gpt-5.6-luna", "reasoningEffort": "xhigh" },
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
