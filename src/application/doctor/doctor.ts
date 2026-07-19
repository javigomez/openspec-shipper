import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, unlink } from "node:fs/promises";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import { filterLocalStateStatus } from "../../domain/config/local-state.js";
import { readShipperConfig, type ClaudeSandboxMode, type ShipperConfig } from "../../domain/config/shipper-config.js";
import { claudeSettingsContent, claudeSettingsPath } from "../../infrastructure/providers/claude-code/provider.js";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
};

const REQUIRED_OPENCODE_COMMANDS = [
  ".opencode/commands/openspec-apply-worktree.md",
  ".opencode/commands/openspec-archive-merged.md",
];

const REQUIRED_CODEX_ASSETS = [
  ".openspec-shipper/codex/workflow.md",
  ".openspec-shipper/codex/prompts/implement.md",
  ".openspec-shipper/codex/prompts/archive.md",
];

const REQUIRED_CLAUDE_ASSETS = [
  ".openspec-shipper/claude/workflow.md",
  ".openspec-shipper/claude/prompts/implement.md",
  ".openspec-shipper/claude/prompts/archive.md",
  ".openspec-shipper/claude/settings.json",
];

const REQUIRED_PACKAGE_SCRIPTS = [
  "openspec:cli",
  "openspec:validate-proposal",
  "lint:branch",
];

export type DoctorOptions = {
  deep?: boolean;
  claudeSandboxProbe?: (projectDir: string, config: ShipperConfig) => Promise<DoctorCheck>;
};

export async function runDoctor(projectDir: string, options: DoctorOptions = {}): Promise<DoctorCheck[]> {
  const config = (await readShipperConfig(projectDir)) ?? undefined;
  const packageJson = await readPackageJson(projectDir);
  const checks: DoctorCheck[] = [];

  checks.push(checkCommand("git", ["rev-parse", "--is-inside-work-tree"], projectDir, "Git repository detected"));
  checks.push(checkCommand("git", ["rev-parse", "--verify", config?.baseBranch ?? "main"], projectDir, "Base branch exists"));
  checks.push(checkGitIdentity(projectDir));
  checks.push(checkWorkingTreeClean(projectDir, config?.baseBranch ?? "main"));
  checks.push(checkCommand("gh", ["--version"], projectDir, "GitHub CLI is available for pull request management"));
  checks.push(checkGitHubCliAuth(projectDir));
  checks.push(checkGitHubPullRequestAccess(projectDir));
  checks.push(checkProviderCommand(projectDir, config));
  if (config?.executor.provider === "claude-code") {
    checks.push(checkClaudePlatform(process.platform, config.executor.claude.sandbox));
    checks.push(checkClaudeConfig(config));
    checks.push(checkCommand(config.executor.claude.bin, ["auth", "status"], projectDir, "Claude Code is authenticated"));
    checks.push(asWarning(checkCommand(config.executor.claude.bin, ["doctor"], projectDir, "Claude Code diagnostics passed")));
    if (options.deep) {
      checks.push(await (options.claudeSandboxProbe ?? probeClaudeSandbox)(projectDir, config));
    } else {
      checks.push(warning("claude sandbox probe", "Runtime sandbox probe not run; use `openspec-shipper doctor --deep` to verify it (uses one Claude request)"));
    }
  }
  checks.push(checkCommand(packageManagerCommand(config), ["--version"], projectDir, "Configured package manager is available"));

  checks.push(
    packageJson
      ? ok("package.json", "package.json found")
      : error("package.json", "package.json is required so workers can run project scripts"),
  );

  checks.push(
    config
      ? ok("openspec-shipper config", ".openspec-shipper/config.json found")
      : warning("openspec-shipper config", ".openspec-shipper/config.json missing; run `openspec-shipper init`"),
  );

  checks.push(...(await checkProviderAssets(projectDir, config)));

  if (packageJson) {
    for (const script of REQUIRED_PACKAGE_SCRIPTS) {
      checks.push(
        packageJson.scripts?.[script]
          ? ok(`script:${script}`, `package script ${script} found`)
          : warning(`script:${script}`, `package script ${script} missing; configure .openspec-shipper/config.json if your repo uses another command`),
      );
    }
  }

  checks.push(
    (await gitignoreContains(projectDir, "worktrees/"))
      ? ok(".gitignore worktrees", "worktrees/ is ignored")
      : warning(".gitignore worktrees", "Add worktrees/ to .gitignore before running implement workers"),
  );

  return checks;
}

