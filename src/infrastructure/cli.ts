#!/usr/bin/env node
import { fileURLToPath } from "node:url";
import { printDoctorReport, runDoctor } from "../application/doctor/doctor.js";
import { isShipperProfile, type ShipperProfile } from "../domain/config/shipper-config.js";
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
    const projectDir = parsed.projectDir ?? global.flags.projectDir ?? process.env.OPENSPEC_SHIPPER_PROJECT_DIR ?? process.cwd();
    if (!projectDir) {
      console.error(`OPENSPEC_SHIPPER_PROJECT_DIR is required, or pass it as \`${command} <path>\`.`);
      process.exitCode = 2;
      return;
    }

    const installed = await installShipperKit({
      rootDir: ROOT_DIR,
      projectDir,
      profile: parsed.profile,
      force: parsed.force,
    });
    console.log(`Processed ${installed.length} OpenSpec Shipper file(s) for ${projectDir}:`);
    for (const file of installed) {
      console.log(`- [${file.status}] ${file.target}`);
    }
    process.exitCode = 0;
    return;
  }

  if (normalized.command === "doctor") {
    const projectDir = normalized.args[0] ?? global.flags.projectDir ?? process.env.OPENSPEC_SHIPPER_PROJECT_DIR ?? process.cwd();
    process.exitCode = printDoctorReport(await runDoctor(projectDir));
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

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) {
  await runCli(process.argv.slice(2));
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

function parseTargetOptions(argv: string[]): { projectDir?: string; profile: ShipperProfile; force: boolean } {
  let projectDir: string | undefined;
  let profile: ShipperProfile = "node-npm";
  let force = false;

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg) {
      continue;
    }

    if (arg === "--force") {
      force = true;
      continue;
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

  return { projectDir, profile, force };
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
