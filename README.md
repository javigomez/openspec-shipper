# ai-workflow-orchester

Small Bun runner for processing an OpenCode/OpenSpec queue from `queue.md`.

The core idea is deliberately simple: keep a typed Markdown queue, run one
worker task at a time, mark completed tasks, and pause immediately when anything
looks blocked or expensive to retry.

## Install The Orchestrator

```bash
bun install
cp .env.dist .env
```

Edit `.env` before running the queue. At minimum it must define:

```bash
PROJECT_DIR=/absolute/path/to/target-repo
OPENCODE_BIN=/absolute/path/to/opencode
```

## Prepare A Target Repository

Install the Orchester kit into the repository that contains OpenSpec changes:

```bash
bun run target:init /absolute/path/to/target-repo --profile node-npm
```

Available profiles:

- `node-npm`
- `node-pnpm`
- `bun`
- `generic`

`target:init` installs:

- `.opencode/commands`, `.opencode/agents`, and `.opencode/rules`
- `.github/workflows/open-pr-on-branch-push.yml`
- `.github/workflows/pr-checks.yml`
- `.orchester/config.json`
- `docs/agents/orchester-workflow.md`
- branch-name and OpenSpec validation helper scripts
- package scripts and dev dependencies when they are missing
- `.gitignore` entries for `node_modules/`, `worktrees/`, and Orchester run logs

Run a readiness check after setup:

```bash
bun run target:doctor /absolute/path/to/target-repo
```

Refresh installed assets after pulling Orchester updates:

```bash
bun run target:update /absolute/path/to/target-repo
```

Installed files are tracked in `.orchester/installed.json`. `target:update`
updates files that still match the previous installed version and reports
`drifted` for files changed locally, instead of overwriting them. Use `--force`
only when you intentionally want to replace local edits.

`target:setup` remains as a backwards-compatible alias for `target:init`.

## Target Configuration

The target repo gets its own `.orchester/config.json`. It stores the selected
profile, expected check commands, GitHub workflow toggles, and safety flags:

```json
{
  "safety": {
    "enablePush": false,
    "enableArchive": false
  }
}
```

New target repos start conservatively. Ship workers stop before pushing while
`enablePush` is `false`; archive workers stop before archiving while
`enableArchive` is `false`. Enable those only after `target:doctor`,
`queue:dry-run`, and a manual first run look good.

The installed `openspec/config.orchester.example.yaml` is a starting point, not
a file the runner reads. Copy the useful parts into the target repo's real
`openspec/config.yaml` and keep project-specific architecture/testing context
there.

## Demo Repository

`/Users/javigomez/Documents/projects/openspec-demo` is a tiny Node.js hello
world target repo prepared with this kit. It includes:

- a working `npm run check`
- one active OpenSpec change: `add-name-greeting`
- `queue.example.md` with `deliver add-name-greeting`
- Orchester safety flags disabled by default

Use it as the first local smoke test before trying the workflow on a real
project.

## Queue Format

`queue.md` accepts only typed tasks, not arbitrary shell commands:

```md
- [ ] deliver test-20-migrate-notebook-access-button-rntl
- [ ] apply test-18-migrate-cover-background-rntl
- [ ] ship
- [ ] sync
- [ ] archive
```

The runner turns these typed tasks into `opencode run --command <name>` calls.
OpenCode command names are intentionally passed **without** a leading slash.
Slash commands such as `/openspec-archive-merged` are for the interactive TUI;
`opencode run --command "/openspec-archive-merged"` can fail before the worker
starts.

`deliver <change-name>` is the higher-level OpenSpec change pipeline. It keeps
the queue line pending while advancing through phases stored in the trailing
comment:

```text
apply -> ship -> waiting_for_merge -> sync -> archive
```

For example:

```md
- [ ] deliver test-20-migrate-notebook-access-button-rntl
- [ ] deliver test-21-next-change <!-- depends_on: test-20-migrate-notebook-access-button-rntl -->
```

After a successful apply phase, the first line becomes:

