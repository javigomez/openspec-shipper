# Project Story: openspec-shipper

![openspec-shipper in action](https://raw.githubusercontent.com/javigomez/openspec-shipper/main/docs/images/openspec-shipper-teaser.gif)

## Inspiration

I built **openspec-shipper** because I became the bottleneck in my own AI-assisted development workflow.

I had started using [OpenSpec](https://github.com/Fission-AI/OpenSpec) to describe changes as structured proposals: intent, design, tasks, and a definition of done. AI agents were already capable of implementing those changes. But between one specification and the next, I was still doing a surprising amount of manual coordination: creating branches, preparing worktrees, checking Git state, installing dependencies, pushing branches, opening pull requests, waiting for merges, synchronizing `main`, archiving OpenSpec changes, and cleaning up old worktrees.

While one agent was coding, I was already writing the next specification. Then something would interrupt the flow: a dirty checkout, a stale branch, a merge conflict, a missing dependency, or a GitHub authentication problem. I had to stop thinking about the product and start managing the machinery around the agents.

That was the problem I wanted to fix.

## What it does

**openspec-shipper** adds a delivery layer on top of OpenSpec. I can write several changes, add them to a queue, and let Shipper move each one through a complete lifecycle:

```text
prepare worktree
-> implement with Codex
-> refresh branch
-> push
-> wait for human review and merge
-> archive the OpenSpec change
-> clean up
```

Each change is implemented in its own isolated Git worktree, so my main checkout remains available for planning and writing the next specification. [Codex](https://github.com/openai/codex) gets a focused task and a clean working environment. Git and GitHub operations are handled by the runner, while the AI is reserved for the parts that require judgment: implementing the specification and reconciling OpenSpec archives.

The queue remains visible as a Markdown file. It shows what is pending, what is running, what is waiting for a pull request, and what is blocked. Before every operation, Shipper reconciles the evidence available in Git, GitHub, worktrees, branches, and archived specs instead of blindly trusting a stale status marker.

## How we built it

I built Shipper as an [npm package](https://www.npmjs.com/package/openspec-shipper) with a TypeScript codebase and a domain-driven architecture. The domain models queue tasks, delivery phases, dependencies, and reconciliation rules. The application layer coordinates use cases such as running the queue, preparing a worktree, checking the environment, and archiving a change. Infrastructure adapters handle the filesystem, Git, GitHub CLI, environment configuration, and AI providers.

Codex is the primary coding provider for the hackathon workflow, but the provider boundary also supports OpenCode and Claude Code. This keeps the orchestration logic independent from the particular AI executor.

The runner deliberately owns the mechanical phases: preparing worktrees, refreshing branches, validating and pushing changes, publishing archives, and cleaning up. The AI handles the phases that require software judgment: implementing a specification and performing the semantic OpenSpec archive.

The queue is the human-readable interface, while reconciliation is the recovery mechanism. Shipper continuously derives the most advanced valid phase from repository evidence, so it can recover after an interrupted run without relying on a second hidden state database.

## Challenges we ran into

The hardest challenges were not making an agent write code. They were the edge cases around real repositories. A fresh worktree has no dependencies installed, while `main` can be dirty or out of date with `origin/main`. Remote branches can change while a queue is running, and GitHub authentication or permissions can prevent pushes and pull requests.

A pull request can be open, merged, conflicted, or missing. OpenSpec archive operations require semantic understanding, not just file movement. A model can report a blocker using unpredictable language, and a queue can appear to be waiting even when another independent change could still proceed. Git processes can also hang while waiting on SSH or network authentication.

These problems forced me to separate native operations from agent work, add pre-checks and post-checks to phases, record useful logs, make blocked tasks visible, and design reconciliation to be safe to run repeatedly.

## Accomplishments that we're proud of

The biggest accomplishment is that a change can now travel from an OpenSpec proposal to a merged pull request and an archived specification with very little manual coordination.

I am especially proud of the worktree isolation. My normal checkout is never used as the agent's workspace, so I can continue planning the next change while Codex implements the current one.

I am also proud that the system does not hide failure. When Shipper cannot continue, it marks the task as blocked, records the reason, links to the complete run log, and waits for human help. After the problem is fixed, the human can remove the blocked marker and run the queue again. Shipper reconciles the current state and resumes from the correct phase.

Finally, the project is distributed as a public npm package. A user can install it in an existing OpenSpec repository, run `init`, choose an AI provider, run `doctor`, and start shipping changes without cloning a separate orchestration repository.

## What we learned

The project taught me that the difficult part of agentic software development is building the system around the agent. A capable model is only one part of the workflow. It also needs a clear specification, an isolated place to work, explicit boundaries, reliable tools, observable progress, and a safe way to stop when human judgment is required.

I also learned to separate thinking from execution. I use powerful models to create and refine good OpenSpec changes, especially when a large idea needs to be divided into smaller independent pieces. Once the specification is clear, Codex can execute those tasks in a controlled workflow. This keeps planning quality high while making the coding phase more efficient.

Most importantly, I learned that automation should not pretend to be perfect. A useful system makes normal progress effortless, makes failure understandable, and makes recovery simple.

## What's next for openspec-shipper

The current workflow is intentionally opinionated. It reflects what works for me as a solo developer using OpenSpec, Codex, GitHub, branches, worktrees, and small pull requests. It is not intended to prescribe the right process for every team.

The next step is to learn from people who use it in different environments. I want to improve support for parallel changes, protected branches, different GitHub policies, richer provider capabilities, and team workflows without losing the simplicity of a visible Markdown queue.

I built **openspec-shipper** to solve a personal problem: I wanted to return to my computer and find that the project had moved forward while I was working on the next idea.

OpenSpec describes what should be built. Codex writes the code. Shipper coordinates the journey from specification to merged change.
