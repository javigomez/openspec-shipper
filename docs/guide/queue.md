# Queue

The default queue is `.openspec-shipper/queue.md`:

```md
# OpenSpec Shipper Queue

- [ ] deliver add-name-greeting
- [ ] deliver add-spanish-greeting <!-- depends_on: add-name-greeting -->
```

You can edit it directly or use `queue add`:

```bash
npx openspec-shipper queue add add-name-greeting
npx openspec-shipper queue add add-spanish-greeting --depends-on add-name-greeting
```

## Human intent

- `depends_on` prevents the whole dependent delivery from starting early.
- `source_branch` selects an otherwise ambiguous committed planning branch.
- `archive_after` serializes only canonical-spec publication.
- An explicit empty `archive_after:` disables inferred archive ordering for that
  task.

```md
- [ ] deliver change-b <!-- source_branch: planning/change-b -->
- [ ] deliver change-c <!-- archive_after: change-b -->
- [ ] deliver independent-change <!-- archive_after: -->
```

## Status

- `[ ]` means Shipper may reconcile and run the task.
- `[x]` means delivery and cleanup are complete.
- `[!]` means human intervention is required, including expected PR merges.

Badges, timestamps, reasons, phase metadata, and log links are maintained by
Shipper. When the issue is resolved, change `[!]` back to `[ ]` and rerun the
queue. Reconciliation decides the correct phase from current evidence.
