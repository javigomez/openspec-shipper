# Blocked Tasks

Automation can encounter repository state, permissions, network failures, merge
conflicts, or incomplete work that requires a human decision. Shipper marks any
such handoff with `[!]`.

```md
- [!] deliver add-name-greeting <!-- phase: push; reason: ...; log: runs/... -->
  > Fixed? Change `[!]` to `[ ]` and run `openspec-shipper queue run` again.
```

## Recovery

1. Read the `reason` in the task's metadata comment.
2. Follow the relative `log` link for the complete execution output.
3. Fix the underlying problem yourself or give the reason and log to an AI
   assistant for diagnosis.
4. Change `[!]` to `[ ]`.
5. Run `npx openspec-shipper queue run` again.

Do not manually guess or preserve a phase unless you need an explicit override.
Shipper reconciles Git and GitHub evidence before retrying and can advance,
regress, or complete the task accordingly.

## Common causes

- `gh` is not authenticated or lacks repository access.
- Git identity is not configured.
- Required installed assets have not been committed to the remote base branch.
- A provider CLI is missing, unauthenticated, or incompatible.
- The target repository checks fail inside the implementation worktree.
- A pull request is waiting for a human merge.

Run `npx openspec-shipper doctor` after changing machine or repository
configuration. Claude users should run `doctor --deep` after changing the CLI,
model, sandbox, or prompt contract.
