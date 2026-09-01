#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { printDoctorReport, runDoctor } from "../application/doctor/doctor.js";
import { isShipperProfile, readShipperConfig, type ArchivePublishMode, type ClaudeSandboxMode, type DeliveryRefreshPolicy, type ExecutorProviderId, type PackageManager, type ShipperProfile } from "../domain/config/shipper-config.js";
import { defaultConfig, runQueue, type RunnerMode } from "../application/queue/runner.js";
import { installShipperKit } from "../application/init/setup.js";
import { loadShipperEnv, type ShipperCliFlags } from "./env/load-shipper-env.js";

const QUEUE_MODES = new Set(["next", "run", "status", "dry-run", "stop", "stats"]);
const ROOT_DIR = fileURLToPath(new URL("../..", import.meta.url));

export async function runCli(argv: string[]): Promise<void> {
  const global = parseGlobalFlags(argv);
  const normalized = normalizeCommand(global.rest);
  await loadShipperEnv(global.flags);

  if (normalized.command === "setup-target" || normalized.command === "init" || normalized.command === "update") {
    const command = normalized.command;
    const parsed = parseTargetOptions(normalized.args);
    const interactive = command === "init" && !parsed.yes && input.isTTY && output.isTTY;
    const options = interactive ? await promptInitOptions(parsed, global.flags) : parsed;
    const projectDir = options.projectDir ?? global.flags.projectDir ?? process.env.OPENSPEC_SHIPPER_PROJECT_DIR ?? process.cwd();
    if (!projectDir) {
      console.error(`OPENSPEC_SHIPPER_PROJECT_DIR is required, or pass it as \`${command} <path>\`.`);
      process.exitCode = 2;
      return;
    }

    const installed = await installShipperKit({
      rootDir: ROOT_DIR,
      projectDir,
      profile: options.profile,
      provider: options.provider ?? providerFlag(global.flags.provider),
      providerBin: options.providerBin,
      model: options.model,
      effort: options.effort,
      permissionMode: options.permissionMode,
      claudeSandbox: options.claudeSandbox,
      archivePublishMode: options.archivePublishMode,
      refreshPolicy: options.refreshPolicy,
      autoMergePr: options.autoMergePr,
      force: options.force,
      installDependencies: command !== "update" && !options.noInstall,
    });
    console.log(`Processed ${installed.length} OpenSpec Shipper file(s) for ${projectDir}:`);
    for (const file of installed) {
      console.log(`- [${file.status}] ${file.target}`);
    }
    console.log("");
    console.log("Next steps:");
    console.log("  Authenticate GitHub CLI if this machine is not already authenticated:");
    console.log("  gh auth login");
    const installedConfig = await readShipperConfig(projectDir);
    if (installedConfig?.executor.provider === "claude-code") {
      console.log("  Authenticate Claude Code if this machine is not already authenticated:");
      console.log(`  ${installedConfig.executor.claude.bin} auth login`);
    }
    if (command !== "update" && options.noInstall) {
      console.log("  Install dependencies before running doctor or the queue:");
      console.log(`  ${dependencyInstallCommand(installedConfig?.packageManager ?? packageManagerFromProfile(options.profile))}`);
    }
    console.log("  Review and commit the installed files on the configured base branch before running the queue.");
    console.log("  Do not commit .openspec-shipper/.env, queue.md, shipper.lock, stop, runs/, tmp/, workspaces/, or worktrees/.");
    console.log("  git status --short");
    console.log("  git add <installed files you want to track>");
    console.log("  git commit -m \"chore: install openspec shipper\"");
    console.log("  openspec-shipper doctor");
    console.log("  openspec-shipper queue add <change-name> [--depends-on <change>] [--source-branch <branch>] [--archive-after <change>]");
    console.log("  openspec-shipper queue dry-run");
    console.log("  openspec-shipper queue run");
    process.exitCode = 0;
    return;
  }

  if (normalized.command === "doctor") {
    const doctorOptions = parseDoctorOptions(normalized.args);
    const projectDir = doctorOptions.projectDir ?? global.flags.projectDir ?? process.env.OPENSPEC_SHIPPER_PROJECT_DIR ?? process.cwd();
    process.exitCode = printDoctorReport(await runDoctor(projectDir, { deep: doctorOptions.deep }));
    return;
  }

  if (normalized.command === "add") {
    const { queueAdd } = await import("../application/queue/queue-add.js");
    process.exitCode = await queueAdd(defaultConfig(), normalized.args);
    return;
  }

  const parsedMode = parseMode([normalized.command, ...normalized.args]);
  if (!parsedMode.mode) {
    process.exitCode = 2;
    return;
  }

  const exitCode = await runQueue(parsedMode.mode, defaultConfig(), { force: parsedMode.force });
  process.exitCode = exitCode;
}

