# OpenSpec Shipper Claude Phase: implement

Implement OpenSpec change `{{CHANGE_NAME}}` in repository `{{PROJECT_DIR}}`.

Read `.openspec-shipper/claude/workflow.md`, project instructions, and all
OpenSpec artifacts for the change before editing.

## Preconditions

1. Confirm `worktrees/{{CHANGE_NAME}}` exists.
2. Work only inside that prepared worktree.
3. Validate the change with the command configured in
   `.openspec-shipper/config.json`.
4. If the worktree is missing or unsafe, return `blocked` without editing main.

## Work

1. Read proposal, design, delta specs, and tasks.
2. Implement unchecked tasks in small coherent steps.
3. Run the narrowest relevant project checks.
4. Mark a task complete only after its implementation and validation succeed.
5. Commit useful progress with a Conventional Commit.
6. Finish only when all tasks are complete and the worktree is clean.

Do not create branches or worktrees. Do not push, create a pull request, merge,
archive OpenSpec, or edit the root base-branch checkout.
