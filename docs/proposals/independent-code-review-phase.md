# Proposal: independent code review and requested-changes loop

## Status

Proposed. This document compares implementation strategies; it does not change the delivery state machine yet.

## Problem

OpenSpec Shipper currently uses one configured executor for implementation and assisted recovery. Completion is inferred from tasks, checks and repository evidence, but there is no independent semantic review between implementation and publication. A worker can therefore write tests that confirm the same mistaken assumption as its implementation, mark every task complete and reach `push` without proving fidelity to the proposal, design or architectural owners.

The desired workflow is:

```text
prepare_worktree
  -> implement
  -> code_review
  -> implement_requested_changes (when changes are requested)
  -> code_review (until approved or budget exhausted)
  -> refresh_branch
  -> push
  -> waiting_for_merge
  -> archive
  -> publish_archive
  -> cleanup_worktree
```

The reviewer must be independently configurable and should normally be a stronger model than the implementation worker. Approval must be represented by machine-readable evidence rather than inferred from a friendly prose summary.

## Shared review contract

All alternatives should use the same logical result:

```ts
type ReviewVerdict =
  | {
      verdict: "approved";
      reviewedHeadSha: string;
      findings: [];
    }
  | {
      verdict: "changes_requested";
      reviewedHeadSha: string;
      findings: ReviewFinding[];
    }
  | {
      verdict: "blocked";
      reviewedHeadSha: string;
      reason: string;
    };

type ReviewFinding = {
  id: string;
  severity: "blocking" | "non_blocking";
  title: string;
  explanation: string;
  requirementRefs: string[];
  file?: string;
  line?: number;
};
```

An approval is valid only for the exact `reviewedHeadSha`. Any implementation commit invalidates it. Review prompts must inspect the final diff, OpenSpec artifacts, repository instructions, tests and build evidence. They must distinguish correctness findings from optional style suggestions.

Configuration should separate roles without breaking existing configurations:

```json
{
  "executor": {
    "provider": "opencode",
    "opencode": { "model": "opencode-go/mimo-v2.5-pro" }
  },
  "review": {
    "enabled": true,
    "provider": "codex-cli",
    "maxCycles": 2,
    "codex": {
      "model": "gpt-5.6-luna",
      "reasoningEffort": "high"
    }
  }
}
```

When `review.enabled` is absent or false, the current lifecycle remains unchanged during migration. `doctor` must validate reviewer availability and effort/model compatibility before queue execution.

## Alternative A: local review in the delivery worktree

The implementation branch stays local. After tasks and checks pass, Shipper invokes the reviewer read-only against the worktree and persists the structured verdict under `.openspec-shipper/reviews/<change>/<head>.json`. Requested changes are passed to a newly configured implementation invocation in the same worktree. Only an approved SHA proceeds to refresh and push.

### Advantages

- Fastest feedback and no GitHub dependency.
- No public review noise or partially reviewed remote branches.
- Works for repositories without GitHub and before credentials are configured.
- Findings can be handed directly to the implementation worker with stable IDs.
- Easy to make the reviewer genuinely read-only by snapshotting the worktree before and after invocation.

### Disadvantages

- Review evidence is local unless copied into logs or commit metadata.
- A crash or machine change needs explicit persistence/reconciliation of verdict files.
- Humans cannot naturally join the discussion through the PR interface.
- Review happens before `refresh_branch`; integration with the latest base can invalidate assumptions and require another review.

### Required state/evidence

- New phases: `code_review`, `implement_requested_changes`.
- Evidence: current head SHA, review artifact, verdict, cycle count and protected-worktree snapshot.
- Reconciliation: approved SHA advances; requested changes route to implementation; a changed SHA invalidates prior approval.
- After `refresh_branch`, rerun checks and review if the merge created a new tree rather than a metadata-only fast-forward.

## Alternative B: GitHub-native PR review

Shipper refreshes and pushes first, creates the PR, then asks the reviewer to publish a GitHub review using `APPROVE` or `REQUEST_CHANGES` plus inline comments. Requested changes return execution to the delivery worktree, are pushed to the same branch and trigger a new review of the new SHA.

Suggested lifecycle:

```text
implement -> refresh_branch -> push -> code_review_pr
  -> implement_requested_changes -> refresh_branch -> push -> code_review_pr
  -> waiting_for_merge
```

### Advantages

- Review evidence is durable, visible and familiar to humans.
- Branch protection can require approval and prevent accidental auto-merge.
- Inline comments provide excellent context and humans can participate.
- GitHub already associates reviews with commits and dismisses stale approvals when configured.

