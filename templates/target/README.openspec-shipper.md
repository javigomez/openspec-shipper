# Orchester Setup

This repository has Orchester assets installed:

- `.orchester/config.json`
- `.opencode/commands`
- `.opencode/agents`
- `.opencode/rules`
- `.github/workflows/open-pr-on-branch-push.yml`
- `.github/workflows/pr-checks.yml`

Run from the Orchester repository:

```bash
bun run target:doctor /absolute/path/to/this/repo
```

Start conservatively with:

```bash
bun run queue:dry-run
bun run queue:next
```