export function checkClaudePlatform(platform = process.platform, mode: ClaudeSandboxMode = "strict"): DoctorCheck {
  if (platform !== "win32") {
    return ok("claude platform", `Claude Code ${mode} sandbox mode is supported on this platform`);
  }
  return mode === "strict"
    ? error("claude sandbox", "Claude Code strict sandbox requires macOS, Linux, or WSL2; native Windows is not supported")
    : warning("claude platform", `Claude sandbox mode is ${mode}; native Windows cannot provide the strict sandbox`);
}

function checkProviderCommand(projectDir: string, config: ShipperConfig | undefined): DoctorCheck {
  const provider = config?.executor.provider ?? "opencode";
  if (provider === "codex-cli") {
    return checkCommand(config?.executor.codex.bin ?? "codex", ["--version"], projectDir, "Codex CLI is available");
  }

  if (provider === "claude-code") {
    return checkClaudeVersion(config?.executor.claude.bin ?? "claude", projectDir);
  }

  return checkCommand(config?.executor.opencode.bin ?? "opencode", ["--version"], projectDir, "OpenCode CLI is available");
}

function checkClaudeConfig(config: ShipperConfig): DoctorCheck {
  const effort = config.executor.claude.effort;
  if (effort && !["low", "medium", "high", "xhigh", "max", "ultracode"].includes(effort)) {
    return error("claude config", `Unsupported Claude effort: ${effort}`);
  }
  const permissionMode = config.executor.claude.permissionMode;
  if (permissionMode !== "dontAsk" && permissionMode !== "bypassPermissions") {
    return error("claude config", `Unsupported Claude permission mode: ${permissionMode ?? "(missing)"}`);
  }
  if (config.executor.claude.maxTurns !== undefined && (!Number.isInteger(config.executor.claude.maxTurns) || config.executor.claude.maxTurns <= 0)) {
    return error("claude config", "Claude maxTurns must be a positive integer");
  }
  if (config.executor.claude.maxBudgetUsd !== undefined && (!Number.isFinite(config.executor.claude.maxBudgetUsd) || config.executor.claude.maxBudgetUsd <= 0)) {
    return error("claude config", "Claude maxBudgetUsd must be a positive number");
  }
  if (!["strict", "permissive", "off"].includes(config.executor.claude.sandbox)) {
    return error("claude config", `Unsupported Claude sandbox mode: ${config.executor.claude.sandbox ?? "(missing)"}`);
  }
  if (permissionMode === "bypassPermissions") {
    return warning("claude config", "Claude bypassPermissions disables normal permission checks; use only in an isolated environment");
  }
  return ok("claude config", `Claude model ${config.executor.claude.model ?? "default"}, effort ${effort ?? "default"}`);
}

function checkClaudeVersion(command: string, cwd: string): DoctorCheck {
  const result = spawnSync(command, ["--version"], { cwd, encoding: "utf8", timeout: 10_000 });
  if (result.error) {
    return error(command, result.error.message);
  }
  if (result.status !== 0) {
    return error(command, firstLine(result.stderr || result.stdout) ?? `exited with code ${result.status}`);
  }
  const version = (result.stdout || result.stderr).match(/(\d+)\.(\d+)\.(\d+)/);
  if (version && compareVersion(version.slice(1).map(Number) as [number, number, number], [2, 1, 69]) < 0) {
    return error(command, `Claude Code ${version[0]} is too old; version 2.1.69 or newer is required`);
  }
  return ok(command, version ? `Claude Code ${version[0]} is available` : "Claude Code CLI is available");
}

