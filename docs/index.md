---
layout: doc
title: OpenSpec Shipper
titleTemplate: Documentation
---

# OpenSpec Shipper

OpenSpec Shipper turns committed OpenSpec changes into isolated implementation
worktrees, pull requests, canonical specifications, and cleaned local state. It
reconciles the queue against Git and GitHub before every action, so Markdown
remains the human-readable control surface without becoming a fragile state
database.

```bash
npm install -D openspec-shipper
npx openspec-shipper init
npx openspec-shipper doctor
npx openspec-shipper queue add my-change
npx openspec-shipper queue run
```

## What it owns

- An editable delivery queue in `.openspec-shipper/queue.md`.
- Dedicated worktrees for implementation and archive integration.
- Native Git refresh, push, pull-request creation, publication, and cleanup.
- Intelligent `implement` and `archive` phases powered by OpenCode, Codex CLI,
  or Claude Code.
- Explicit human handoffs when a merge or repair is required.

Start with [Getting started](./guide/getting-started.md), then read the
[delivery flow](./guide/delivery-flow.md) to understand each phase.
