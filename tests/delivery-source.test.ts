import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { resolveDeliverySource } from "../src/infrastructure/git/delivery-source";
import { parseQueue } from "../src/domain/queue/queue";

const roots: string[] = [];
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe("delivery source resolution", () => {
  test("adopts a committed planning branch without requiring the human checkout to be main or clean", async () => {
    const repo = await createRepository();
    git(repo, ["switch", "-c", "spec/add-name-greeting"]);
    await writeChange(repo, "add-name-greeting", "planning branch");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "docs: plan name greeting"]);
    const expected = git(repo, ["rev-parse", "HEAD"]).trim();
    await writeFile(join(repo, "human-notes.txt"), "still editing\n");

    const source = resolveDeliverySource(repo, queueTask("add-name-greeting"), "main");

    expect(source).toEqual({
      kind: "branch",
      commit: expected,
      branch: "spec/add-name-greeting",
    });
  });

  test("blocks a planning branch whose change has uncommitted edits", async () => {
    const repo = await createRepository();
    git(repo, ["switch", "-c", "spec/add-name-greeting"]);
    await writeChange(repo, "add-name-greeting", "planning branch");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "docs: plan name greeting"]);
    await writeFile(join(repo, "openspec", "changes", "add-name-greeting", "proposal.md"), "# Proposal\n\nunfinished edit\n");

    expect(() => resolveDeliverySource(repo, queueTask("add-name-greeting"), "main"))
      .toThrow("has uncommitted changes in openspec/changes/add-name-greeting");
  });

  test("blocks an explicit source snapshot when its planning branch has uncommitted change edits", async () => {
    const repo = await createRepository();
    git(repo, ["switch", "-c", "spec/add-name-greeting"]);
    await writeChange(repo, "add-name-greeting", "snapshot");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "docs: snapshot"]);
    const commit = git(repo, ["rev-parse", "HEAD"]).trim();
    await writeFile(join(repo, "openspec", "changes", "add-name-greeting", "tasks.md"), "- [ ] unfinished planning edit\n");

    const task = queueTask("add-name-greeting", `source_branch: spec/add-name-greeting; source_commit: ${commit}`);
    expect(() => resolveDeliverySource(repo, task, "main"))
      .toThrow("has uncommitted changes in openspec/changes/add-name-greeting");
  });

  test("prefers origin main when a leftover planning branch has no newer change commit", async () => {
    const repo = await createRepository();
    git(repo, ["switch", "-c", "spec/add-name-greeting"]);
    await writeChange(repo, "add-name-greeting", "merged plan");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "docs: plan name greeting"]);
    git(repo, ["push", "origin", "HEAD:main"]);
    const expected = git(repo, ["rev-parse", "HEAD"]).trim();

    const source = resolveDeliverySource(repo, queueTask("add-name-greeting"), "main");

    expect(source.kind).toBe("base");
    expect(source.commit).toBe(expected);
  });

  test("blocks ambiguous planning branches until source_branch is declared", async () => {
    const repo = await createRepository();
    for (const branch of ["spec/add-name-greeting", "proposal/add-name-greeting"]) {
      git(repo, ["switch", "main"]);
      git(repo, ["switch", "-c", branch]);
      await writeChange(repo, "add-name-greeting", branch);
      git(repo, ["add", "."]);
      git(repo, ["commit", "-m", `docs: ${branch}`]);
    }

    expect(() => resolveDeliverySource(repo, queueTask("add-name-greeting"), "main"))
      .toThrow("Multiple branches contain newer planning commits");
  });

  test("honors an explicit immutable source snapshot", async () => {
    const repo = await createRepository();
    git(repo, ["switch", "-c", "spec/add-name-greeting"]);
    await writeChange(repo, "add-name-greeting", "snapshot");
    git(repo, ["add", "."]);
    git(repo, ["commit", "-m", "docs: snapshot"]);
    const commit = git(repo, ["rev-parse", "HEAD"]).trim();

    const task = queueTask("add-name-greeting", `source_branch: spec/add-name-greeting; source_commit: ${commit}`);
    expect(resolveDeliverySource(repo, task, "main")).toEqual({
      kind: "snapshot",
      commit,
      branch: "spec/add-name-greeting",
      worktree: undefined,
    });
  });
});

function queueTask(change: string, metadata = "") {
  const comment = metadata ? ` <!-- ${metadata} -->` : "";
  return parseQueue(`- [ ] deliver ${change}${comment}\n`).tasks[0]!;
}

async function createRepository(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "shipper-source-"));
  roots.push(root);
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  git(root, ["init", "--bare", remote]);
  git(root, ["init", "-b", "main", repo]);
  git(repo, ["config", "user.name", "Test User"]);
  git(repo, ["config", "user.email", "test@example.com"]);
  await writeFile(join(repo, "README.md"), "demo\n");
  git(repo, ["add", "."]);
  git(repo, ["commit", "-m", "chore: initial"]);
  git(repo, ["remote", "add", "origin", remote]);
  git(repo, ["push", "-u", "origin", "main"]);
  return repo;
}

async function writeChange(repo: string, change: string, purpose: string): Promise<void> {
  const dir = join(repo, "openspec", "changes", change);
  await mkdir(join(dir, "specs", "hello-cli"), { recursive: true });
  await writeFile(join(dir, "proposal.md"), `# Proposal\n\n${purpose}\n`);
  await writeFile(join(dir, "design.md"), "# Design\n");
  await writeFile(join(dir, "tasks.md"), "- [ ] Implement\n");
  await writeFile(join(dir, "specs", "hello-cli", "spec.md"), "## ADDED Requirements\n\n### Requirement: Greeting\n");
}

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", ["-C", cwd, ...args], { encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout);
  }
  return result.stdout;
}
