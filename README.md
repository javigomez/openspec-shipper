# openspec-shipper

`openspec-shipper` is a small CLI that runs an OpenSpec delivery queue through
AI executors. The v1 provider is OpenCode; Codex CLI support is included as an
experimental provider so the architecture can grow without changing the queue
contract.

The package is npm-first and repo-local by default:

```bash
npm install -D openspec-shipper
npx openspec-shipper init
npx openspec-shipper doctor
```

There is no `postinstall` mutation. `init` is the command that installs project
assets, and it writes state only under `.openspec-shipper/` plus provider assets
such as `.opencode/`.

## Commands

```bash
openspec-shipper init
openspec-shipper doctor
openspec-shipper update

openspec-shipper queue add <change-name>
openspec-shipper queue next
openspec-shipper queue run
openspec-shipper queue status
openspec-shipper queue dry-run
openspec-shipper queue stop
openspec-shipper queue stats
```

Top-level aliases are also available:

```bash
openspec-shipper add <change-name>
openspec-shipper next
openspec-shipper run
openspec-shipper status
openspec-shipper dry-run
openspec-shipper stop
openspec-shipper stats
```

The old Bun scripts are kept as transition helpers in this repository, but new
docs should use the CLI above.

## State And Env

Runtime state lives in the target repository:

```text
.openspec-shipper/
  config.json
  .env
  .env.example
  queue.md
  runs/
  tmp/
  installed.json
  shipper.lock
  stop
```

`openspec-shipper` never loads the target app's `.env`. It only reads
`.openspec-shipper/.env`, or the file passed with `--env-file`.

Config precedence is:

```text
CLI flags > process.env OPENSPEC_SHIPPER_* > .openspec-shipper/.env > .openspec-shipper/config.json > defaults
```

Useful variables:

```bash
OPENSPEC_SHIPPER_PROJECT_DIR=/absolute/path/to/repo
OPENSPEC_SHIPPER_QUEUE_PATH=/absolute/path/to/repo/.openspec-shipper/queue.md
OPENSPEC_SHIPPER_PROVIDER=opencode
OPENSPEC_SHIPPER_OPENCODE_BIN=opencode
OPENSPEC_SHIPPER_OPENCODE_MODEL=opencode-go/deepseek-v4-pro
OPENSPEC_SHIPPER_CODEX_BIN=codex
OPENSPEC_SHIPPER_CODEX_MODEL=gpt-5.4
OPENSPEC_SHIPPER_PRINT_LOGS=1
OPENSPEC_SHIPPER_LOG_LEVEL=ERROR
OPENSPEC_SHIPPER_STATS=1
```

`init` adds these ignored entries:

```gitignore
# OpenSpec Shipper local state
.openspec-shipper/.env
.openspec-shipper/queue.md
.openspec-shipper/runs/
.openspec-shipper/tmp/
worktrees/
```

## Init

Interactive mode:

```bash
npx openspec-shipper init
```

Non-interactive mode:

```bash
npx openspec-shipper init --yes --provider opencode --package-manager npm
```

Current implementation still uses the previous profile flag while the
interactive wizard is being expanded:

```bash
npx openspec-shipper init --profile node-npm
```

`init` installs:

- `.openspec-shipper/config.json` and `.openspec-shipper/.env.example`
- `.openspec-shipper/README.md` and `.openspec-shipper/queue.example.md`
- `.openspec-shipper/openspec-config.example.yaml` as optional OpenSpec config guidance
- `.openspec-shipper/scripts/` with shipper-owned validation helpers
- `.opencode/commands`, `.opencode/agents`, `.opencode/rules`
- GitHub workflow for auto PR creation after branch push
- package scripts and missing dev dependencies
- `.gitignore` entries for shipper state and worktrees

`update` refreshes installed assets using `.openspec-shipper/installed.json`.
Locally changed files are reported as `drifted` instead of overwritten; use
`--force` only when replacing local edits intentionally.

## Queue

`queue add` creates the queue if needed and avoids duplicates:

```bash
npx openspec-shipper queue add add-name-greeting
npx openspec-shipper queue add openspec/changes/add-spanish-greeting
npx openspec-shipper queue add add-shouting-greeting --depends-on add-spanish-greeting
```

Queue format:

```md
- [ ] deliver add-name-greeting
- [ ] deliver add-spanish-greeting <!-- depends_on: add-name-greeting -->
- [ ] sync
```

`deliver` advances through:

```text
apply -> ship -> waiting_for_merge -> sync -> archive
```

`waiting_for_merge` is intentionally not runnable. After the PR merges, move
the task to `phase: sync` so the shipper can sync `main` and archive safely.

## Providers

### OpenCode

OpenCode is the stable v1 provider. It builds the same commands as the original
runner:

```bash
opencode run --command openspec-apply-worktree <change>
opencode run --command openspec-ship-worktree <change>
opencode run --command openspec-main-sync
opencode run --command openspec-archive-merged <change>
```

With config enabled, it also adds:

```bash
--print-logs --log-level ERROR --model <model>
```

### Codex CLI

Codex CLI is experimental. It does not install `.opencode` assets and currently
exists so the provider contract can be tested in the demo flow:

```json
{
  "executor": {
    "provider": "codex-cli",
    "codex": {
      "bin": "codex",
      "model": "gpt-5.4"
    }
  }
}
```

Dry-run will produce command specs like:

```bash
codex exec -C <projectDir> --sandbox workspace-write --ask-for-approval never --model <model> <prompt>
```

Claude Code is intentionally roadmap-only for now.

## Local And External Modes

Default local mode runs inside the target repo:

```bash
cd /path/to/target-repo
npx openspec-shipper queue dry-run
npx openspec-shipper queue next
```

External mode is still supported:

```bash
npx openspec-shipper \
  --project /path/to/target-repo \
  --queue /path/to/target-repo/.openspec-shipper/queue.md \
  queue dry-run
```

This keeps the hybrid option open while making the npm-installed local workflow
the normal path.

## Demo

The demo repo is at:

```text
/Users/javigomez/Documents/projects/openspec-demo
```

Suggested walkthrough for a GIF:

```bash
git clone <demo-url> openspec-demo-gif
cd openspec-demo-gif
npm install
npm install -D openspec-shipper
npx openspec-shipper init --profile node-npm
npx openspec-shipper doctor
npx openspec-shipper queue add add-name-greeting
npx openspec-shipper queue add add-spanish-greeting --depends-on add-name-greeting
npx openspec-shipper queue add add-shouting-greeting --depends-on add-spanish-greeting
npx openspec-shipper queue status
npx openspec-shipper queue dry-run
npx openspec-shipper queue next
```

For local tarball testing before publish:

```bash
npm run build
npm pack
cd /Users/javigomez/Documents/projects/openspec-demo
npm install -D /path/to/openspec-shipper-0.1.0.tgz
npx openspec-shipper doctor
npx openspec-shipper queue dry-run
```

## Publishing Checklist

Run these before publishing:

```bash
bun test
npm run build
npm_config_cache=/private/tmp/openspec-shipper-npm-cache npm pack --dry-run
```

Then test the generated tarball in `openspec-demo`. Publish only after the
manual OpenCode demo works:

```bash
npm publish --access public
```
