# CLI Reference

## Project commands

```bash
openspec-shipper init
openspec-shipper update [--force]
openspec-shipper doctor [--deep]
```

`init` is interactive in a terminal. Use `--yes` plus explicit options for
automation.

## Queue commands

```bash
openspec-shipper queue add <change-name>
openspec-shipper queue next
openspec-shipper queue run
openspec-shipper queue status
openspec-shipper queue dry-run
openspec-shipper queue stop
openspec-shipper queue stats
```

- `next` executes at most one runnable phase.
- `run` continues across independent paths until no runnable work remains.
- `dry-run` reconciles evidence and prints the next command without executing it.
- `stop` requests a safe stop at the next queue checkpoint.

`add`, `next`, `run`, `status`, `dry-run`, `stop`, and `stats` are also available
as top-level aliases.

## External mode

The package can operate from outside the target repository:

```bash
openspec-shipper --project /path/to/project \
  --queue /path/to/project/.openspec-shipper/queue.md \
  queue dry-run
```
