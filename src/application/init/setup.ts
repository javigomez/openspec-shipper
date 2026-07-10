import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  CONFIG_PATH,
  DEFAULT_QUEUE_PATH,
  ENV_EXAMPLE_PATH,
  defaultShipperConfig,
  type ExecutorProviderId,
  type ShipperProfile,
} from "../../domain/config/shipper-config.js";

export type SetupConfig = {
  rootDir: string;
  projectDir: string;
  profile?: ShipperProfile;
  provider?: ExecutorProviderId;
  force?: boolean;
};

export type InstalledFile = {
  source: string;
  target: string;
  status: "installed" | "updated" | "unchanged" | "drifted";
};

const TEMPLATE_DIR = "templates/providers/opencode/assets";
const TARGET_DIR = ".opencode";
const TARGET_TEMPLATE_DIR = "templates/target";
const MANIFEST_PATH = ".openspec-shipper/installed.json";
const SHIPPER_GITIGNORE_HEADER = "# OpenSpec Shipper local state";
const SHIPPER_GITIGNORE_ENTRIES = [
  ".openspec-shipper/.env",
  ".openspec-shipper/queue.md",
  ".openspec-shipper/runs/",
  ".openspec-shipper/tmp/",
  "worktrees/",
];

type Manifest = {
  version: 1;
  installedAt: string;
  files: Record<string, ManifestFile>;
};

type ManifestFile = {
  sourceHash: string;
  targetHash: string;
};

export async function installOpenCodeTemplates(config: SetupConfig): Promise<InstalledFile[]> {
  const sourceRoot = join(config.rootDir, TEMPLATE_DIR);
  const targetRoot = join(config.projectDir, TARGET_DIR);
  return await installTemplateTree(config, sourceRoot, targetRoot);
}

export async function installShipperKit(config: SetupConfig): Promise<InstalledFile[]> {
  const profile = config.profile ?? "node-npm";
  const installed = [
    ...(await installOpenCodeTemplates(config)),
    ...(await installTemplateTree(config, join(config.rootDir, TARGET_TEMPLATE_DIR), config.projectDir)),
  ];

  const configPath = join(config.projectDir, CONFIG_PATH);
  const shipperConfig = defaultShipperConfig(profile);
  if (config.provider) {
    shipperConfig.executor.provider = config.provider;
  }
  const configContent = `${JSON.stringify(shipperConfig, null, 2)}\n`;
  installed.push(await installGeneratedFile(config, "generated:shipper-config", configPath, configContent));
  installed.push(await installGeneratedFile(config, "generated:shipper-env-example", join(config.projectDir, ENV_EXAMPLE_PATH), defaultEnvExample()));
  installed.push(await ensureQueueFile(config.projectDir));
  installed.push(await installGeneratedFile(config, "generated:shipper-queue-example", join(config.projectDir, ".openspec-shipper/queue.example.md"), defaultQueueExample()));

  const gitignorePath = join(config.projectDir, ".gitignore");
  installed.push(await ensureShipperGitignore(config, gitignorePath));

  installed.push(await updatePackageJson(config));

  return installed;
}

async function ensureShipperGitignore(config: SetupConfig, gitignorePath: string): Promise<InstalledFile> {
  const currentGitignore = await readText(gitignorePath);
  const nextGitignore = shipperGitignoreContent(currentGitignore);

  if (currentGitignore === nextGitignore) {
    return { source: "generated:gitignore", target: gitignorePath, status: "unchanged" };
  }

  await writeFile(gitignorePath, nextGitignore);
  return { source: "generated:gitignore", target: gitignorePath, status: currentGitignore ? "updated" : "installed" };
}

function shipperGitignoreContent(currentGitignore: string | undefined): string {
  const current = currentGitignore ?? "";
  const missingEntries = SHIPPER_GITIGNORE_ENTRIES.filter((entry) => !gitignoreContainsEntry(current, entry));
  if (missingEntries.length === 0) {
    return current;
  }

  if (current.includes("# OpenSpec Shipper")) {
    return `${current.replace(/\s*$/, "\n")}${missingEntries.join("\n")}\n`;
  }

  const block = [SHIPPER_GITIGNORE_HEADER, ...missingEntries].join("\n");
  const prefix = current ? `${current.replace(/\s*$/, "\n\n")}` : "";
  return `${prefix}${block}\n`;
}

function gitignoreContainsEntry(content: string, entry: string): boolean {
  return content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === entry);
}

export const installOrchesterKit = installShipperKit;

