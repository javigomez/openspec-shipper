# OpenSpec Shipper Setup

This repository has OpenSpec Shipper assets installed:

- `.openspec-shipper/config.json`
- `.openspec-shipper/openspec-config.example.yaml`
- `.opencode/commands`
- `.opencode/agents`
- `.opencode/rules`
- `.github/workflows/open-pr-on-branch-push.yml`

Run from the target repository after installing the npm package:

```bash
npx openspec-shipper doctor
```

Start conservatively with:

```bash
npx openspec-shipper queue dry-run
npx openspec-shipper queue next
```
