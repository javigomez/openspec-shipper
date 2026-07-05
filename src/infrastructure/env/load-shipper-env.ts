import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { ENV_PATH } from "../../domain/config/shipper-config.js";

export type ShipperCliFlags = {
  projectDir?: string;
  queuePath?: string;
  envFile?: string;
  provider?: string;
};

export async function loadShipperEnv(flags: ShipperCliFlags, cwd = process.cwd()): Promise<void> {
  const projectDir = flags.projectDir ?? process.env.OPENSPEC_SHIPPER_PROJECT_DIR ?? cwd;
  const envFile = flags.envFile ?? join(projectDir, ENV_PATH);
  const values = await readEnvFile(envFile);

  for (const [key, value] of Object.entries(values)) {
    if (key.startsWith("OPENSPEC_SHIPPER_") && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }

  if (flags.projectDir) {
    process.env.OPENSPEC_SHIPPER_PROJECT_DIR = flags.projectDir;
  }
  if (flags.queuePath) {
    process.env.OPENSPEC_SHIPPER_QUEUE_PATH = flags.queuePath;
  }
  if (flags.provider) {
    process.env.OPENSPEC_SHIPPER_PROVIDER = flags.provider;
  }
}

async function readEnvFile(path: string): Promise<Record<string, string>> {
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") {
      return "";
    }
    throw error;
  });
  const values: Record<string, string> = {};

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) {
      continue;
    }

    const index = trimmed.indexOf("=");
    if (index === -1) {
      continue;
    }

    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    values[key] = value;
  }

  return values;
}