async function installTemplateTree(
  config: SetupConfig,
  sourceRoot: string,
  targetRoot: string,
): Promise<InstalledFile[]> {
  const files = await listTemplateFiles(sourceRoot);
  const installed: InstalledFile[] = [];

  for (const source of files) {
    const target = join(targetRoot, relative(sourceRoot, source).replace(/\.template$/, ""));
    const content = await readFile(source, "utf8");
    installed.push(await installGeneratedFile(config, source, target, content));
  }

  return installed;
}

async function installGeneratedFile(
  config: SetupConfig,
  source: string,
  target: string,
  content: string,
): Promise<InstalledFile> {
  const manifest = await readManifest(config.projectDir);
  const relativeTarget = relative(config.projectDir, target);
  const previous = manifest.files[relativeTarget];
  const currentContent = await readText(target);
  const sourceHash = hash(content);

  if (currentContent !== undefined) {
    const currentHash = hash(currentContent);
    if (currentHash === sourceHash) {
      return { source, target, status: "unchanged" };
    }

    if (!config.force && (!previous || previous.targetHash !== currentHash)) {
      return { source, target, status: "drifted" };
    }
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
  await writeManifest(config.projectDir, {
    ...manifest,
    installedAt: new Date().toISOString(),
    files: {
      ...manifest.files,
      [relativeTarget]: {
        sourceHash,
        targetHash: sourceHash,
      },
    },
  });

  return {
    source,
    target,
    status: currentContent === undefined ? "installed" : "updated",
  };
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

async function readManifest(projectDir: string): Promise<Manifest> {
  const raw = await readText(join(projectDir, MANIFEST_PATH));
  if (!raw) {
    return { version: 1, installedAt: new Date().toISOString(), files: {} };
  }

  return JSON.parse(raw) as Manifest;
}

async function writeManifest(projectDir: string, manifest: Manifest): Promise<void> {
  const target = join(projectDir, MANIFEST_PATH);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`);
}

async function readText(path: string): Promise<string | undefined> {
  return await readFile(path, "utf8").catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  });
}

async function ensureQueueFile(projectDir: string): Promise<InstalledFile> {
  const target = join(projectDir, DEFAULT_QUEUE_PATH);
  const currentContent = await readText(target);
  if (currentContent !== undefined) {
    return { source: "generated:shipper-queue", target, status: "unchanged" };
  }

  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, "# OpenSpec Shipper Queue\n\n");
  return { source: "generated:shipper-queue", target, status: "installed" };
}

function hash(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

async function updatePackageJson(config: SetupConfig): Promise<InstalledFile> {
  const target = join(config.projectDir, "package.json");
  const raw = await readText(target);
  const packageJson = raw ? JSON.parse(raw) : {};
  const before = JSON.stringify(packageJson, null, 2);

  packageJson.scripts = {
    ...defaultScripts(),
    ...(packageJson.scripts ?? {}),
  };
  packageJson.devDependencies = {
    ...defaultDevDependencies(),
    ...(packageJson.devDependencies ?? {}),
  };

  const after = JSON.stringify(packageJson, null, 2);
  if (after === before) {
    return { source: "generated:package-json", target, status: "unchanged" };
  }

  await writeFile(target, `${after}\n`);
  return { source: "generated:package-json", target, status: raw ? "updated" : "installed" };
}

function defaultScripts(): Record<string, string> {
  return {
    "openspec:cli": "env OPENSPEC_TELEMETRY=0 DO_NOT_TRACK=1 openspec",
    "openspec:validate-proposal": "node .openspec-shipper/scripts/validate-openspec-proposal.mjs",
    "lint:branch": "node .openspec-shipper/scripts/validate-branch-name.mjs",
    "lint:commits": "commitlint --from origin/main --to HEAD",
  };
}

function defaultDevDependencies(): Record<string, string> {
  return {
    "@commitlint/cli": "^21.0.2",
    "@commitlint/config-conventional": "^21.0.2",
    "@fission-ai/openspec": "^1.2.0",
  };
}

function defaultEnvExample(): string {
  return [
    "OPENSPEC_SHIPPER_PROVIDER=opencode",
    "OPENSPEC_SHIPPER_OPENCODE_BIN=opencode",
    "OPENSPEC_SHIPPER_OPENCODE_MODEL=opencode-go/deepseek-v4-pro",
    "OPENSPEC_SHIPPER_CODEX_BIN=codex",
    "OPENSPEC_SHIPPER_CODEX_MODEL=gpt-5.4",
    "OPENSPEC_SHIPPER_PRINT_LOGS=1",
    "OPENSPEC_SHIPPER_LOG_LEVEL=ERROR",
    "",
  ].join("\n");
}

function defaultQueueExample(): string {
  return [
    "# OpenSpec Changes to ship",
    "",
    "- [ ] deliver CHANGE_NAME",
    "",
  ].join("\n");
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
