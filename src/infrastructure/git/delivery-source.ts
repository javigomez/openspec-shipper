import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import type { QueueTask } from "../../domain/queue/queue.js";

export type DeliverySource = {
  kind: "base" | "branch" | "worktree" | "snapshot";
  commit: string;
  branch?: string;
  worktree?: string;
};

export function resolveDeliverySource(projectDir: string, task: QueueTask, baseBranch: string): DeliverySource {
  if (!task.change) {
    throw new Error("Cannot resolve a delivery source without a change name.");
  }

  fetchBase(projectDir, baseBranch);
  const changePath = `openspec/changes/${task.change}`;

  if (task.sourceCommit) {
    requireChangeAtRef(projectDir, task.sourceCommit, changePath);
    requireCleanPlanningBranch(projectDir, task.sourceBranch, task.change);
    return {
      kind: "snapshot",
      commit: resolveCommit(projectDir, task.sourceCommit),
      branch: task.sourceBranch,
      worktree: task.sourceWorktree,
    };
  }

  if (task.sourceWorktree) {
    const worktree = resolve(projectDir, task.sourceWorktree);
    requireCleanWorktree(worktree, task.change);
    const commit = resolveCommit(worktree, "HEAD");
    requireChangeAtRef(projectDir, commit, changePath);
    return { kind: "worktree", commit, worktree: task.sourceWorktree, branch: currentBranch(worktree) };
  }

  if (task.sourceBranch) {
    const commit = resolveCommit(projectDir, task.sourceBranch);
    requireChangeAtRef(projectDir, commit, changePath);
    requireCleanPlanningBranch(projectDir, task.sourceBranch, task.change);
    return { kind: "branch", commit, branch: task.sourceBranch };
  }

  const baseRef = `origin/${baseBranch}`;
  const baseHasChange = changeExistsAtRef(projectDir, baseRef, changePath);
  const candidates = sourceBranchCandidates(projectDir, task.change, baseRef, changePath);
  if (
    changeExistsAtRef(projectDir, baseBranch, changePath)
    && hasChangeCommitsAfterBase(projectDir, baseRef, baseBranch, changePath)
  ) {
    const commit = resolveCommit(projectDir, baseBranch);
    if (!candidates.some((candidate) => candidate.commit === commit)) {
      candidates.push({ branch: baseBranch, commit });
    }
  }

  if (baseHasChange) {
    const newerCandidates = candidates.filter((candidate) => hasChangeCommitsAfterBase(projectDir, baseRef, candidate.branch, changePath));
    if (newerCandidates.length === 0) {
      return { kind: "base", commit: resolveCommit(projectDir, baseRef), branch: baseRef };
    }
    if (newerCandidates.length === 1) {
      const [candidate] = newerCandidates;
      requireCleanPlanningBranch(projectDir, candidate!.branch, task.change);
      return { kind: "branch", commit: candidate!.commit, branch: candidate!.branch };
    }
    throw ambiguousSource(task.change, newerCandidates.map((candidate) => candidate.branch));
  }

  if (candidates.length === 1) {
    const [candidate] = candidates;
    requireCleanPlanningBranch(projectDir, candidate!.branch, task.change);
    return { kind: "branch", commit: candidate!.commit, branch: candidate!.branch };
  }
  if (candidates.length > 1) {
    throw ambiguousSource(task.change, candidates.map((candidate) => candidate.branch));
  }

  const worktreeCandidates = listedWorktrees(projectDir)
    .filter((worktree) => resolve(worktree.path) !== resolve(projectDir))
    .filter((worktree) => existsSync(join(worktree.path, changePath)))
    .filter((worktree) => !worktree.path.endsWith(`/worktrees/${task.change}`));
  if (worktreeCandidates.length === 1) {
    const [candidate] = worktreeCandidates;
    requireCleanWorktree(candidate!.path, task.change);
    return {
      kind: "worktree",
      commit: resolveCommit(candidate!.path, "HEAD"),
      branch: candidate!.branch,
      worktree: relative(projectDir, candidate!.path),
    };
  }
  if (worktreeCandidates.length > 1) {
    throw new Error(
      `Multiple worktrees contain OpenSpec change ${task.change}: ${worktreeCandidates.map((candidate) => candidate.path).join(", ")}. Add source_worktree metadata to queue.md.`,
    );
  }

  throw new Error(
    `OpenSpec change ${task.change} was not found in origin/${baseBranch}, a unique local branch, or a committed worktree.`,
  );
}

export function sourceHasNewerChangeCommit(projectDir: string, task: QueueTask): boolean {
  if (!task.sourceBranch || !task.sourceCommit || task.sourceBranch.startsWith("origin/")) {
    return false;
  }
  const tip = tryResolveCommit(projectDir, task.sourceBranch);
  if (!tip || tip === task.sourceCommit || !task.change) {
    return false;
  }
  return git(projectDir, ["log", "--format=%H", `${task.sourceCommit}..${tip}`, "--", `openspec/changes/${task.change}`], true).trim().length > 0;
}