### Disadvantages

- Requires `gh`, authentication, network access and GitHub-specific behavior.
- More failure modes: rate limits, permissions, stale reviews and duplicated comments.
- `autoMergePr` is dangerous unless enabled only after an approval for the current SHA.
- Repeated model cycles can clutter the PR and notification history.
- Supporting non-GitHub forges later requires another abstraction.

### Required state/evidence

- PR number/URL, reviewed commit OID, review database ID, verdict and cycle count.
- Idempotency keys in review summaries to avoid duplicate reviews after restart.
- Reconciliation from GitHub review state, with explicit handling for human approvals, dismissals and new commits.
- `autoMergePr` must move after approved review evidence or rely on protected-branch required reviews.

## Alternative C: hybrid local gate plus optional GitHub publication

Run the authoritative model review locally before push, then optionally publish its final summary to the PR. GitHub remains the human collaboration and merge surface, but Shipper's state machine depends on its local structured review artifact rather than comments.

### Advantages

- Keeps the fast, provider-neutral local loop.
- Provides durable visibility when GitHub is available.
- GitHub comment failures need not discard a valid review verdict.
- Allows gradual adoption: local review first, PR integration later.

### Disadvantages

- Two representations of review evidence can drift.
- A local approval is not automatically a GitHub protected-branch approval.
- Publishing comments adds complexity without becoming the source of truth.
- Requires a clear policy for changes introduced by refresh or CI after local approval.

## Recommendation

Implement Alternative A first, with the review result stored locally and bound to the exact tree/SHA. It fits Shipper's evidence-driven, provider-neutral architecture and adds the smallest new external surface. Place `code_review` after a refresh of the completed branch, or require a second review whenever refresh changes the tree, so approval always covers what will be pushed.

Add Alternative C as an optional follow-up that publishes the approved summary and blocking findings after PR creation. Defer GitHub-native reviews as the authoritative state (Alternative B) until there is a concrete need for required-review integration; it is valuable, but materially expands reconciliation and permissions.

Recommended steady-state lifecycle:

```text
prepare_worktree
  -> implement
  -> refresh_branch
  -> code_review
  -> implement_requested_changes
  -> refresh_branch
  -> code_review
  -> push
  -> waiting_for_merge
  -> archive
  -> publish_archive
  -> cleanup_worktree
```

`implement_requested_changes` should be a distinct phase rather than reusing `implement`: the prompt, completion criterion and attempt budget differ. It receives unresolved blocking findings, must address or explicitly dispute each finding, runs repository checks, commits the result and leaves the findings open for the reviewer to adjudicate. The implementer cannot mark its own finding resolved.

## Delivery increments

### Increment 1: contracts and configuration

- Add reviewer role configuration with backward-compatible defaults.
- Generalize provider command construction so a phase selects a role-specific provider/model.
- Define and validate the structured verdict schema.
- Make `doctor` reject unsupported model effort, missing reviewer binaries and identical reviewer/implementer configurations when independence is required.

### Increment 2: local review gate

- Add `code_review` to phase types, ranking, definitions and reconciliation.
- Generate a read-only review prompt covering OpenSpec traceability, architecture, regression risk and tests.
- Persist review evidence atomically by change and SHA.
- Snapshot protected checkouts and reject reviewer mutations.

### Increment 3: requested-changes loop

- Add `implement_requested_changes` with finding IDs and a separate attempt/cycle budget.
- Invalidate approval on every new commit and preserve resolved/unresolved history.
- Block after `maxCycles`, provider failure or repeated unchanged SHA; never convert exhaustion into approval.

### Increment 4: optional GitHub visibility

- Post one idempotent review summary or check-run annotation per reviewed SHA.
- Keep local structured evidence authoritative initially.
- Document the interaction with branch protection and `autoMergePr`.

## Safety and acceptance criteria

- The reviewer cannot edit product code, commit, push, merge or mark OpenSpec tasks complete.
- The implementer cannot approve its own work or alter persisted review evidence.
- A verdict for an old SHA never advances a newer SHA.
- Non-blocking findings do not prevent delivery; blocking findings do.
- Provider/configuration failures block without consuming requested-change cycles.
- Restarts reconcile to the same phase without duplicating reviews or comments.
- Existing projects with review disabled preserve the current lifecycle exactly.
- Tests cover approval, requested changes, unchanged retries, new commits, refresh invalidation, provider failure, max cycles and optional GitHub publication.