function compareVersion(left: [number, number, number], right: [number, number, number]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = left[index]! - right[index]!;
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

async function checkProviderAssets(projectDir: string, config: ShipperConfig | undefined): Promise<DoctorCheck[]> {
  const provider = config?.executor.provider ?? "opencode";
  if (provider === "codex-cli") {
    const checks: DoctorCheck[] = [
      warning("codex provider", "Codex CLI provider is experimental; validate it in a demo repo before relying on it"),
    ];
    for (const file of REQUIRED_CODEX_ASSETS) {
      checks.push((await fileExists(join(projectDir, file))) ? ok(file, `${file} found`) : error(file, `${file} missing`));
    }
    return checks;
  }

  if (provider === "claude-code") {
    const checks: DoctorCheck[] = [
      warning("claude-code provider", "Claude Code provider is experimental; validate it in a demo repo before relying on it"),
    ];
    for (const file of REQUIRED_CLAUDE_ASSETS) {
      checks.push((await fileExists(join(projectDir, file))) ? ok(file, `${file} found`) : error(file, `${file} missing`));
    }
    if (config) {
      checks.push(await checkClaudeSettings(projectDir, config.executor.claude.sandbox));
    }
    return checks;
  }

  const checks: DoctorCheck[] = [];
  for (const file of REQUIRED_OPENCODE_COMMANDS) {
    checks.push((await fileExists(join(projectDir, file))) ? ok(file, `${file} found`) : error(file, `${file} missing`));
  }
  return checks;
}

async function checkClaudeSettings(projectDir: string, mode: ClaudeSandboxMode): Promise<DoctorCheck> {
  const path = claudeSettingsPath(projectDir);
  try {
    const settings = JSON.parse(await readFile(path, "utf8")) as {
      sandbox?: Record<string, unknown>;
    };
    const expected = JSON.parse(claudeSettingsContent(mode)) as { sandbox: Record<string, unknown> };
    if (!isDeepStrictEqual(settings.sandbox, expected.sandbox)) {
      return error("claude sandbox", `Claude settings do not match executor.claude.sandbox=${mode}; run openspec-shipper update --force`);
    }
    return mode === "strict"
      ? ok("claude sandbox", "Claude Code strict sandbox is configured")
      : warning("claude sandbox", `Claude sandbox mode is deliberately set to ${mode}; strict isolation is not guaranteed`);
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return error("claude sandbox", `Cannot read Claude settings: ${message}`);
  }
}

async function probeClaudeSandbox(projectDir: string, config: ShipperConfig): Promise<DoctorCheck> {
  const mode = config.executor.claude.sandbox;
  const tmpDir = join(projectDir, ".openspec-shipper", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const marker = join(tmpDir, `claude-sandbox-probe-${randomUUID()}.txt`);
  const prompt = [
    "Use the Bash tool exactly once.",
    `Run this exact command: printf sandbox-ok > ${JSON.stringify(marker)}`,
    "Do not merely describe the command. After Bash succeeds, answer only: ok",
  ].join("\n");
  const result = spawnSync(config.executor.claude.bin, [
    "-p",
    "--permission-mode", config.executor.claude.permissionMode ?? "dontAsk",
    "--settings", claudeSettingsPath(projectDir),
    "--tools", "Bash",
    "--allowedTools", "Bash",
    "--max-turns", "2",
    "--max-budget-usd", "0.02",
    "--output-format", "json",
    "--no-session-persistence",
    prompt,
  ], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 120_000,
  });

  const markerContent = await readFile(marker, "utf8").catch(() => undefined);
  await unlink(marker).catch(() => undefined);
  if (result.error || result.status !== 0 || markerContent !== "sandbox-ok") {
    const detail = result.error?.message ?? firstLine(result.stderr || result.stdout) ?? "Claude did not execute the sandboxed Bash probe";
    return error("claude sandbox probe", `${mode} execution probe failed: ${detail}`);
  }

  return ok("claude sandbox probe", `Claude Bash execution probe passed in ${mode} mode`);
}

function asWarning(check: DoctorCheck): DoctorCheck {
  return check.ok ? check : { ...check, severity: "warning" };
}

export function printDoctorReport(checks: DoctorCheck[]): number {
  for (const check of checks) {
    const marker = check.ok ? "ok" : check.severity;
    console.log(`[${marker}] ${check.name}: ${check.message}`);
  }

  const errors = checks.filter((check) => !check.ok && check.severity === "error").length;
  const warnings = checks.filter((check) => !check.ok && check.severity === "warning").length;
  console.log(`Doctor result: ${errors} error(s), ${warnings} warning(s).`);
  return errors === 0 ? 0 : 1;
}

function checkCommand(command: string, args: string[], cwd: string, successMessage: string): DoctorCheck {
  const result = spawnSync(command, args, { cwd, encoding: "utf8", timeout: 10_000 });
  if (result.error) {
    return error(command, result.error.message);
  }

  if (result.status !== 0) {
    return error(command, firstLine(result.stderr || result.stdout) ?? `exited with code ${result.status}`);
  }

  return ok(command, successMessage);
}

function checkGitIdentity(projectDir: string): DoctorCheck {
  const name = spawnSync("git", ["config", "--get", "user.name"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  const email = spawnSync("git", ["config", "--get", "user.email"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  const missing = [
    name.status === 0 && name.stdout.trim() ? undefined : "user.name",
    email.status === 0 && email.stdout.trim() ? undefined : "user.email",
  ].filter(Boolean);

  return missing.length === 0
    ? ok("git identity", "Git user.name and user.email are configured")
    : error(
        "git identity",
        `Git identity is missing ${missing.join(", ")}; configure it before running phases that commit changes`,
      );
}

export function checkWorkingTreeClean(projectDir: string, baseBranch = "main"): DoctorCheck {
  const result = spawnSync("git", ["status", "--short", "--untracked-files=all"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error) {
    return error("working tree", result.error.message);
  }

  if (result.status !== 0) {
    return error("working tree", firstLine(result.stderr || result.stdout) ?? `git status exited with code ${result.status}`);
  }

  const dirty = filterLocalStateStatus(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trimEnd())
      .filter(Boolean),
  );
  if (dirty.length === 0) {
    return ok("working tree", `No non-runtime changes in the ${baseBranch} checkout`);
  }

  return error(
    "working tree",
    [
      `${baseBranch} checkout has uncommitted non-runtime changes.`,
      "Commit or stash them before running the queue.",
      `Dirty paths: ${formatDirtyStatus(dirty)}.`,
    ].join(" "),
  );
}

function checkGitHubCliAuth(projectDir: string): DoctorCheck {
  const repository = detectGitHubRepository(projectDir);
  if (repository === "missing") {
    return error("gh auth", "Cannot verify GitHub CLI authentication because git remote origin is missing");
  }

  if (!repository) {
    return error("gh auth", "Cannot verify GitHub CLI authentication because origin is not a GitHub repo URL");
  }

  return checkCommand("gh", ["auth", "status"], projectDir, "GitHub CLI is authenticated");
}

function checkGitHubPullRequestAccess(projectDir: string): DoctorCheck {
  const repository = detectGitHubRepository(projectDir);
  if (repository === "missing") {
    return error("gh pr access", "Git remote origin is required so OpenSpec Shipper can create pull requests with gh");
  }

  if (!repository) {
    return error("gh pr access", "Git remote origin must be a GitHub repository URL so OpenSpec Shipper can create pull requests with gh");
  }

  const result = spawnSync("gh", ["pr", "list", "--limit", "1"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error) {
    return error("gh pr access", result.error.message);
  }

  if (result.status !== 0) {
    return error("gh pr access", firstLine(result.stderr || result.stdout) ?? `gh pr list exited with code ${result.status}`);
  }

  return ok("gh pr access", "GitHub pull requests are accessible through gh");
}

function detectGitHubRepository(projectDir: string): { owner: string; repo: string } | undefined | "missing" {
  const remote = spawnSync("git", ["remote", "get-url", "origin"], {
    cwd: projectDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  if (remote.status !== 0) {
    return "missing";
  }

  return parseGitHubRepository(remote.stdout.trim());
}

function parseGitHubRepository(remoteUrl: string): { owner: string; repo: string } | undefined {
  const normalized = remoteUrl.replace(/\.git$/, "");
  const ssh = normalized.match(/^git@github\.com:([^/]+)\/(.+)$/);
  if (ssh?.[1] && ssh[2]) {
    return { owner: ssh[1], repo: ssh[2] };
  }

  const https = normalized.match(/^https:\/\/github\.com\/([^/]+)\/(.+)$/);
  if (https?.[1] && https[2]) {
    return { owner: https[1], repo: https[2] };
  }

  return undefined;
}

function packageManagerCommand(config: ShipperConfig | undefined): string {
  return config?.packageManager ?? "npm";
}

async function readPackageJson(projectDir: string): Promise<{ scripts?: Record<string, string> } | undefined> {
  const raw = await readText(join(projectDir, "package.json"));
  return raw ? JSON.parse(raw) : undefined;
}

async function gitignoreContains(projectDir: string, value: string): Promise<boolean> {
  const raw = await readText(join(projectDir, ".gitignore"));
  return raw?.split(/\r?\n/).some((line) => line.trim() === value) ?? false;
}

async function fileExists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}

async function readText(path: string): Promise<string | undefined> {
  return await readFile(path, "utf8").catch((err: unknown) => {
    if (err instanceof Error && "code" in err && err.code === "ENOENT") {
      return undefined;
    }

    throw err;
  });
}

function ok(name: string, message: string): DoctorCheck {
  return { name, ok: true, message, severity: "error" };
}

function warning(name: string, message: string): DoctorCheck {
  return { name, ok: false, message, severity: "warning" };
}

function error(name: string, message: string): DoctorCheck {
  return { name, ok: false, message, severity: "error" };
}

function formatDirtyStatus(status: string[]): string {
  const maxEntries = 6;
  const shown = status.slice(0, maxEntries).join(", ");
  const remaining = status.length - maxEntries;
  return remaining > 0 ? `${shown}, and ${remaining} more` : shown;
}

function firstLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}