function providerFlag(value: string | undefined): ExecutorProviderId | undefined {
  if (value === "opencode" || value === "codex-cli" || value === "claude-code") {
    return value;
  }

  return undefined;
}

if (isCliEntrypoint()) {
  await runCli(process.argv.slice(2));
}

function isCliEntrypoint(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  try {
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

function parseMode(argv: string[]): { mode?: RunnerMode; force: boolean } {
  const rawMode = argv[0] ?? "next";
  const force = argv.slice(1).includes("--force");
  const unknownArgs = argv.slice(1).filter((arg) => arg !== "--force");
  if (QUEUE_MODES.has(rawMode) && unknownArgs.length === 0) {
    if (force && rawMode !== "stop") {
      console.error("The --force option is only valid with queue stop.");
      return { force };
    }
    return { mode: rawMode as RunnerMode, force };
  }

  console.error(unknownArgs.length > 0 ? `Unknown queue option: ${unknownArgs[0]}` : `Unknown mode: ${rawMode}`);
  console.error("Usage: openspec-shipper [init|update|doctor|queue <add|next|run|status|dry-run|stop|stats>]");
  return { force };
}

function parseTargetOptions(argv: string[]): {
  projectDir?: string;
  profile: ShipperProfile;
  provider?: ExecutorProviderId;
  providerBin?: string;
  model?: string;
  effort?: string;
  permissionMode?: "dontAsk" | "bypassPermissions";
  claudeSandbox?: ClaudeSandboxMode;
  archivePublishMode?: ArchivePublishMode;
  refreshPolicy?: DeliveryRefreshPolicy;
  autoMergePr?: boolean;
  force: boolean;
  yes: boolean;
  noInstall: boolean;
} {
  let projectDir: string | undefined;
  let profile: ShipperProfile = "node-npm";
  let provider: ExecutorProviderId | undefined;
  let providerBin: string | undefined;
  let model: string | undefined;
  let effort: string | undefined;
  let permissionMode: "dontAsk" | "bypassPermissions" | undefined;
  let claudeSandbox: ClaudeSandboxMode | undefined;
  let archivePublishMode: ArchivePublishMode | undefined;
  let refreshPolicy: DeliveryRefreshPolicy | undefined;
  let autoMergePr: boolean | undefined;
  let force = false;
  let yes = false;
  let noInstall = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--force") {
      force = true;
      continue;
    }

    if (arg === "--yes" || arg === "-y") {
      yes = true;
      continue;
    }

    if (arg === "--no-install") {
      noInstall = true;
      continue;
    }

    if (arg === "--provider") {
      const next = argv[index + 1];
      if (next === "opencode" || next === "codex-cli" || next === "claude-code") {
        provider = next;
        index += 1;
        continue;
      }

      throw new Error("Expected --provider to be one of opencode, codex-cli, claude-code.");
    }

    if (arg === "--provider-bin" && argv[index + 1]) {
      providerBin = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--model" && argv[index + 1]) {
      model = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--effort" && argv[index + 1]) {
      effort = argv[index + 1];
      index += 1;
      continue;
    }

    if (arg === "--permission-mode") {
      const next = argv[index + 1];
      if (next === "dontAsk" || next === "bypassPermissions") {
        permissionMode = next;
        index += 1;
        continue;
      }
      throw new Error("Expected --permission-mode to be one of dontAsk, bypassPermissions.");
    }

    if (arg === "--claude-sandbox") {
      const next = argv[index + 1];
      if (next === "strict" || next === "permissive" || next === "off") {
        claudeSandbox = next;
        index += 1;
        continue;
      }
      throw new Error("Expected --claude-sandbox to be one of strict, permissive, off.");
    }

    if (arg === "--archive-publish") {
      const next = argv[index + 1];
      if (next === "direct" || next === "pull-request") {
        archivePublishMode = next;
        index += 1;
        continue;
      }
      throw new Error("Expected --archive-publish to be direct or pull-request.");
    }

    if (arg === "--refresh-policy") {
      const next = argv[index + 1];
      if (next === "auto" || next === "always" || next === "conflicts-only" || next === "never") {
        refreshPolicy = next;
        index += 1;
        continue;
      }
      throw new Error("Expected --refresh-policy to be auto, always, conflicts-only, or never.");
    }

    if (arg === "--package-manager") {
      const next = argv[index + 1];
      if (next === "npm" || next === "pnpm" || next === "bun") {
        profile = profileForPackageManager(next);
        index += 1;
        continue;
      }

      throw new Error("Expected --package-manager to be one of npm, pnpm, bun.");
    }

    if (arg === "--profile") {
      const next = argv[index + 1];
      if (next && isShipperProfile(next)) {
        profile = next;
        index += 1;
        continue;
      }

      throw new Error("Expected --profile to be one of generic, node-npm, node-pnpm, bun.");
    }

    if (!projectDir) {
      projectDir = arg;
    }
  }

  return { projectDir, profile, provider, providerBin, model, effort, permissionMode, claudeSandbox, archivePublishMode, refreshPolicy, autoMergePr, force, yes, noInstall };
}