function sourceBranchCandidates(projectDir: string, changeName: string, baseRef: string, changePath: string) {
  const baseName = baseRef.replace(/^origin\//, "");
  const refs = git(projectDir, ["for-each-ref", "--format=%(refname:short)", "refs/heads", "refs/remotes/origin"], true)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((branch) => branch !== baseRef && branch !== baseName && branch !== `origin/HEAD`)
    .filter((branch) => !branch.endsWith(`/feat/${changeName}`) && branch !== `feat/${changeName}`)
    .filter((branch) => changeExistsAtRef(projectDir, branch, changePath));
  const byCommit = new Map<string, string>();
  for (const branch of new Set(refs)) {
    const commit = resolveCommit(projectDir, branch);
    const current = byCommit.get(commit);
    if (!current || (current.startsWith("origin/") && !branch.startsWith("origin/"))) {
      byCommit.set(commit, branch);
    }
  }
  return [...byCommit].map(([commit, branch]) => ({ branch, commit }));
}

function hasChangeCommitsAfterBase(projectDir: string, baseRef: string, branch: string, changePath: string): boolean {
  return git(projectDir, ["log", "--format=%H", `${baseRef}..${branch}`, "--", changePath], true).trim().length > 0;
}

function listedWorktrees(projectDir: string): Array<{ path: string; branch?: string }> {
  const output = git(projectDir, ["worktree", "list", "--porcelain"], true);
  const result: Array<{ path: string; branch?: string }> = [];
  let current: { path: string; branch?: string } | undefined;
  for (const line of output.split(/\r?\n/)) {
    if (line.startsWith("worktree ")) {
      current = { path: line.slice("worktree ".length) };
      result.push(current);
    } else if (current && line.startsWith("branch refs/heads/")) {
      current.branch = line.slice("branch refs/heads/".length);
    }
  }
  return result;
}

function requireCleanWorktree(worktree: string, changeName: string): void {
  const dirty = git(worktree, ["status", "--short", "--untracked-files=all"], true).trim();
  if (dirty) {
    throw new Error(
      `Planning worktree for ${changeName} has uncommitted changes. Commit the planning snapshot before handing it to OpenSpec Shipper.`,
    );
  }
}

function requireCleanPlanningBranch(projectDir: string, branch: string | undefined, changeName: string): void {
  if (!branch || branch.startsWith("origin/")) {
    return;
  }
  const worktree = listedWorktrees(projectDir).find((candidate) => candidate.branch === branch);
  if (!worktree) {
    return;
  }
  const changePath = `openspec/changes/${changeName}`;
  const dirty = git(worktree.path, ["status", "--short", "--untracked-files=all", "--", changePath], true).trim();
  if (dirty) {
    throw new Error(
      `Planning source ${branch} has uncommitted changes in ${changePath}. Commit or discard them before handing the change to OpenSpec Shipper.`,
    );
  }
}

function currentBranch(worktree: string): string | undefined {
  return git(worktree, ["branch", "--show-current"], true).trim() || undefined;
}

function fetchBase(projectDir: string, baseBranch: string): void {
  git(projectDir, ["fetch", "--quiet", "origin", baseBranch]);
  resolveCommit(projectDir, `origin/${baseBranch}`);
}

function requireChangeAtRef(projectDir: string, ref: string, changePath: string): void {
  if (!changeExistsAtRef(projectDir, ref, changePath)) {
    throw new Error(`Source ${ref} does not contain ${changePath}.`);
  }
}

function changeExistsAtRef(projectDir: string, ref: string, changePath: string): boolean {
  const result = spawnSync("git", ["-C", projectDir, "cat-file", "-e", `${ref}:${changePath}`], { encoding: "utf8" });
  return result.status === 0;
}

function resolveCommit(projectDir: string, ref: string): string {
  const commit = tryResolveCommit(projectDir, ref);
  if (!commit) {
    throw new Error(`Git ref ${ref} does not resolve to a commit.`);
  }
  return commit;
}

function tryResolveCommit(projectDir: string, ref: string): string | undefined {
  const result = spawnSync("git", ["-C", projectDir, "rev-parse", "--verify", `${ref}^{commit}`], { encoding: "utf8" });
  return result.status === 0 ? result.stdout.trim() : undefined;
}

function ambiguousSource(changeName: string, branches: string[]): Error {
  return new Error(
    `Multiple branches contain newer planning commits for ${changeName}: ${branches.join(", ")}. Add source_branch metadata to queue.md.`,
  );
}

function git(projectDir: string, args: string[], allowFailure = false): string {
  const result = spawnSync("git", ["-C", projectDir, ...args], { encoding: "utf8" });
  if (result.status !== 0 && !allowFailure) {
    const detail = result.stderr.trim() || result.stdout.trim() || `git ${args.join(" ")} exited with ${result.status ?? "unknown"}`;
    throw new Error(detail);
  }
  return result.status === 0 ? result.stdout : "";
}
