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
    "autoMergePollIntervalMs": 15000,
    "autoMergeWaitTimeoutMs": 1800000,
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
OPENSPEC_SHIPPER_GITHUB_AUTO_MERGE_POLL_INTERVAL_MS=15000
OPENSPEC_SHIPPER_GITHUB_AUTO_MERGE_WAIT_TIMEOUT_MS=1800000
```

Auto-merge does not resolve conflicts. A `CONFLICTING` PR remains blocked for
intervention. GitHub may merge immediately when a repository has no required
checks or branch protection, so enable this only alongside appropriate
protection for the base branch and a CI workflow. In `queue run`, an enabled
auto-merge stays pending and Shipper polls GitHub natively every
`autoMergePollIntervalMs`; this does not invoke the coding provider or consume
model tokens. A failed required check blocks immediately. A PR that remains
pending for `autoMergeWaitTimeoutMs` (30 minutes by default) blocks with the
last observed GitHub status. With auto-merge disabled, Shipper never polls: it
leaves the PR as a human merge gate and exits after any other runnable queue
items finish.

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
OPENSPEC_SHIPPER_PRINT_LOGS=true
OPENSPEC_SHIPPER_LOG_LEVEL=ERROR
OPENSPEC_SHIPPER_CODEX_MODEL=
OPENSPEC_SHIPPER_CODEX_REASONING_EFFORT=
OPENSPEC_SHIPPER_CLAUDE_MODEL=
OPENSPEC_SHIPPER_CLAUDE_EFFORT=
```

OpenCode executions include `--print-logs --log-level ERROR` by default. Some
OpenCode provider errors are only emitted through that diagnostic stream and
the CLI can remain alive after reporting them. Shipper inspects the stream as
it is written and terminates the executor immediately when it reports a
terminal quota, authentication, permission, model-availability, or provider
failure. Terminal provider failures are blocked directly instead of consuming
an assisted-recovery attempt.

Set `OPENSPEC_SHIPPER_PRINT_LOGS=false` to suppress OpenCode's diagnostic
stream, or change `OPENSPEC_SHIPPER_LOG_LEVEL` if a provider requires another
level. Disabling printed logs also disables early detection of errors that
OpenCode does not expose in its normal output, so Shipper can only stop those
runs when the phase timeout expires.

See [Pick the right model for each job](../guide/choosing-models.md) for how to
choose values.
