import "dotenv/config";
import { fileURLToPath } from "node:url";
import { defaultConfig, runQueue, type RunnerMode } from "./runner";
import { installOpenCodeTemplates } from "./setup";

const MODES = new Set(["next", "run", "status", "dry-run", "stop", "stats"]);
const ROOT_DIR = fileURLToPath(new URL("..", import.meta.url));

export async function runCli(argv: string[]): Promise<void> {
  if (argv[0] === "setup-target") {
    const projectDir = argv[1] ?? process.env.PROJECT_DIR;
    if (!projectDir) {
      console.error("PROJECT_DIR is required, or pass it as `setup-target <path>`.");
      process.exitCode = 2;
      return;
    }

    const installed = await installOpenCodeTemplates({ rootDir: ROOT_DIR, projectDir });
    console.log(`Installed ${installed.length} OpenCode template file(s) into ${projectDir}/.opencode:`);
    for (const file of installed) {
      console.log(`- ${file.target}`);
    }
    process.exitCode = 0;
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
  console.error("Usage: bun run index.ts [next|run|status|dry-run|stop|stats|setup-target <path>]");
  return undefined;
}
