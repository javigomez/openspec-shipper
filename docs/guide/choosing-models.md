# Pick the Right Model for Each Job

Goal of this page: spend expensive model capacity where it pays off, and cheap capacity where it doesn't matter.

## The principle: plan expensive, implement cheap

A good OpenSpec change does the hard thinking up front: the proposal explains *why*, the design settles *how*, and `tasks.md` breaks the work into small, verifiable steps. Once that exists, implementation is mostly following instructions — and following instructions is exactly what smaller, cheaper models are good at.

So split your model budget:

- **Planning** (writing proposals, designs, and tasks): use your most capable model, in whatever tool you plan with. This is where quality is decided.
- **Implementation** (Shipper's `implement` and `archive` phases): configure a cheaper, faster model. The spec keeps it on rails, the repository checks catch its mistakes, and your PR review is the final gate.

If a cheap model repeatedly fails a particular change, that's usually feedback about the spec — tasks too big, ambiguous acceptance criteria — more often than about the model.

## Configuring the model per provider

You can set the model at `init` time, in `.openspec-shipper/config.json`, or override it per run with environment variables. Precedence is: CLI flags > `OPENSPEC_SHIPPER_*` env vars > `.openspec-shipper/.env` > `config.json` > defaults.

### OpenCode

```json
{
  "executor": {
    "provider": "opencode",
    "opencode": {
      "model": "opencode-go/deepseek-v4-pro"
    }
  }
}
```

Or per run:

```bash
OPENSPEC_SHIPPER_OPENCODE_MODEL=opencode-go/deepseek-v4-pro npx openspec-shipper queue run
```

OpenCode is the easiest place to experiment with cheap implementation models, since it can route to many providers — try a budget model on a low-stakes change and compare `queue stats` runs.

### Codex CLI

```json
{
  "executor": {
    "provider": "codex-cli",
    "codex": {
      "model": "gpt-5.5",
      "reasoningEffort": "low"
    }
  }
}
```

Or per run:

```bash
OPENSPEC_SHIPPER_CODEX_MODEL=gpt-5.5 \
OPENSPEC_SHIPPER_CODEX_REASONING_EFFORT=low \
npx openspec-shipper queue run
```

`reasoningEffort` is the cheap lever here: `low` is usually plenty for well-specified tasks.

### Claude Code

```json
{
  "executor": {
    "provider": "claude-code",
    "claude": {
      "model": "sonnet",
      "effort": "low"
    }
  }
}
```

Also settable at init (`npx openspec-shipper init --provider claude-code --model sonnet --effort low`) or per run:

```bash
OPENSPEC_SHIPPER_CLAUDE_MODEL=sonnet \
OPENSPEC_SHIPPER_CLAUDE_EFFORT=low \
npx openspec-shipper queue run
```

`sonnet` with low effort is a solid implementation default; reserve bigger models for changes you already know are gnarly.

## Measure before you decide

```bash
npx openspec-shipper queue stats
```

Stats show what each run cost. Try the same kind of change on two models and let the numbers — and your PR reviews — pick the winner.

## What's next

One last page on habits: [Ship like a team of two](./ship-like-a-team.md).
