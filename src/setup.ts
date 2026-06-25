import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";

export type SetupConfig = {
  rootDir: string;
  projectDir: string;
};

type InstalledFile = {
  source: string;
  target: string;
};

const TEMPLATE_DIR = "templates/opencode";
const TARGET_DIR = ".opencode";

export async function installOpenCodeTemplates(config: SetupConfig): Promise<InstalledFile[]> {
  const sourceRoot = join(config.rootDir, TEMPLATE_DIR);
  const targetRoot = join(config.projectDir, TARGET_DIR);
  const files = await listTemplateFiles(sourceRoot);
  const installed: InstalledFile[] = [];

  for (const source of files) {
    const target = join(targetRoot, relative(sourceRoot, source));
    const content = await readFile(source, "utf8");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
    installed.push({ source, target });
  }

  return installed;
}

async function listTemplateFiles(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listTemplateFiles(path)));
    } else if (entry.isFile()) {
      files.push(path);
    }
  }

  return files.sort();
}
