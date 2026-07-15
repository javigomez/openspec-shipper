import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { filterLocalStateStatus } from "../../domain/config/local-state.js";
import { readShipperConfig, type ShipperConfig } from "../../domain/config/shipper-config.js";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
};

const REQUIRED_OPENCODE_COMMANDS = [
  ".opencode/commands/openspec-apply-worktree.md",
  ".opencode/commands/openspec-ship-worktree.md",
  ".opencode/commands/openspec-main-sync.md",
  ".opencode/commands/openspec-archive-merged.md",
  ".opencode/commands/openspec-cleanup-worktree.md",
];

const REQUIRED_CODEX_ASSETS = [
  ".openspec-shipper/codex/workflow.md",
  ".openspec-shipper/codex/prompts/implement.md",
  ".openspec-shipper/codex/prompts/push.md",
  ".openspec-shipper/codex/prompts/sync-main.md",
  ".openspec-shipper/codex/prompts/archive.md",
  ".openspec-shipper/codex/prompts/cleanup-worktree.md",
];

const REQUIRED_PACKAGE_SCRIPTS = [
  "openspec:cli",
  "openspec:validate-proposal",
  "lint:branch",
];

export async function runDoctor(projectDir: string): Promise<DoctorCheck[]> {
  const config = (await readShipperConfig(projectDir)) ?? undefined;
  const packageJson = await readPackageJson(projectDir);
  const checks: DoctorCheck[] = [];

  checks.push(checkCommand("git", ["rev-parse", "--is-inside-work-tree"], projectDir, "Git repository detected"));
  checks.push(checkCommand("git", ["rev-parse", "--verify", config?.baseBranch ?? "main"], projectDir, "Base branch exists"));
  checks.push(checkWorkingTreeClean(projectDir));
  checks.push(checkCommand("gh", ["--version"], projectDir, "GitHub CLI is available for PR state reconciliation"));
  checks.push(checkGitHubCliAuth(projectDir));
  checks.push(checkProviderCommand(projectDir, config));
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

  checks.push(
    (await fileExists(join(projectDir, ".github/workflows/open-pr-on-branch-push.yml"))) ||
      config?.github.autoOpenPr === false
      ? ok("auto PR workflow", "Auto PR workflow is installed or disabled")
      : warning("auto PR workflow", "Auto PR workflow missing; push workers push but do not create PRs themselves"),
  );

  if (config?.github.autoOpenPr !== false && (await fileExists(join(projectDir, ".github/workflows/open-pr-on-branch-push.yml")))) {
    checks.push(checkGitHubActionsPullRequestPermission(projectDir));
  }

  return checks;
}

function checkProviderCommand(projectDir: string, config: ShipperConfig | undefined): DoctorCheck {
  const provider = config?.executor.provider ?? "opencode";
  if (provider === "codex-cli") {
    return checkCommand(config?.executor.codex.bin ?? "codex", ["--version"], projectDir, "Codex CLI is available");
  }

  return checkCommand(config?.executor.opencode.bin ?? "opencode", ["--version"], projectDir, "OpenCode CLI is available");
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

  const checks: DoctorCheck[] = [];
  for (const file of REQUIRED_OPENCODE_COMMANDS) {
    checks.push((await fileExists(join(projectDir, file))) ? ok(file, `${file} found`) : error(file, `${file} missing`));
  }
  return checks;
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

export function checkWorkingTreeClean(projectDir: string): DoctorCheck {
  const result = spawnSync("git", ["status", "--short"], {
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
    return ok("working tree", "No non-runtime changes in the main checkout");
  }

  return error(
    "working tree",
    [
      "Main checkout has uncommitted non-runtime changes.",
      "Commit or stash them before running the queue.",
      `Dirty paths: ${formatDirtyStatus(dirty)}.`,
    ].join(" "),
  );
}

function checkGitHubActionsPullRequestPermission(projectDir: string): DoctorCheck {
  const repository = detectGitHubRepository(projectDir);
  if (repository === "missing") {
    return warning("github actions PR permission", "Cannot verify auto-PR permission because git remote origin is missing");
  }

  if (!repository) {
    return warning("github actions PR permission", "Cannot verify auto-PR permission because origin is not a GitHub repo URL");
  }

  const result = spawnSync(
    "gh",
    ["api", `repos/${repository.owner}/${repository.repo}/actions/permissions/workflow`],
    { cwd: projectDir, encoding: "utf8", timeout: 10_000 },
  );
  if (result.error) {
    return warning("github actions PR permission", `Cannot verify auto-PR permission: ${result.error.message}`);
  }

  if (result.status !== 0) {
    const message = firstLine(result.stderr || result.stdout) ?? `gh api exited with code ${result.status}`;
    return warning(
      "github actions PR permission",
      `Cannot verify auto-PR permission with gh api: ${message}. Check Settings > Actions > General manually.`,
    );
  }

  try {
    const parsed = JSON.parse(result.stdout) as {
      can_approve_pull_request_reviews?: unknown;
      default_workflow_permissions?: unknown;
    };
    if (parsed.can_approve_pull_request_reviews !== true) {
      return warning(
        "github actions PR permission",
        "Enable Settings > Actions > General > Workflow permissions > Allow GitHub Actions to create and approve pull requests",
      );
    }

    return ok("github actions PR permission", "GitHub Actions may create pull requests");
  } catch {
    return warning("github actions PR permission", "Cannot parse gh api workflow permission response");
  }
}

function checkGitHubCliAuth(projectDir: string): DoctorCheck {
  const repository = detectGitHubRepository(projectDir);
  if (repository === "missing") {
    return warning("gh auth", "Cannot verify GitHub CLI authentication because git remote origin is missing");
  }

  if (!repository) {
    return warning("gh auth", "Cannot verify GitHub CLI authentication because origin is not a GitHub repo URL");
  }

  return checkCommand("gh", ["auth", "status"], projectDir, "GitHub CLI is authenticated");
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
