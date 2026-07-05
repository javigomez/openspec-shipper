import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { CONFIG_PATH } from "../../domain/config/shipper-config.js";

export function discoverProjectDirSync(cwd = process.cwd()): string {
  let current = resolve(cwd);

  while (true) {
    if (existsSync(join(current, CONFIG_PATH))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(cwd);
    }
    current = parent;
  }
}

export async function discoverProjectDir(cwd = process.cwd()): Promise<string> {
  let current = resolve(cwd);

  while (true) {
    if (await fileExists(join(current, CONFIG_PATH))) {
      return current;
    }

    const parent = dirname(current);
    if (parent === current) {
      return resolve(cwd);
    }
    current = parent;
  }
}

async function fileExists(path: string): Promise<boolean> {
  return await access(path).then(
    () => true,
    () => false,
  );
}
