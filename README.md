**Languages:** English | [Español](https://github.com/javigomez/openspec-shipper/blob/main/README.es.md) | [Català](https://github.com/javigomez/openspec-shipper/blob/main/README.ca.md) | [简体中文](https://github.com/javigomez/openspec-shipper/blob/main/README.zh.md)

# openspec-shipper

**Ship OpenSpec changes on autopilot.** You write the spec, `openspec-shipper` queues it, hands it to an AI coding agent, opens the PR, and archives the change once it's merged — hands off.

![openspec-shipper in action](https://raw.githubusercontent.com/javigomez/openspec-shipper/main/docs/images/openspec-shipper-teaser.gif)

Free, MIT-licensed, and open source. Fork it, hack it, send a PR.

## What it does

You already use [OpenSpec](https://github.com/Fission-AI/OpenSpec) to write change proposals and tasks. `openspec-shipper` takes it from there:

1. Add a change to the delivery queue.
2. Shipper spins up an isolated worktree and hands the change to your AI executor of choice — [OpenCode](https://opencode.ai), [Codex CLI](https://github.com/openai/codex), or [Claude Code](https://claude.com/product/claude-code).
3. The agent implements it, Shipper pushes the branch and opens a PR with `gh`.
4. You review and merge.
5. Shipper archives the spec and cleans up the worktree — no manual branch juggling.
6. It moves on to the next item in the queue.

Your working checkout is never touched. Everything happens in dedicated worktrees, so you can keep planning your next change while Shipper delivers the current one.

## Built with Codex and GPT-5.6

I built `openspec-shipper` with [Codex](https://github.com/openai/codex) as an active engineering partner. GPT-5.6 helped me reason through the architecture, challenge design decisions, investigate failures, review edge cases, and turn a personal workflow problem into a product that other developers can use.

Codex helped turn those decisions into TypeScript code, tests, provider integrations, npm packaging, documentation, and demo repositories. It was involved across the full development lifecycle: planning, implementation, debugging, testing, refactoring, and release preparation.

Codex is also central to the product itself. Shipper can hand each queued OpenSpec change to Codex CLI inside an isolated worktree, while the runner takes care of the mechanical Git and GitHub steps. The project was built with Codex, and now helps other developers use Codex more effectively: spending tokens on meaningful implementation work instead of repetitive coordination.

## See it in action (1 minute)

Check out **[clean-repo-for-openspec-shipper-demo](https://github.com/javigomez/clean-repo-for-openspec-shipper-demo)** — a tiny repo pre-loaded with OpenSpec changes ready to be shipped. Clone it and follow the steps in its README to watch the whole flow end to end in about a minute.

## Try it yourself

```bash
npm install -D openspec-shipper
npx openspec-shipper init
npx openspec-shipper doctor
```

`init` walks you through picking an AI executor (OpenCode, Codex CLI, or Claude Code) and a package manager, then installs everything the queue needs. `doctor` checks that your setup — `git`, `gh`, and the chosen executor — is ready to go.

Once you have an OpenSpec change ready to ship:

```bash
npx openspec-shipper queue add <your-change-name>
npx openspec-shipper queue run
```

That's it. Shipper takes it from queued to merged.

## Requirements

- `git`
- [`gh`](https://cli.github.com/) (GitHub CLI), authenticated
- One of: OpenCode, Codex CLI, or Claude Code subscription

## Contributing

I am Javi Gómez, a solo developer in love with OpenSpec. I created this package to save me from doing non-valuable tasks, and being able to focus on creating changes and specs instead. I decided to share it with you all because I want you to save a lot of time like I did.

Issues, PRs, and forks are all welcome — this is a young project and the roadmap is wide open. If you build something on top of it or bend it into a shape that works better for your workflow, I'd love to hear about it.

## Full documentation

Command reference, configuration options, queue internals, provider setup, and everything else lives in the documentation site:

**https://javigomez.github.io/openspec-shipper/**
