# Master the Queue

Goal of this page: feel at home in `.openspec-shipper/queue.md` — the file where you tell Shipper what to ship and in which order.

## The queue is just Markdown

The queue lives at `.openspec-shipper/queue.md` and looks like this:

```md
# OpenSpec Shipper Queue

- [ ] deliver add-name-greeting
- [ ] deliver add-spanish-greeting <!-- depends_on: add-name-greeting -->
```

Editing it by hand is a first-class workflow, not a hack. Open it in your editor, add a line, reorder, delete — Shipper reconciles the file against Git and GitHub evidence before every command, so you can't easily break it.

## Add work

Either write the line yourself, or use the convenience command:

```bash
npx openspec-shipper queue add add-spanish-greeting
npx openspec-shipper queue add add-shouting-greeting --depends-on add-spanish-greeting
```

`queue add` creates the queue file if needed and skips duplicates.

## Order work

- `depends_on: <change>` — don't start this delivery until the other change is done.
- `archive_after: <change>[,<change>]` — let implementations run in parallel, but serialize only the spec archiving.
- `archive_after:` (empty) — explicitly disable an archive ordering Shipper inferred, after you reviewed it.
- `source_branch: <branch>` — point Shipper at the right planning branch when more than one could contain the change.

```md
- [ ] deliver change-b <!-- source_branch: planning/change-b -->
- [ ] deliver change-c <!-- archive_after: change-b -->
```

## Read the queue's state

The checkbox tells you everything at a glance:

- `[ ]` — Shipper may work on it.
- `[x]` — delivered, merged, archived, cleaned up.
- `[!]` — waiting for you. Read the comment on the task to see why (often just "merge the PR"). See [When the queue blocks](./blocked-queue.md).

Shipper maintains the metadata comments (phase, timestamps, PR links, log links). You only ever need to touch the checkbox and the human-intent fields above.

## Run and control

```bash
npx openspec-shipper queue run       # work until nothing is runnable
npx openspec-shipper queue next      # execute at most one phase, then stop
npx openspec-shipper queue status    # what's where
npx openspec-shipper queue dry-run   # show what would happen, spend nothing
npx openspec-shipper queue stop      # request a safe stop at the next checkpoint
npx openspec-shipper queue stats     # token/usage stats
```

`dry-run` is your friend while learning: it reconciles and prints the next action without executing anything or spending tokens.

## What's next

The queue needs OpenSpec changes to feed on. Learn where and how to write them: [Plan changes while Shipper ships](./plan-changes.md).
