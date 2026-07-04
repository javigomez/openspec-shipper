import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { installOrchesterKit } from "../src/setup";

describe("target setup", () => {
  test("installs the Orchester kit into a target repository", async () => {
    const harness = await createHarness();

    const result = await installOrchesterKit({
      rootDir: harness.rootDir,
      projectDir: harness.projectDir,
      profile: "node-npm",
    });

    expect(result.some((file) => file.target.endsWith(".opencode/commands/openspec-apply-worktree.md"))).toBe(true);
    expect(result.some((file) => file.target.endsWith(".github/workflows/open-pr-on-branch-push.yml"))).toBe(true);
    expect(await readFile(join(harness.projectDir, ".orchester/config.json"), "utf8")).toContain('"profile": "node-npm"');
    expect(await readFile(join(harness.projectDir, ".gitignore"), "utf8")).toContain("worktrees/");
    expect(await readFile(join(harness.projectDir, ".gitignore"), "utf8")).toContain("node_modules/");
    const packageJson = JSON.parse(await readFile(join(harness.projectDir, "package.json"), "utf8"));
    expect(packageJson.scripts["openspec:cli"]).toBe("env OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec");
    expect(packageJson.devDependencies["@fission-ai/openspec"]).toBe("^1.2.0");
  });

  test("does not overwrite target files that drifted after installation", async () => {
    const harness = await createHarness();
    const workflowPath = join(harness.projectDir, ".github/workflows/pr-checks.yml");

    await installOrchesterKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });
    await writeFile(workflowPath, "name: Custom Checks\n");

    const result = await installOrchesterKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });

    expect(result.find((file) => file.target === workflowPath)?.status).toBe("drifted");
    expect(await readFile(workflowPath, "utf8")).toBe("name: Custom Checks\n");
  });

  test("force overwrites target files that drifted", async () => {
    const harness = await createHarness();
    const workflowPath = join(harness.projectDir, ".github/workflows/pr-checks.yml");

    await installOrchesterKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });
    await writeFile(workflowPath, "name: Custom Checks\n");

    const result = await installOrchesterKit({ rootDir: harness.rootDir, projectDir: harness.projectDir, force: true });

    expect(result.find((file) => file.target === workflowPath)?.status).toBe("updated");
    expect(await readFile(workflowPath, "utf8")).toContain("name: PR Checks");
  });
});

async function createHarness() {
  const projectDir = await mkdtemp(join(tmpdir(), "orchester-target-"));
  await mkdir(projectDir, { recursive: true });
  return {
    projectDir,
    rootDir: join(import.meta.dir, ".."),
  };
}