function profileForPackageManager(packageManager: PackageManager): ShipperProfile {
  switch (packageManager) {
    case "npm":
      return "node-npm";
    case "pnpm":
      return "node-pnpm";
    case "bun":
      return "bun";
  }
}

async function promptInitOptions(
  parsed: ReturnType<typeof parseTargetOptions>,
  flags: ShipperCliFlags,
): Promise<ReturnType<typeof parseTargetOptions>> {
  const rl = createInterface({ input, output });
  try {
    const defaultProjectDir = parsed.projectDir ?? flags.projectDir ?? process.cwd();
    const explain = (description: string) => {
      console.log(`\n${description}`);
    };

    console.log("OpenSpec Shipper setup");
    console.log("The choices below are recommendations, not permanent decisions. You can change them later in .openspec-shipper/config.json or by running init/update with the relevant options.");
    console.log("When in doubt, press Enter to keep the default shown in parentheses.");

    explain("Project directory is the repository where Shipper installs its files and runs the queue. Leave the default to use the current directory.");
    const projectDir = answerOrDefault(
      await rl.question(`Project directory (${defaultProjectDir}): `),
      defaultProjectDir,
    );
    const detectedPackageManager = await detectPackageManager(projectDir);
    explain("The package manager is used to install dependencies in fresh worktrees. The default is detected from the repository lockfile; keep it unless this project intentionally uses another package manager.");
    const packageManager = parsePackageManager(
      answerOrDefault(
        await rl.question(`Package manager npm|pnpm|bun (${detectedPackageManager}): `),
        detectedPackageManager,
      ),
      detectedPackageManager,
    );
    explain("The provider is the AI executor that implements changes and reconciles OpenSpec archives. Codex CLI is the default; OpenCode and Claude Code are alternatives with different local setup and model options.");
    const provider = parseProvider(
      answerOrDefault(
        await rl.question(`Provider opencode|codex-cli|claude-code (${parsed.provider ?? providerFlag(flags.provider) ?? "codex-cli"}): `),
        parsed.provider ?? providerFlag(flags.provider) ?? "codex-cli",
      ),
      parsed.provider ?? providerFlag(flags.provider) ?? "codex-cli",
    );
    let providerBin = parsed.providerBin;
    let model = parsed.model;
    let effort = parsed.effort;
    let claudeSandbox = parsed.claudeSandbox;
    if (provider === "claude-code") {
      explain("This is the command Shipper will invoke for Claude Code. Keep `claude` unless the CLI is installed under another name or at a custom path.");
      providerBin = answerOrDefault(await rl.question(`Claude Code binary (${parsed.providerBin ?? "claude"}): `), parsed.providerBin ?? "claude");
      explain("This model performs the implementation and archive work. Keep the provider default unless you have a deliberate model choice for this project.");
      model = answerOrDefault(await rl.question(`Claude model (${parsed.model ?? "sonnet"}): `), parsed.model ?? "sonnet");
      explain("Higher effort can help with difficult changes but uses more time and tokens. Lower effort is faster and cheaper; keep the default if you are unsure.");
      effort = parseClaudeEffort(
        answerOrDefault(await rl.question(`Claude effort low|medium|high (${parsed.effort ?? "low"}): `), parsed.effort ?? "low"),
        parsed.effort ?? "low",
      );
      explain("Strict sandbox is the safest default. Permissive or off relaxes Claude's restrictions when the CLI cannot operate under strict sandboxing, but gives the executor more access to the machine. Keep strict if you are unsure.");
      claudeSandbox = parseClaudeSandbox(
        answerOrDefault(
          await rl.question(`Claude sandbox strict|permissive|off (${parsed.claudeSandbox ?? "strict"}): `),
          parsed.claudeSandbox ?? "strict",
        ),
        parsed.claudeSandbox ?? "strict",
      );
    }
    explain("Archive publication controls how the final OpenSpec archive reaches the base branch. `direct` commits and pushes it directly, which is fastest but requires push permission and an unprotected branch. `pull-request` publishes the archive through another PR, which suits protected branches but adds a review and merge step. If you are unsure, keep the default and let `doctor` identify GitHub policy conflicts.");
    const archivePublishMode = parseArchivePublishMode(
      answerOrDefault(
        await rl.question(`Archive publication direct|pull-request (${parsed.archivePublishMode ?? "direct"}): `),
        parsed.archivePublishMode ?? "direct",
      ),
      parsed.archivePublishMode ?? "direct",
    );
    explain("Delivery refresh controls when Shipper refreshes delivery branches from the remote base branch. `auto` refreshes when needed, `always` is more conservative, `conflicts-only` reduces work, and `never` can leave branches stale. Keep `auto` unless you have a specific branch policy.");
    const refreshPolicy = parseRefreshPolicy(
      answerOrDefault(
        await rl.question(`Delivery refresh auto|always|conflicts-only|never (${parsed.refreshPolicy ?? "auto"}): `),
        parsed.refreshPolicy ?? "auto",
      ),
      parsed.refreshPolicy ?? "auto",
    );
    const existingConfig = await readShipperConfig(projectDir);
    const autoMergeDefault = parsed.autoMergePr ?? existingConfig?.github.autoMergePr ?? false;
    explain("Auto-merge asks GitHub to squash-merge implementation pull requests after required checks and approvals pass. Without branch protection or required checks, GitHub may merge immediately. Keep no unless the base branch is protected and CI is configured.");
    const autoMergePr = parseYesNo(
      answerOrDefault(
        await rl.question(`Enable auto-merge for implementation pull requests? yes|no (${autoMergeDefault ? "yes" : "no"}): `),
        autoMergeDefault ? "yes" : "no",
      ),
      autoMergeDefault,
    );
    explain("Installing dependencies now lets doctor and the queue work immediately, including in fresh worktrees. Choose no for vendored dependencies, offline repositories, or when you prefer to install manually. Keep yes unless you know this project does not need it.");
    const installDependencies = parseYesNo(
      answerOrDefault(await rl.question(`Install dependencies now? yes|no (${parsed.noInstall ? "no" : "yes"}): `), parsed.noInstall ? "no" : "yes"),
      !parsed.noInstall,
    );

    return {
      ...parsed,
      projectDir,
      profile: profileForPackageManager(packageManager),
      provider,
      providerBin,
      model,
      effort,
      claudeSandbox,
      archivePublishMode,
      refreshPolicy,
      autoMergePr,
      noInstall: !installDependencies,
    };
  } finally {
    rl.close();
  }
}

