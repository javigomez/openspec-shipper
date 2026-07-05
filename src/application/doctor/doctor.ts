import { spawnSync } from "node:child_process";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { readShipperConfig, type ShipperConfig } from "../../domain/config/shipper-config.js";

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
};

const REQUIRED_COMMANDS = [
  ".opencode/commands/openspec-apply-worktree.md",
  ".opencode/commands/openspec-ship-worktree.md",
  ".opencode/commands/openspec-main-sync.md",
  ".opencode/commands/openspec-archive-merged.md",
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
  checks.push(checkCommand(config?.executor.opencode.bin ?? "opencode", ["--version"], projectDir, "OpenCode CLI is available"));
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

  for (const file of REQUIRED_COMMANDS) {
    checks.push((await fileExists(join(projectDir, file))) ? ok(file, `${file} found`) : error(file, `${file} missing`));
  }

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
      : warning(".gitignore worktrees", "Add worktrees/ to .gitignore before running apply workers"),
  );

  checks.push(
    (await fileExists(join(projectDir, ".github/workflows/open-pr-on-branch-push.yml"))) ||
      config?.github.autoOpenPr === false
      ? ok("auto PR workflow", "Auto PR workflow is installed or disabled")
      : warning("auto PR workflow", "Auto PR workflow missing; ship workers push but do not create PRs themselves"),
  );

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

function firstLine(value: string): string | undefined {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}
