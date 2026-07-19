import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { branchProtectionCheck, checkClaudePlatform, checkWorkingTreeClean, claudeVersionCheck, runDoctor } from "../src/application/doctor/doctor";

describe("doctor", () => {
  test("fails early when the configured base branch is protected", () => {
    const protectedBranch = branchProtectionCheck("main", 0, "true\n", "");
    const unprotectedBranch = branchProtectionCheck("develop", 0, "false\n", "");
    const unknownBranch = branchProtectionCheck("main", 1, "", "HTTP 403");

    expect(protectedBranch.ok).toBe(false);
    expect(protectedBranch.severity).toBe("error");
    expect(protectedBranch.message).toContain("archive will fail");
    expect(unprotectedBranch.ok).toBe(true);
    expect(unknownBranch.severity).toBe("warning");
  });
  test("rejects native Windows for the strict Claude sandbox", () => {
    expect(checkClaudePlatform("win32").ok).toBe(false);
    expect(checkClaudePlatform("linux").ok).toBe(true);
    expect(checkClaudePlatform("win32", "permissive").severity).toBe("warning");
  });
  test("warns for Claude versions newer than the tested contract", () => {
    const newer = claudeVersionCheck("claude", 0, "2.1.216 (Claude Code)\n");
    const tested = claudeVersionCheck("claude", 0, "2.1.215 (Claude Code)\n");
    const old = claudeVersionCheck("claude", 0, "2.1.68 (Claude Code)\n");

    expect(newer.severity).toBe("warning");
    expect(newer.message).toContain("newer than the tested maximum");
    expect(tested.ok).toBe(true);
    expect(old.severity).toBe("error");
  });
  test("fails when the main checkout has non-runtime changes", async () => {
    const projectDir = await createGitRepo();
    await writeFile(join(projectDir, "package.json"), "{\"name\":\"changed\"}\n");

    const check = checkWorkingTreeClean(projectDir);

    expect(check.ok).toBe(false);
    expect(check.severity).toBe("error");
    expect(check.message).toContain("main checkout has uncommitted non-runtime changes");
    expect(check.message).toContain("package.json");
  });

  test("ignores shipper runtime files when checking the working tree", async () => {
    const projectDir = await createGitRepo();
    await writeFile(
      join(projectDir, ".gitignore"),
      [
        ".openspec-shipper/queue.md",
        ".openspec-shipper/runs/",
        "",
      ].join("\n"),
    );
    runGit(projectDir, ["add", ".gitignore"]);
    runGit(projectDir, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "ignore runtime"]);

    await mkdir(join(projectDir, ".openspec-shipper/runs"), { recursive: true });
    await writeFile(join(projectDir, ".openspec-shipper/queue.md"), "- [ ] deliver add-name-greeting\n");
    await writeFile(join(projectDir, ".openspec-shipper/runs/run.log"), "log\n");

    const check = checkWorkingTreeClean(projectDir);

    expect(check.ok).toBe(true);
  });

  test("checks Codex provider assets instead of OpenCode command files", async () => {
    const projectDir = await createGitRepo();
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await writeFile(
      join(projectDir, ".openspec-shipper/config.json"),
      `${JSON.stringify({
        version: 1,
        profile: "node-npm",
        baseBranch: "main",
        packageManager: "npm",
        executor: {
          provider: "codex-cli",
          opencode: { bin: "opencode", model: "opencode-go/deepseek-v4-pro" },
          codex: { bin: "codex", model: "gpt-5.5", reasoningEffort: "low" },
        },
        github: { autoOpenPr: false, prChecks: false },
        checks: {},
        safety: { enablePush: true, enableArchive: true },
      })}\n`,
    );

    const checks = await runDoctor(projectDir, {
      deep: true,
      claudeContractProbe: async () => ({
        name: "claude CLI contract",
        ok: true,
        severity: "warning",
        message: "Claude sandbox accepted Bash commands",
      }),
    });

    expect(checks.some((check) => check.name === "codex provider" && check.severity === "warning")).toBe(true);
    expect(checks.some((check) => check.name === ".openspec-shipper/codex/prompts/implement.md" && !check.ok)).toBe(true);
    expect(checks.some((check) => check.name === ".opencode/commands/openspec-apply-worktree.md")).toBe(false);
  });

  test("treats package scripts required by runner checks as errors", async () => {
    const projectDir = await createGitRepo();
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await writeFile(join(projectDir, ".openspec-shipper/config.json"), "{}\n");

    const checks = await runDoctor(projectDir);

    expect(checks.some((check) => check.name === "script:openspec:cli" && !check.ok && check.severity === "error")).toBe(true);
    expect(checks.some((check) => check.name === "script:openspec:validate-proposal" && !check.ok && check.severity === "error")).toBe(true);
    expect(checks.some((check) => check.name === "script:lint:branch" && check.severity === "warning")).toBe(true);
  });

  test("executes configured OpenSpec command probes", async () => {
    const projectDir = await createGitRepo();
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    const openspecProbe = join(projectDir, ".openspec-shipper/probe-openspec.mjs");
    const validateProbe = join(projectDir, ".openspec-shipper/probe-validate.mjs");
    await writeFile(openspecProbe, [
      "import { writeFileSync } from 'node:fs';",
      "if (!process.argv.includes('--version')) process.exit(1);",
      "writeFileSync('.openspec-shipper/openspec-probed', 'yes');",
    ].join("\n"));
    await writeFile(validateProbe, [
      "import { writeFileSync } from 'node:fs';",
      "if (!process.argv.includes('--help')) process.exit(1);",
      "writeFileSync('.openspec-shipper/validate-probed', 'yes');",
    ].join("\n"));
    await writeFile(join(projectDir, "package.json"), JSON.stringify({
      name: "demo",
      scripts: {
        "openspec:cli": "node .openspec-shipper/probe-openspec.mjs",
        "openspec:validate-proposal": "node .openspec-shipper/probe-validate.mjs",
        "lint:branch": "node -e \"process.exit(0)\"",
      },
    }));
    await writeFile(join(projectDir, ".openspec-shipper/config.json"), `${JSON.stringify({
      checks: {
        openspec: `${JSON.stringify(process.execPath)} ${JSON.stringify(openspecProbe)} --`,
        validateProposal: `${JSON.stringify(process.execPath)} ${JSON.stringify(validateProbe)} --`,
      },
    })}\n`);

    const checks = await runDoctor(projectDir);

    expect(checks.some((check) => check.name === "checks.openspec" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "checks.validateProposal" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "script:openspec:cli" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "script:openspec:validate-proposal" && check.ok)).toBe(true);
    await expect(readFile(join(projectDir, ".openspec-shipper/openspec-probed"), "utf8")).resolves.toBe("yes");
    await expect(readFile(join(projectDir, ".openspec-shipper/validate-probed"), "utf8")).resolves.toBe("yes");
  });

  test("checks Claude authentication, assets, and strict sandbox settings", async () => {
    const projectDir = await createGitRepo();
    const claudeDir = join(projectDir, ".openspec-shipper/claude");
    await mkdir(join(claudeDir, "prompts"), { recursive: true });
    await writeFile(join(claudeDir, "workflow.md"), "workflow\n");
    await writeFile(join(claudeDir, "prompts/implement.md"), "implement\n");
    await writeFile(join(claudeDir, "prompts/archive.md"), "archive\n");
    await writeFile(join(claudeDir, "settings.json"), JSON.stringify({
      sandbox: { enabled: true, autoAllowBashIfSandboxed: true, failIfUnavailable: true, allowUnsandboxedCommands: false },
    }));
    await writeFile(join(projectDir, ".openspec-shipper/config.json"), `${JSON.stringify({
      version: 1,
      profile: "node-npm",
      baseBranch: "main",
      packageManager: "npm",
      executor: {
        provider: "claude-code",
        claude: { bin: "/usr/bin/true", model: "sonnet", effort: "low", permissionMode: "dontAsk" },
      },
      github: { autoOpenPr: false, prChecks: false },
      checks: {},
      safety: { enablePush: true, enableArchive: true },
    })}\n`);

    const checks = await runDoctor(projectDir, {
      deep: true,
      claudeContractProbe: async () => ({
        name: "claude CLI contract",
        ok: true,
        message: "probe passed",
        severity: "error",
      }),
    });

    expect(checks.some((check) => check.name === "claude-code provider" && check.severity === "warning")).toBe(true);
    expect(checks.some((check) => check.name === "/usr/bin/true" && check.message === "Claude Code is authenticated")).toBe(true);
    expect(checks.some((check) => check.name === "claude sandbox" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "claude CLI contract" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name.includes(".opencode/"))).toBe(false);
  });

  test("rejects invalid Claude execution limits", async () => {
    const projectDir = await createGitRepo();
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await writeFile(join(projectDir, ".openspec-shipper/config.json"), `${JSON.stringify({
      version: 1,
      profile: "node-npm",
      baseBranch: "main",
      packageManager: "npm",
      executor: {
        provider: "claude-code",
        claude: { bin: "/usr/bin/true", model: "sonnet", effort: "low", permissionMode: "dontAsk", maxTurns: -1 },
      },
      github: { autoOpenPr: false, prChecks: false },
      checks: {},
      safety: { enablePush: true, enableArchive: true },
    })}\n`);

    let probeCalled = false;
    const checks = await runDoctor(projectDir, {
      deep: true,
      claudeContractProbe: async () => {
        probeCalled = true;
        return { name: "claude CLI contract", ok: true, message: "probe passed", severity: "error" };
      },
    });

    expect(checks.some((check) => check.name === "claude config" && !check.ok && check.message.includes("maxTurns"))).toBe(true);
    expect(probeCalled).toBe(false);
    expect(checks.some((check) => check.name === "claude CLI contract" && check.message.includes("skipped"))).toBe(true);
  });
});

async function createGitRepo(): Promise<string> {
  const projectDir = await mkdtemp(join(tmpdir(), "shipper-doctor-"));
  runGit(projectDir, ["init"]);
  await writeFile(join(projectDir, "package.json"), "{\"name\":\"demo\"}\n");
  runGit(projectDir, ["add", "package.json"]);
  runGit(projectDir, ["-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"]);
  return projectDir;
}

function runGit(cwd: string, args: string[]) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }
}
