# Plan Changes While Shipper Ships

Goal of this page: keep defining new OpenSpec changes — wherever it's most comfortable — while Shipper delivers the ones already queued.

## Where to write a change

Shipper never touches your working checkout, so you can plan wherever feels natural:

- **On `main`** — fine for solo work. Write the change under `openspec/changes/<name>`, validate, commit, push.
- **On a planning branch** — e.g. `spec/<change-name>`. Useful when a proposal needs review before it ships, or when you draft several at once.
- **In a separate worktree** — if you like keeping planning physically apart from your main checkout.

Whatever you choose, the rule is the same: **the planning snapshot must be committed**. Shipper adopts the committed state of a change; any uncommitted edit under that change blocks adoption, on purpose — it will never silently implement an older draft while you're still editing.

## The handoff

1. Create the OpenSpec change (proposal, `tasks.md` with checkboxes, optionally `design.md`).
2. Validate it with OpenSpec and commit the complete snapshot.
3. Add it to the queue — edit `queue.md` or run `queue add <name>`.
4. Run the queue (or leave it running). Shipper resolves the source once and records `source_branch` and `source_commit` on the task.

If the same change exists in more than one plausible place, Shipper stops and asks you to disambiguate with `source_branch` in the queue instead of guessing.

`tasks.md` is the contract: Shipper tracks progress through its checkboxes (`- [ ]` → `- [x]`). A `tasks.md` without checkboxes blocks immediately, because the queue can't know what work remains.

## Keep planning while it delivers

This is the core loop that makes Shipper worth it:

1. Queue change A. Shipper starts implementing it in its own worktree.
2. While it works, you write the spec for change B on main or a branch.
3. Queue B. Review A's PR when it arrives. Merge.
4. Repeat.

You're always doing high-value work (specs, reviews); Shipper is always doing the mechanical work (worktrees, branches, PRs, archiving). Later commits to a change's planning are reported but never silently adopted into an in-flight delivery — you stay in control of what ships.

## What's next

Sooner or later a task will show `[!]`. Don't worry — that's the design working: [When the queue blocks](./blocked-queue.md).
