#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { access } from "node:fs/promises";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { stdin as input, stdout as output } from "node:process";
import { printDoctorReport, runDoctor } from "../application/doctor/doctor.js";
import { isShipperProfile, readShipperConfig, type ClaudeSandboxMode, type ExecutorProviderId, type PackageManager, type ShipperProfile } from "../domain/config/shipper-config.js";
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
    console.log("  Do not commit .openspec-shipper/.env, queue.md, shipper.lock, stop, runs/, tmp/, or worktrees/.");
    console.log("  git status --short");
    console.log("  git add <installed files you want to track>");
    console.log("  git commit -m \"chore: install openspec shipper\"");
    console.log("  openspec-shipper doctor");
    console.log("  openspec-shipper queue add <change-name>");
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

  const mode = parseMode([normalized.command, ...normalized.args]);
  if (!mode) {
    process.exitCode = 2;
    return;
  }

  const exitCode = await runQueue(mode, defaultConfig());
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

function parseMode(argv: string[]): RunnerMode | undefined {
  const rawMode = argv[0] ?? "next";
  if (QUEUE_MODES.has(rawMode)) {
    return rawMode as RunnerMode;
  }

  console.error(`Unknown mode: ${rawMode}`);
  console.error("Usage: openspec-shipper [init|update|doctor|queue <add|next|run|status|dry-run|stop|stats>]");
  return undefined;
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

  return { projectDir, profile, provider, providerBin, model, effort, permissionMode, claudeSandbox, force, yes, noInstall };
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
    const projectDir = answerOrDefault(
      await rl.question(`Project directory (${defaultProjectDir}): `),
      defaultProjectDir,
    );
    const detectedPackageManager = await detectPackageManager(projectDir);
    const packageManager = parsePackageManager(
      answerOrDefault(
        await rl.question(`Package manager npm|pnpm|bun (${detectedPackageManager}): `),
        detectedPackageManager,
      ),
      detectedPackageManager,
    );
    const provider = parseProvider(
      answerOrDefault(
        await rl.question(`Provider opencode|codex-cli|claude-code (${parsed.provider ?? providerFlag(flags.provider) ?? "opencode"}): `),
        parsed.provider ?? providerFlag(flags.provider) ?? "opencode",
      ),
      parsed.provider ?? providerFlag(flags.provider) ?? "opencode",
    );
    const providerBin = provider === "claude-code"
      ? answerOrDefault(await rl.question(`Claude Code binary (${parsed.providerBin ?? "claude"}): `), parsed.providerBin ?? "claude")
      : parsed.providerBin;
    const model = provider === "claude-code"
      ? answerOrDefault(await rl.question(`Claude model (${parsed.model ?? "sonnet"}): `), parsed.model ?? "sonnet")
      : parsed.model;
    const effort = provider === "claude-code"
      ? parseClaudeEffort(answerOrDefault(await rl.question(`Claude effort low|medium|high (${parsed.effort ?? "low"}): `), parsed.effort ?? "low"), parsed.effort ?? "low")
      : parsed.effort;
    const claudeSandbox = provider === "claude-code"
      ? parseClaudeSandbox(answerOrDefault(
          await rl.question(`Claude sandbox strict|permissive|off (${parsed.claudeSandbox ?? "strict"}): `),
          parsed.claudeSandbox ?? "strict",
        ), parsed.claudeSandbox ?? "strict")
      : parsed.claudeSandbox;
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
      noInstall: !installDependencies,
    };
  } finally {
    rl.close();
  }
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
