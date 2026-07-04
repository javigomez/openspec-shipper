import "dotenv/config";
import { fileURLToPath } from "node:url";
import { printDoctorReport, runDoctor } from "./doctor";
import { isOrchesterProfile, type OrchesterProfile } from "./orchester-config";
import { defaultConfig, runQueue, type RunnerMode } from "./runner";
import { installOrchesterKit } from "./setup";

const MODES = new Set(["next", "run", "status", "dry-run", "stop", "stats"]);
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

export async function runCli(argv: string[]): Promise<void> {
  if (argv[0] === "setup-target" || argv[0] === "init" || argv[0] === "update") {
    const command = argv[0];
    const parsed = parseTargetOptions(argv.slice(1));
    const projectDir = parsed.projectDir ?? process.env.PROJECT_DIR;
    if (!projectDir) {
      console.error(`PROJECT_DIR is required, or pass it as \`${command} <path>\`.`);
      process.exitCode = 2;
      return;
    }

    const installed = await installOrchesterKit({
      rootDir: ROOT_DIR,
      projectDir,
      profile: parsed.profile,
      force: parsed.force,
    });
    console.log(`Processed ${installed.length} Orchester file(s) for ${projectDir}:`);
    for (const file of installed) {
      console.log(`- [${file.status}] ${file.target}`);
    }
    process.exitCode = 0;
    return;
  }

  if (argv[0] === "doctor") {
    const projectDir = argv[1] ?? process.env.PROJECT_DIR;
    if (!projectDir) {
      console.error("PROJECT_DIR is required, or pass it as `doctor <path>`.");
      process.exitCode = 2;
      return;
    }

    process.exitCode = printDoctorReport(await runDoctor(projectDir));
    return;
  }

  const mode = parseMode(argv);
  if (!mode) {
    process.exitCode = 2;
    return;
  }

  const exitCode = await runQueue(mode, defaultConfig());
  process.exitCode = exitCode;
}

function parseMode(argv: string[]): RunnerMode | undefined {
  const rawMode = argv[0] ?? "next";
  if (MODES.has(rawMode)) {
    return rawMode as RunnerMode;
  }

  console.error(`Unknown mode: ${rawMode}`);
  console.error("Usage: bun run index.ts [next|run|status|dry-run|stop|stats|init|update|doctor|setup-target]");
  return undefined;
}

function parseTargetOptions(argv: string[]): { projectDir?: string; profile: OrchesterProfile; force: boolean } {
  let projectDir: string | undefined;
  let profile: OrchesterProfile = "node-npm";
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
      if (next && isOrchesterProfile(next)) {
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
