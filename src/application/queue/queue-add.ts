import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { normalizeChangeName, parseQueue } from "../../domain/queue/queue.js";
import type { RunnerConfig } from "./runner.js";

export async function queueAdd(config: RunnerConfig, argv: string[]): Promise<number> {
  const change = normalizeChangeName(argv[0] ?? "");
  if (!change) {
    console.error(usage());
    return 2;
  }

  let options: QueueAddOptions;
  try {
    options = parseOptions(argv.slice(1));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    console.error(usage());
    return 2;
  }
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

  const metadataParts = [
    options.dependsOn.length > 0 ? `depends_on: ${options.dependsOn.join(",")}` : undefined,
    options.sourceBranch ? `source_branch: ${options.sourceBranch}` : undefined,
    options.archiveAfterDeclared ? `archive_after: ${options.archiveAfter.join(",")}` : undefined,
  ].filter((part): part is string => Boolean(part));
  const metadata = metadataParts.length > 0 ? ` <!-- ${metadataParts.join("; ")} -->` : "";
  const next = `${current.replace(/\s*$/, "")}${current.trim() ? "\n" : ""}- [ ] deliver ${change}${metadata}\n`;
  await mkdir(dirname(config.queuePath), { recursive: true });
  await writeFile(config.queuePath, next);
  console.log(`Added ${change} to ${config.queuePath}`);
  return 0;
}

type QueueAddOptions = {
  dependsOn: string[];
  sourceBranch?: string;
  archiveAfter: string[];
  archiveAfterDeclared: boolean;
};

function parseOptions(argv: string[]): QueueAddOptions {
  const options: QueueAddOptions = {
    dependsOn: [],
    archiveAfter: [],
    archiveAfterDeclared: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--depends-on" || flag === "--archive-after") {
      const value = argv[index + 1];
      if (value === undefined) {
        throw new Error(`Expected a change name after ${flag}.`);
      }
      const changes = parseChangeList(value, flag);
      if (flag === "--depends-on") {
        options.dependsOn.push(...changes);
      } else {
        options.archiveAfterDeclared = true;
        options.archiveAfter.push(...changes);
      }
      index += 1;
      continue;
    }

    if (flag === "--source-branch") {
      const branch = argv[index + 1]?.trim();
      if (!branch || branch.startsWith("-")) {
        throw new Error("Expected a branch name after --source-branch.");
      }
      if (options.sourceBranch) {
        throw new Error("--source-branch can only be specified once.");
      }
      options.sourceBranch = branch;
      index += 1;
      continue;
    }

    throw new Error(`Unknown queue add option: ${flag}.`);
  }

  options.dependsOn = [...new Set(options.dependsOn)];
  options.archiveAfter = [...new Set(options.archiveAfter)];
  return options;
}

function parseChangeList(value: string, flag: string): string[] {
  if (flag === "--archive-after" && value === "") {
    return [];
  }
  const changes = value
    .split(",")
    .map((candidate) => normalizeChangeName(candidate))
    .filter((candidate): candidate is string => Boolean(candidate));
  if (changes.length === 0) {
    throw new Error(`Expected one or more kebab-case change names after ${flag}.`);
  }
  return changes;
}

function usage(): string {
  return "Usage: openspec-shipper queue add <change-name> [--depends-on <change-name>[,...]] [--source-branch <branch>] [--archive-after <change-name>[,...]]";
}