function parseRefreshPolicy(value: string, fallback: DeliveryRefreshPolicy): DeliveryRefreshPolicy {
  return value === "auto" || value === "always" || value === "conflicts-only" || value === "never"
    ? value
    : fallback;
}

function parseArchivePublishMode(value: string, fallback: ArchivePublishMode): ArchivePublishMode {
  return value === "direct" || value === "pull-request" ? value : fallback;
}

function parseClaudeSandbox(value: string, fallback: ClaudeSandboxMode): ClaudeSandboxMode {
  return value === "strict" || value === "permissive" || value === "off" ? value : fallback;
}

function parseDoctorOptions(argv: string[]): { projectDir?: string; deep: boolean } {
  let projectDir: string | undefined;
  let deep = false;
  for (const arg of argv) {
    if (arg === "--deep") {
      deep = true;
    } else if (!projectDir) {
      projectDir = arg;
    }
  }
  return { projectDir, deep };
}

function parseClaudeEffort(value: string, fallback: string): string {
  return value === "low" || value === "medium" || value === "high" ? value : fallback;
}

function parseYesNo(value: string, fallback: boolean): boolean {
  const normalized = value.trim().toLowerCase();
  if (normalized === "yes" || normalized === "y") {
    return true;
  }
  if (normalized === "no" || normalized === "n") {
    return false;
  }
  return fallback;
}