```md
- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: ship; advanced: ...; log: ... --> ![ship](https://img.shields.io/badge/ship-pending-blue) · _([log](.orchester/runs/...log))_
```

The task is marked `[x]` only after the archive phase succeeds. Dependencies are
simple queue-level gates: if a deliver task has `depends_on`, it will be skipped
until a queue task with that change name is marked `[x]`. This is intentionally
based on queue state, so ordering still stays readable from top to bottom while
hard dependencies can be declared when one OpenSpec change must land before
another starts.

After `ship`, a deliver task moves to `waiting_for_merge`. That phase is
intentionally not runnable: the queue will skip it until you move it to
`phase: sync` after the PR is merged. This keeps the orchestrator from trying to
archive an OpenSpec change before GitHub has merged the implementation branch.

The HTML comment is the source of truth for the runner. The badge and log link
are regenerated as human-friendly Markdown decoration and ignored when parsing
the command.

For `apply`, the runner passes only the normalized change name as the command
argument, for example:

```bash
opencode run --command openspec-apply-worktree test-20-migrate-notebook-access-button-rntl
```

The command files must exist in the target repository:

```text
$PROJECT_DIR/.opencode/commands/
```

`PROJECT_DIR` is required in `.env` because OpenCode commands are project-local.
Use `bun run target:setup` to install or refresh those commands from the
orchestrator templates.

The lower-level `apply`, `ship`, `sync`, and `archive` tasks remain available as
manual escape hatches for existing worktrees, repo maintenance, and recovery
from older workflow states.

Statuses:

- `[ ]` pending
- `[x]` done
- `[!]` blocked

By default, any `[!]` task pauses the runner. Set
`ORCHESTER_MAX_BLOCKED_TASKS` to allow that many blocked tasks to be skipped
while the queue continues with the next runnable task.

## Ways To Run It

### Inspect The Queue

```bash
bun run queue:status
```

Shows pending/done/blocked counts and the next pending task. This never calls
OpenCode.

### Preview The Next Task

```bash
bun run queue:dry-run
```

Prints the exact OpenCode command that would run next. This is the safest first
check after editing `queue.md`.

### Run One Task And Exit

```bash
bun run queue:next
```

Processes only the first pending task, marks it `[x]` on clean success, or `[!]`
on failure/blocker. This is best for debugging the queue one step at a time.

### Keep Running The Queue

```bash
bun run queue:run
```

Starts a long-lived session:

1. Load `queue.md`.
2. Run the first pending task.
3. Mark it done or blocked.
4. If done, wait for the configured delay.
5. Reload `queue.md` and continue with the next task.
6. Stop when the queue is complete or any task blocks.

This is the mode to use when you want to leave the machine working through the
queue while you are away.

### Stop After The Current Safe Point

```bash
bun run queue:stop
```

Requests a graceful stop for a running `queue:run`. It does not kill OpenCode or
mutate `queue.md`; it writes `.orchester/stop`, and `queue:run` exits before
starting another task. If a worker is already running, the runner waits for that
worker to finish and then stops.

Use this instead of Ctrl-C when you want to avoid interrupting a worker in the
middle of a file edit, validation run, commit, or OpenCode stream.

In an interactive `queue:run` session, Ctrl-C behaves similarly:

- First Ctrl-C requests a graceful stop and keeps the current worker alive.
- Second Ctrl-C after a moment interrupts immediately, removes the orchestrator
  lock, and tries to terminate the active OpenCode process.

### Show OpenCode Stats

```bash
bun run queue:stats
```

Prints `opencode stats` for `PROJECT_DIR` without touching `queue.md` or
starting a worker.

## Safety Behavior

Before spending tokens, the runner stops if:

- A task is already marked `[!]`.
- The local orchestrator lock exists.
- The queue contains an invalid task.
- The expected `$PROJECT_DIR/.opencode/commands/<command>.md` file is missing.

If another `opencode` process is active, the runner treats that as a temporary
busy state instead of a task failure. `queue:next` exits without editing
`queue.md`; `queue:run` waits and checks again.

