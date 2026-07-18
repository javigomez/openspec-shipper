# OpenSpec Shipper Claude Phase: archive

Archive OpenSpec change `{{CHANGE_NAME}}` in repository `{{PROJECT_DIR}}`.

Read `.openspec-shipper/claude/workflow.md`, project instructions, and the
OpenSpec artifacts before acting. This phase runs from the configured base
branch after the implementation pull request has merged.

## Work

1. Confirm the current checkout is the configured base branch and is clean.
2. If the active change is absent, check `openspec/changes/archive/`; an existing
   valid archive means the intelligent work is already complete.
3. Verify all task checkboxes are complete.
4. Validate the change using `.openspec-shipper/config.json`.
5. Run the configured OpenSpec archive operation non-interactively.
6. Verify the resulting diff only changes OpenSpec archive and canonical spec
   paths.
7. Leave the archive diff for Shipper to finalize.

Do not run `git fetch`, `git pull`, `git rebase`, `git commit`, or `git push`.
Do not use `gh`, create pull requests, or remove worktrees or branches.
