# OpenSpec Shipper Setup

This repository has OpenSpec Shipper assets installed:

- `.openspec-shipper/config.json`
- `.opencode/commands`
- `.opencode/agents`
- `.opencode/rules`
- `.github/workflows/open-pr-on-branch-push.yml`
- `.github/workflows/pr-checks.yml`

Run from the target repository after installing the npm package:

```bash
npx openspec-shipper doctor
```

Start conservatively with:

```bash
npx openspec-shipper queue dry-run
npx openspec-shipper queue next
```
