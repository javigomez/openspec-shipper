# OpenSpec Shipper Claude Code Workflow

OpenSpec Shipper owns the delivery state machine. Claude Code is called only for
the intelligent `implement` and `archive` phases.

## Ownership

- `origin/<baseBranch>` is the integration boundary. The human checkout may be
  on any branch and is never a Shipper execution surface.
- Planning may originate in main, an ordinary branch, or a worktree; Shipper
  adopts one committed snapshot.
- Product implementation happens only in `worktrees/<change-name>`.
- Shipper creates worktrees, conditionally refreshes delivery branches, pushes,
  creates PRs with `gh`, publishes archive commits, and cleans worktrees.
- Archive runs in a detached integration worktree created from the latest
  remote base, never in the human checkout.
- Claude must not duplicate native Shipper phases.

## Safety

- Use repository-relative paths and `.openspec-shipper/tmp/` for temporary files.
- Never read `.env` or `.openspec-shipper/.env`.
- Do not push, create pull requests, merge, or remove worktrees.
- Preserve unrelated user changes.
- Follow `CLAUDE.md` and `AGENTS.md` when they exist unless they conflict with
  these phase boundaries.

## Git

Implementation branches use `<type>/<change-name>` and worktrees use
`worktrees/<change-name>`. Use Conventional Commits and keep useful progress
committed during `implement`.

## Completion Contract

Return the structured result required by the CLI invocation:

- `status`: `completed` or `blocked`.
- `summary`: a concise account of work and validation.
- `reason`: `null` after success or the actionable blocker reason.

When blocked, also end the textual result with:

```text
OPENSPEC_SHIPPER_BLOCKED: <short reason>
```
