# OpenSpec Shipper Workflow

This repository is prepared for OpenSpec Shipper, an OpenSpec execution queue
that runs one change through apply, ship, sync, and archive phases.

## Contract

- OpenSpec proposal, sync, status, validation, and archive operations run from
  the clean root checkout on `main`.
- Implementation runs in deterministic worktrees under `worktrees/<change-name>`.
- Branches use `<type>/<change-name>`, where type is one of `feat`, `fix`,
  `docs`, `refactor`, `test`, `chore`, `ci`, `build`, or `perf`.
- Pull requests are created by the branch-push workflow after a completed
  worktree branch is pushed.
- Archive happens only after the implementation PR has merged into `main`.

## Expected Scripts

The default OpenSpec Shipper profile expects these package scripts:

- `openspec:cli`
- `openspec:validate-proposal`
- `lint:branch`
- `test:types`
- `lint`
- `format:check`
- `test:unit`

If this repository uses different commands, update `.openspec-shipper/config.json`
and the GitHub workflows together.