During execution, stdout/stderr are streamed to the terminal and also written to:

```text
.orchester/runs/
```

The runner marks a task `[!]` if OpenCode exits non-zero or if output contains
known blocker signals such as `UnknownError`, `Unexpected server error`,
`permission requested`, `auto-rejecting`, `blocked`, or `blocker`.

## Configuration

Configuration lives in `.env`. Shell environment variables still work and take
precedence over `.env` values.

```bash
# Required: target repository where OpenCode commands run
PROJECT_DIR=/absolute/path/to/target-repo

# Required: OpenCode binary
OPENCODE_BIN=/opt/homebrew/bin/opencode

# Optional: model passed to `opencode run --model provider/model`
OPENCODE_MODEL=opencode-go/deepseek-v4-pro

# Optional: print OpenCode logs to stderr, useful for API/provider failures
OPENCODE_PRINT_LOGS=1
OPENCODE_LOG_LEVEL=ERROR

# Optional: poll `opencode stats` during long-running workers
OPENCODE_STATS=1
OPENCODE_STATS_INTERVAL_MS=120000
OPENCODE_STATS_TIMEOUT_MS=10000
OPENCODE_STATS_PROJECT=
OPENCODE_STATS_MODELS=5
# OPENCODE_STATS_DAYS=7

# Optional: queue file, default ./queue.md
QUEUE_PATH=/absolute/path/to/ai-workflow-orchester/queue.md

# Delay between successful tasks in queue:run, default 120000 ms
ORCHESTER_LOOP_DELAY_MS=120000

# Delay before rechecking when another opencode process is active, default 60000 ms
ORCHESTER_BUSY_DELAY_MS=60000

# Hard timeout per OpenCode task, default 5400000 ms (90 min)
ORCHESTER_TASK_TIMEOUT_MS=5400000

# Heartbeat while OpenCode is silent, default 60000 ms
ORCHESTER_HEARTBEAT_MS=60000

# Number of blocked tasks the queue may skip before pausing, default 0
ORCHESTER_MAX_BLOCKED_TASKS=0

# Advanced escape hatch: set to 1 to allow running even when pgrep sees opencode
ORCHESTER_ALLOW_ACTIVE_OPENCODE=0

# Known model IDs:
# QWEN 3.7 Plus: opencode-go/qwen3.7-plus
# DeepSeek v4 Pro: opencode-go/deepseek-v4-pro
# DeepSeek v4 Flash: opencode-go/deepseek-v4-flash
```

Example with a shorter delay:

```bash
ORCHESTER_LOOP_DELAY_MS=30000 bun run queue:run
```

Example using a faster model for one run:

```bash
OPENCODE_MODEL=opencode-go/deepseek-v4-flash bun run queue:next
```

When a worker is running and OpenCode produces no output, the runner prints a
heartbeat like:

```text
[2026-06-25T12:00:00.000Z] still running: 5m elapsed, 4m since last OpenCode output. Log: ...
```

This does not mean the task failed; it only proves the orchestrator is still
alive and tells you how long OpenCode has been silent.

If `OPENCODE_STATS=1`, the heartbeat also polls `opencode stats` periodically
and prints its token/cost summary. `OPENCODE_STATS_PROJECT=` is intentionally
empty by default; OpenCode treats an empty project filter as the current project,
and the runner calls it from `PROJECT_DIR`.

## Unblocking

When a task becomes `[!]`, inspect the linked log in `.orchester/runs/`, fix the
problem, then edit `queue.md` manually:

- Change `[!]` back to `[ ]` to retry the same task.
- Change `[!]` to `[x]` if you resolved it manually and want the queue to move
  on.
- Leave `[!]` in place to keep the queue paused.

The runner never kills old OpenCode sessions automatically. If `queue:run` keeps
waiting because another `opencode` process is active, close or kill that session
yourself, or set `ORCHESTER_ALLOW_ACTIVE_OPENCODE=1` if you intentionally want
to run anyway.
