import { mkdir, mkdtemp, readFile, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { installShipperKit } from "../src/setup";

describe("target setup", () => {
  test("installs the OpenSpec Shipper kit into a target repository", async () => {
    const harness = await createHarness();

    const result = await installShipperKit({
      rootDir: harness.rootDir,
      projectDir: harness.projectDir,
      profile: "node-npm",
    });

    expect(result.some((file) => file.target.endsWith(".opencode/commands/openspec-apply-worktree.md"))).toBe(true);
    expect(result.some((file) => file.target.endsWith(".opencode/commands/openspec-archive-merged.md"))).toBe(true);
    expect(result.some((file) => file.target.endsWith(".github/workflows/open-pr-on-branch-push.yml"))).toBe(false);
    expect(await readFile(join(harness.projectDir, ".opencode/agents/openspec-archive-worker.md"), "utf8")).toContain(
      "Do not clean local worktrees or branches",
    );
    const shipperConfig = JSON.parse(await readFile(join(harness.projectDir, ".openspec-shipper/config.json"), "utf8"));
    expect(shipperConfig.profile).toBe("node-npm");
    expect(shipperConfig.safety).toEqual({ enablePush: true, enableArchive: true });
    expect(shipperConfig.worktree).toEqual({ install: true, installTimeoutMs: 600000 });
    expect(shipperConfig.version).toBe(2);
    expect(shipperConfig.delivery).toEqual({ refreshPolicy: "auto" });
    expect(shipperConfig.archive).toEqual({ publishMode: "direct", maxAttempts: 3 });
    expect(shipperConfig.github.autoOpenPr).toBe(false);
    expect(await readFile(join(harness.projectDir, ".openspec-shipper/.env.example"), "utf8")).toContain("OPENSPEC_SHIPPER_PROVIDER=opencode");
    const installedReadme = await readFile(join(harness.projectDir, ".openspec-shipper/README.md"), "utf8");
    expect(installedReadme).toContain("Required After Init");
    expect(installedReadme).toContain("git commit -m \"chore: install openspec shipper\"");
    expect(await readFile(join(harness.projectDir, ".openspec-shipper/openspec-config.example.yaml"), "utf8")).toContain("OpenSpec Shipper workflow source");
    expect(await readFile(join(harness.projectDir, ".openspec-shipper/scripts/validate-branch-name.mjs"), "utf8")).toContain("Invalid branch name");
    expect(await readFile(join(harness.projectDir, ".openspec-shipper/scripts/validate-openspec-proposal.mjs"), "utf8")).toContain("openspec:validate-proposal");
    expect(await readFile(join(harness.projectDir, ".openspec-shipper/queue.md"), "utf8")).toBe("# OpenSpec Shipper Queue\n\n");
    expect(await readFile(join(harness.projectDir, ".openspec-shipper/queue.example.md"), "utf8")).toBe("# OpenSpec Changes to ship\n\n- [ ] deliver CHANGE_NAME\n");
    expect(await readdir(join(harness.projectDir, ".openspec-shipper/runs"))).toEqual([]);
    expect(await readdir(join(harness.projectDir, ".openspec-shipper/tmp"))).toEqual([]);
    expect(await readFile(join(harness.projectDir, ".gitignore"), "utf8")).toBe([
      "# OpenSpec Shipper local state",
      ".openspec-shipper/.env",
      ".openspec-shipper/queue.md",
      ".openspec-shipper/shipper.lock",
      ".openspec-shipper/stop",
      ".openspec-shipper/runs/",
      ".openspec-shipper/tmp/",
      ".openspec-shipper/workspaces/",
      "worktrees/",
      "",
    ].join("\n"));
    const packageJson = JSON.parse(await readFile(join(harness.projectDir, "package.json"), "utf8"));
    expect(packageJson.scripts["openspec:cli"]).toBe("env OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec");
    expect(packageJson.scripts["openspec:validate-proposal"]).toBe("node .openspec-shipper/scripts/validate-openspec-proposal.mjs");
    expect(packageJson.scripts["lint:branch"]).toBe("node .openspec-shipper/scripts/validate-branch-name.mjs");
    expect(packageJson.devDependencies["@fission-ai/openspec"]).toBe("^1.2.0");
  });

  test("can install project dependencies after init", async () => {
    const harness = await createHarness();
    const installs: Array<{ projectDir: string; packageManager: string }> = [];

    await installShipperKit({
      rootDir: harness.rootDir,
      projectDir: harness.projectDir,
      profile: "node-npm",
      installDependencies: true,
      dependencyInstaller: async (input) => {
        installs.push(input);
        await writeFile(join(input.projectDir, "package-lock.json"), "{}\n");
        return "installed\n";
      },
    });

    expect(installs).toEqual([{ projectDir: harness.projectDir, packageManager: "npm" }]);
    expect(await readFile(join(harness.projectDir, "package-lock.json"), "utf8")).toBe("{}\n");
  });

  test("installs Codex provider assets without installing OpenCode assets", async () => {
    const harness = await createHarness();

    const result = await installShipperKit({
      rootDir: harness.rootDir,
      projectDir: harness.projectDir,
      profile: "node-npm",
      provider: "codex-cli",
    });

    expect(result.some((file) => file.target.endsWith(".openspec-shipper/codex/workflow.md"))).toBe(true);
    expect(result.some((file) => file.target.endsWith(".openspec-shipper/codex/prompts/implement.md"))).toBe(true);
    expect(result.some((file) => file.target.endsWith(".openspec-shipper/codex/prompts/archive.md"))).toBe(true);
    expect(result.some((file) => file.target.includes(".opencode/"))).toBe(false);
    const shipperConfig = JSON.parse(await readFile(join(harness.projectDir, ".openspec-shipper/config.json"), "utf8"));
    expect(shipperConfig.executor.provider).toBe("codex-cli");
    expect(shipperConfig.executor.codex).toMatchObject({
      model: "gpt-5.6-luna",
      reasoningEffort: "xhigh",
    });
    const envExample = await readFile(join(harness.projectDir, ".openspec-shipper/.env.example"), "utf8");
    expect(envExample).toContain("OPENSPEC_SHIPPER_PROVIDER=codex-cli");
    expect(envExample).toContain("OPENSPEC_SHIPPER_CODEX_MODEL=gpt-5.6-luna");
    expect(envExample).toContain("OPENSPEC_SHIPPER_CODEX_REASONING_EFFORT=xhigh");
  });

  test("installs Claude Code assets without modifying the target .claude directory", async () => {
    const harness = await createHarness();
    await mkdir(join(harness.projectDir, ".claude"), { recursive: true });
    await writeFile(join(harness.projectDir, ".claude/settings.json"), "{\"custom\":true}\n");

    const result = await installShipperKit({
      rootDir: harness.rootDir,
      projectDir: harness.projectDir,
      provider: "claude-code",
    });

    expect(result.some((file) => file.target.endsWith(".openspec-shipper/claude/prompts/implement.md"))).toBe(true);
    expect(result.some((file) => file.target.endsWith(".openspec-shipper/claude/prompts/archive.md"))).toBe(true);
    expect(result.some((file) => file.target.endsWith(".openspec-shipper/claude/settings.json"))).toBe(true);
    expect(result.some((file) => file.target.includes(".opencode/"))).toBe(false);
    expect(await readFile(join(harness.projectDir, ".claude/settings.json"), "utf8")).toBe("{\"custom\":true}\n");
    const shipperConfig = JSON.parse(await readFile(join(harness.projectDir, ".openspec-shipper/config.json"), "utf8"));
    expect(shipperConfig.executor.provider).toBe("claude-code");
    expect(shipperConfig.executor.claude).toEqual({
      bin: "claude",
      model: "sonnet",
      effort: "low",
      permissionMode: "dontAsk",
      sandbox: "strict",
    });
    expect(shipperConfig.checks.install).toBe("npm ci");
    expect(shipperConfig.checks.updateDependencies).toBe("npm install");
  });

  test("update preserves the already configured provider when --provider is omitted", async () => {
    const harness = await createHarness();

    await installShipperKit({
      rootDir: harness.rootDir,
      projectDir: harness.projectDir,
      provider: "codex-cli",
    });
    const result = await installShipperKit({
      rootDir: harness.rootDir,
      projectDir: harness.projectDir,
    });

    expect(result.some((file) => file.target.endsWith(".openspec-shipper/codex/workflow.md"))).toBe(true);
    expect(result.some((file) => file.target.includes(".opencode/"))).toBe(false);
    const shipperConfig = JSON.parse(await readFile(join(harness.projectDir, ".openspec-shipper/config.json"), "utf8"));
    expect(shipperConfig.executor.provider).toBe("codex-cli");
  });

  test("does not overwrite target files that drifted after installation", async () => {
    const harness = await createHarness();
    const readmePath = join(harness.projectDir, ".openspec-shipper/README.md");

    await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });
    await writeFile(readmePath, "Custom Shipper README\n");

    const result = await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });

    expect(result.find((file) => file.target === readmePath)?.status).toBe("drifted");
    expect(await readFile(readmePath, "utf8")).toBe("Custom Shipper README\n");
  });

  test("force overwrites target files that drifted", async () => {
    const harness = await createHarness();
    const readmePath = join(harness.projectDir, ".openspec-shipper/README.md");

    await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });
    await writeFile(readmePath, "Custom Shipper README\n");

    const result = await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir, force: true });

    expect(result.find((file) => file.target === readmePath)?.status).toBe("updated");
    expect(await readFile(readmePath, "utf8")).toContain("Required After Init");
  });

  test("does not overwrite an existing queue", async () => {
    const harness = await createHarness();
    const queuePath = join(harness.projectDir, ".openspec-shipper/queue.md");

    await mkdir(join(harness.projectDir, ".openspec-shipper"), { recursive: true });
    await writeFile(queuePath, "- [ ] deliver add-name-greeting\n");

    const result = await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });

    expect(result.find((file) => file.target === queuePath)?.status).toBe("unchanged");
    expect(await readFile(queuePath, "utf8")).toBe("- [ ] deliver add-name-greeting\n");
  });

  test("adds only missing shipper gitignore entries", async () => {
    const harness = await createHarness();
    const gitignorePath = join(harness.projectDir, ".gitignore");
    await writeFile(gitignorePath, ["dist/", "", "# OpenSpec Shipper", ".openspec-shipper/.env", "worktrees/", ""].join("\n"));

    const result = await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });

    expect(result.find((file) => file.target === gitignorePath)?.status).toBe("updated");
    expect(await readFile(gitignorePath, "utf8")).toBe([
      "dist/",
      "",
      "# OpenSpec Shipper",
      ".openspec-shipper/.env",
      "worktrees/",
      ".openspec-shipper/queue.md",
      ".openspec-shipper/shipper.lock",
      ".openspec-shipper/stop",
      ".openspec-shipper/runs/",
      ".openspec-shipper/tmp/",
      ".openspec-shipper/workspaces/",
      "",
    ].join("\n"));
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