function packageManagerFromProfile(profile: ShipperProfile): PackageManager {
  switch (profile) {
    case "node-pnpm":
      return "pnpm";
    case "bun":
      return "bun";
    case "generic":
    case "node-npm":
      return "npm";
  }
}

function dependencyInstallCommand(packageManager: PackageManager): string {
  switch (packageManager) {
    case "bun":
      return "bun install";
    case "pnpm":
      return "pnpm install";
    case "npm":
      return "npm install";
  }
}

function answerOrDefault(answer: string, fallback: string): string {
  const trimmed = answer.trim();
  return trimmed || fallback;
}

function parseProvider(value: string, fallback: ExecutorProviderId): ExecutorProviderId {
  return value === "opencode" || value === "codex-cli" || value === "claude-code" ? value : fallback;
}

function parsePackageManager(value: string, fallback: PackageManager): PackageManager {
  return value === "npm" || value === "pnpm" || value === "bun" ? value : fallback;
}

async function detectPackageManager(projectDir: string): Promise<PackageManager> {
  if (await fileExists(`${projectDir}/pnpm-lock.yaml`)) {
    return "pnpm";
  }
  if (await fileExists(`${projectDir}/bun.lock`) || await fileExists(`${projectDir}/bun.lockb`)) {
    return "bun";
  }
  return "npm";
}

async function fileExists(path: string): Promise<boolean> {
  return await access(path)
    .then(() => true)
    .catch(() => false);
}

function normalizeCommand(argv: string[]): { command: string; args: string[] } {
  if (argv[0] === "queue") {
    return { command: argv[1] ?? "status", args: argv.slice(2) };
  }

  if (argv[0] === "add") {
    return { command: "add", args: argv.slice(1) };
  }

  return { command: argv[0] ?? "next", args: argv.slice(1) };
}

function parseGlobalFlags(argv: string[]): { flags: ShipperCliFlags; rest: string[] } {
  const flags: ShipperCliFlags = {};
  const rest: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];

    if (arg === "--project" && next) {
      flags.projectDir = next;
      index += 1;
    } else if (arg === "--queue" && next) {
      flags.queuePath = next;
      index += 1;
    } else if (arg === "--env-file" && next) {
      flags.envFile = next;
      index += 1;
    } else if (arg === "--provider" && next) {
      flags.provider = next;
      index += 1;
    } else if (arg) {
      rest.push(arg);
    }
  }

  return { flags, rest };
}
