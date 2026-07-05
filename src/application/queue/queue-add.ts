import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeChangeName, parseQueue } from "../../domain/queue/queue.js";
import type { RunnerConfig } from "./runner.js";

export async function queueAdd(config: RunnerConfig, argv: string[]): Promise<number> {
  const change = normalizeChangeName(argv[0] ?? "");
  if (!change) {
    console.error("Usage: openspec-shipper queue add <change-name> [--depends-on <change-name>]");
    return 2;
  }

  const dependsOn = parseDependsOn(argv.slice(1));
  const current = await readFile(config.queuePath, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const parsed = parseQueue(current);

  if (parsed.tasks.some((task) => task.change === change)) {
    console.log(`Queue already contains ${change}: ${config.queuePath}`);
    return 0;
  }

  const metadata = dependsOn ? ` <!-- depends_on: ${dependsOn} -->` : "";
  const next = `${current.replace(/\s*$/, "")}${current.trim() ? "\n" : ""}- [ ] deliver ${change}${metadata}\n`;
  await mkdir(dirname(config.queuePath), { recursive: true });
  await writeFile(config.queuePath, next);
  console.log(`Added ${change} to ${config.queuePath}`);
  return 0;
}

function parseDependsOn(argv: string[]): string | undefined {
  const index = argv.indexOf("--depends-on");
  if (index === -1) {
    return undefined;
  }

  return normalizeChangeName(argv[index + 1] ?? "");
}
