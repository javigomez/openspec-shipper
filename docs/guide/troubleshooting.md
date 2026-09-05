# Troubleshooting

Goal of this page: get back to shipping when an update appears to be missing or a queue run seems to have stopped. Most of the time, the fix is simply using the command that belongs to the layer that needs changing.

## There are two kinds of update

OpenSpec Shipper has two update steps, and they do different jobs:

- `npm update` changes the version of the Shipper package installed in your repository.
- `openspec-shipper update` copies the templates and provider assets from that installed package into your project.

Running the second command does not download a newer npm package. It can only update from the version already present in `node_modules`.

## Update to a newly published version

Start by asking the npm registry which version is public:

```bash
npm view openspec-shipper version
```

Then update the dependency and refresh the installed Shipper files:

```bash
npm update openspec-shipper --latest --force
npx openspec-shipper update --force
npx openspec-shipper doctor
```

You can confirm which version your repository is actually using:

```bash
npm list openspec-shipper
```

If npm still keeps an older version, install the version explicitly. This is useful when `package-lock.json` or the version range in `package.json` is holding the dependency back:

```bash
npm install -D openspec-shipper@1.0.6 --force
npx openspec-shipper update --force
```

Replace `1.0.6` with the version you want to use. To run a published version explicitly without relying on the local binary, use:

```bash
npx --yes openspec-shipper@1.0.6 update --force
```

## When the npm cache is suspected

npm normally verifies its cache and downloads a package again when the cached content is invalid. Clearing the cache is therefore rarely necessary, but you can do it when you want to rule it out:

```bash
npm cache verify
npm cache clean --force
npm install -D openspec-shipper@1.0.6 --force
```

For a completely clean test, use a temporary cache instead of touching your normal npm cache:

```bash
npm_config_cache="$(mktemp -d)" npm install -D openspec-shipper@1.0.6 --force
```

If `npm view openspec-shipper version` still returns an older version, the problem is not your local cache: the registry has not received the version yet, or the package was published with a different dist-tag.

## The queue looks stuck

An unchanged terminal line does not always mean that Shipper is blocked. An executor can spend several minutes thinking or running checks without writing a new line to the terminal. Start with the evidence that Shipper leaves for you:

```bash
npx openspec-shipper queue status
npx openspec-shipper queue dry-run
npx openspec-shipper doctor
```

Then open `.openspec-shipper/queue.md`. Look at the task's `phase`, timestamps, status badge, and log link. The run log is usually more informative than the terminal because it contains the executor output and the last operation that was attempted.

To watch a log while it is being written:

```bash
tail -f .openspec-shipper/runs/<run-log>.log
```

For OpenCode, Shipper enables the executor's `ERROR` diagnostic stream by
default and watches it live. A terminal quota, authentication, permission,
model-availability, or provider error should therefore stop the current phase
and appear in the run log within seconds, even when OpenCode itself would stay
alive. Shipper does not send these failures to assisted recovery because a
second model invocation cannot repair them. If an OpenCode run still shows
only heartbeats after a provider error, check that
`OPENSPEC_SHIPPER_PRINT_LOGS` has not been set to `false` and inspect the
installed OpenCode version and its log format.

The queue's lock also tells you whether a runner is still alive:

```bash
cat .openspec-shipper/shipper.lock
ps -p <pid> -o pid=,etime=,command=
```

Use the `pid` from the lock. Do not kill a random executor process just because it is using CPU; the lock identifies the queue runner that owns this project.

## Stop a run safely

The normal stop is cooperative. It creates a stop request and lets the runner finish its current safe checkpoint:

```bash
npx openspec-shipper queue stop
```

This is the best choice when the current phase is close to completion. The command may return immediately while the queue continues finishing the current executor task.

If the runner is not progressing, the executor is unresponsive, or you need to regain control immediately, use the forced stop:

```bash
npx openspec-shipper queue stop --force
```

The forced stop reads the active `shipper.lock`, verifies that its process is alive on this machine, and sends it `SIGTERM`. The runner interrupts the active child process, removes its lock, and exits. It does not silently delete your queue or reset your worktree.

Because the current phase may have been interrupted halfway through, inspect the project before restarting:

```bash
npx openspec-shipper doctor
npx openspec-shipper queue status
npx openspec-shipper queue dry-run
npx openspec-shipper queue run
```

Reconciliation uses the repository and GitHub evidence again, so you should not manually edit the phase just because the run was interrupted. If the task is genuinely blocked, Shipper marks it `[!]` and writes the reason and log link into `queue.md`.

## The queue is blocked, but the terminal did not say so

Sometimes the last visible message is just `waiting`, or the terminal closes without printing a blocker. Treat the queue file as the starting point:

1. Check whether the task has `[!]`, `phase`, `reason`, and `log` metadata.
2. Open the linked log and look at its final lines.
3. Run `queue status` and `queue dry-run` to force a fresh reconciliation.
4. If the underlying issue is fixed, change `[!]` to `[ ]` and run the queue again.

For a PR-related wait, use the PR link written in the queue and merge it on GitHub. Then run:

```bash
npx openspec-shipper queue run
```

Shipper will infer that the task can move forward. You do not need to guess whether it should resume at sync, archive, or cleanup.

## A short recovery recipe

When you are unsure what happened, use this order:

```bash
npx openspec-shipper doctor
npx openspec-shipper queue status
npx openspec-shipper queue dry-run
npx openspec-shipper queue stop
```

If the process is still alive and not moving, replace the last command with:

```bash
npx openspec-shipper queue stop --force
```

After a forced stop, inspect the last log, fix the underlying issue, and run `doctor`, `dry-run`, and finally `queue run` again. If the problem remains unclear, share the `reason` from `queue.md` and the linked log with your AI assistant; those two artifacts usually contain enough context to diagnose it without starting over.
