import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { describe, expect, test } from "bun:test";
import { checkClaudePlatform, checkWorkingTreeClean, runDoctor } from "../src/application/doctor/doctor";

describe("doctor", () => {
  test("rejects native Windows for the strict Claude sandbox", () => {
    expect(checkClaudePlatform("win32").ok).toBe(false);
    expect(checkClaudePlatform("linux").ok).toBe(true);
    expect(checkClaudePlatform("win32", "permissive").severity).toBe("warning");
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
      claudeSandboxProbe: async () => ({
        name: "claude sandbox probe",
        ok: true,
        severity: "warning",
        message: "Claude sandbox accepted Bash commands",
      }),
    });

    expect(checks.some((check) => check.name === "codex provider" && check.severity === "warning")).toBe(true);
    expect(checks.some((check) => check.name === ".openspec-shipper/codex/prompts/implement.md" && !check.ok)).toBe(true);
    expect(checks.some((check) => check.name === ".opencode/commands/openspec-apply-worktree.md")).toBe(false);
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
      claudeSandboxProbe: async () => ({
        name: "claude sandbox probe",
        ok: true,
        message: "probe passed",
        severity: "error",
      }),
    });

    expect(checks.some((check) => check.name === "claude-code provider" && check.severity === "warning")).toBe(true);
    expect(checks.some((check) => check.name === "/usr/bin/true" && check.message === "Claude Code is authenticated")).toBe(true);
    expect(checks.some((check) => check.name === "claude sandbox" && check.ok)).toBe(true);
    expect(checks.some((check) => check.name === "claude sandbox probe" && check.ok)).toBe(true);
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
      claudeSandboxProbe: async () => {
        probeCalled = true;
        return { name: "claude sandbox probe", ok: true, message: "probe passed", severity: "error" };
      },
    });

    expect(checks.some((check) => check.name === "claude config" && !check.ok && check.message.includes("maxTurns"))).toBe(true);
    expect(probeCalled).toBe(false);
    expect(checks.some((check) => check.name === "claude sandbox probe" && check.message.includes("skipped"))).toBe(true);
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
