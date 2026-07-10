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
    expect(result.some((file) => file.target.endsWith(".github/workflows/open-pr-on-branch-push.yml"))).toBe(true);
    const shipperConfig = JSON.parse(await readFile(join(harness.projectDir, ".openspec-shipper/config.json"), "utf8"));
    expect(shipperConfig.profile).toBe("node-npm");
    expect(shipperConfig.safety).toEqual({ enablePush: true, enableArchive: true });
    expect(await readFile(join(harness.projectDir, ".openspec-shipper/.env.example"), "utf8")).toContain("OPENSPEC_SHIPPER_PROVIDER=opencode");
    expect(await readFile(join(harness.projectDir, ".openspec-shipper/README.md"), "utf8")).toContain("OpenSpec Shipper assets installed");
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
      ".openspec-shipper/runs/",
      ".openspec-shipper/tmp/",
      "worktrees/",
      "",
    ].join("\n"));
    const packageJson = JSON.parse(await readFile(join(harness.projectDir, "package.json"), "utf8"));
    expect(packageJson.scripts["openspec:cli"]).toBe("env OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec");
    expect(packageJson.scripts["openspec:validate-proposal"]).toBe("node .openspec-shipper/scripts/validate-openspec-proposal.mjs");
    expect(packageJson.scripts["lint:branch"]).toBe("node .openspec-shipper/scripts/validate-branch-name.mjs");
    expect(packageJson.devDependencies["@fission-ai/openspec"]).toBe("^1.2.0");
  });

  test("does not overwrite target files that drifted after installation", async () => {
    const harness = await createHarness();
    const workflowPath = join(harness.projectDir, ".github/workflows/open-pr-on-branch-push.yml");

    await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });
    await writeFile(workflowPath, "name: Custom Checks\n");

    const result = await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });

    expect(result.find((file) => file.target === workflowPath)?.status).toBe("drifted");
    expect(await readFile(workflowPath, "utf8")).toBe("name: Custom Checks\n");
  });

  test("force overwrites target files that drifted", async () => {
    const harness = await createHarness();
    const workflowPath = join(harness.projectDir, ".github/workflows/open-pr-on-branch-push.yml");

    await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir });
    await writeFile(workflowPath, "name: Custom Checks\n");

    const result = await installShipperKit({ rootDir: harness.rootDir, projectDir: harness.projectDir, force: true });

    expect(result.find((file) => file.target === workflowPath)?.status).toBe("updated");
    expect(await readFile(workflowPath, "utf8")).toContain("name: Auto Open PR");
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
      ".openspec-shipper/runs/",
      ".openspec-shipper/tmp/",
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
