import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import {
  CONFIG_PATH,
  DEFAULT_QUEUE_PATH,
  ENV_EXAMPLE_PATH,
  defaultShipperConfig,
  readShipperConfig,
  type ArchivePublishMode,
  type ClaudeSandboxMode,
  type DeliveryRefreshPolicy,
  type ExecutorProviderId,
  type PackageManager,
  type ShipperProfile,
} from "../../domain/config/shipper-config.js";
import { claudeSettingsContent } from "../../infrastructure/providers/claude-code/provider.js";

export type SetupConfig = {
  rootDir: string;
  projectDir: string;
  profile?: ShipperProfile;
  provider?: ExecutorProviderId;
  providerBin?: string;
  model?: string;
  effort?: string;
  permissionMode?: "dontAsk" | "bypassPermissions";
  claudeSandbox?: ClaudeSandboxMode;
  archivePublishMode?: ArchivePublishMode;
  refreshPolicy?: DeliveryRefreshPolicy;
  force?: boolean;
  installDependencies?: boolean;
  dependencyInstaller?: DependencyInstaller;
};

export type DependencyInstaller = (input: DependencyInstallInput) => Promise<string>;
export type DependencyInstallInput = {
  projectDir: string;
  packageManager: PackageManager;
};

export type InstalledFile = {
  source: string;
  target: string;
  status: "installed" | "updated" | "unchanged" | "drifted";
};

const OPENCODE_TEMPLATE_DIR = "templates/providers/opencode/assets";
const OPENCODE_TARGET_DIR = ".opencode";
const CODEX_TEMPLATE_DIR = "templates/providers/codex-cli/assets";
const CODEX_TARGET_DIR = ".openspec-shipper/codex";
const CLAUDE_TEMPLATE_DIR = "templates/providers/claude-code/assets";
const CLAUDE_TARGET_DIR = ".openspec-shipper/claude";
const TARGET_TEMPLATE_DIR = "templates/target";
const MANIFEST_PATH = ".openspec-shipper/installed.json";
const SHIPPER_GITIGNORE_HEADER = "# OpenSpec Shipper local state";
const SHIPPER_GITIGNORE_ENTRIES = [
  ".openspec-shipper/.env",
  ".openspec-shipper/queue.md",
  ".openspec-shipper/shipper.lock",
  ".openspec-shipper/stop",
  ".openspec-shipper/runs/",
  ".openspec-shipper/tmp/",
  ".openspec-shipper/workspaces/",
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
  const sourceRoot = join(config.rootDir, OPENCODE_TEMPLATE_DIR);
  const targetRoot = join(config.projectDir, OPENCODE_TARGET_DIR);
  return await installTemplateTree(config, sourceRoot, targetRoot);
}

export async function installCodexTemplates(config: SetupConfig): Promise<InstalledFile[]> {
  const sourceRoot = join(config.rootDir, CODEX_TEMPLATE_DIR);
  const targetRoot = join(config.projectDir, CODEX_TARGET_DIR);
  return await installTemplateTree(config, sourceRoot, targetRoot);
}

export async function installClaudeTemplates(config: SetupConfig): Promise<InstalledFile[]> {
  const sourceRoot = join(config.rootDir, CLAUDE_TEMPLATE_DIR);
  const targetRoot = join(config.projectDir, CLAUDE_TARGET_DIR);
  return await installTemplateTree(config, sourceRoot, targetRoot);
}

export async function installShipperKit(config: SetupConfig): Promise<InstalledFile[]> {
  const profile = config.profile ?? "node-npm";
  const existingConfig = await readShipperConfig(config.projectDir);
  const selectedProvider = config.provider ?? existingConfig?.executor.provider ?? "codex-cli";
  const installed = [
    ...(await installProviderTemplates(selectedProvider, config)),
    ...(await installTemplateTree(config, join(config.rootDir, TARGET_TEMPLATE_DIR), config.projectDir)),
  ];

  const configPath = join(config.projectDir, CONFIG_PATH);
  const shipperConfig = existingConfig ?? defaultShipperConfig(profile);
  shipperConfig.executor.provider = selectedProvider;
  applyProviderOptions(shipperConfig, selectedProvider, config);
  if (selectedProvider === "claude-code") {
    shipperConfig.executor.claude.sandbox = config.claudeSandbox
      ?? existingConfig?.executor.claude.sandbox
      ?? "strict";
  }
  shipperConfig.archive.publishMode = config.archivePublishMode ?? shipperConfig.archive.publishMode;
  shipperConfig.delivery.refreshPolicy = config.refreshPolicy ?? shipperConfig.delivery.refreshPolicy;
  const configContent = `${JSON.stringify(shipperConfig, null, 2)}\n`;
  installed.push(await installGeneratedFile(config, "generated:shipper-config", configPath, configContent));
  if (selectedProvider === "claude-code") {
    installed.push(await installGeneratedFile(
      config,
      "generated:claude-settings",
      join(config.projectDir, CLAUDE_TARGET_DIR, "settings.json"),
      claudeSettingsContent(shipperConfig.executor.claude.sandbox),
    ));
  }
  installed.push(await installGeneratedFile(config, "generated:shipper-env-example", join(config.projectDir, ENV_EXAMPLE_PATH), defaultEnvExample(selectedProvider)));
  installed.push(await ensureQueueFile(config.projectDir));
  installed.push(await installGeneratedFile(config, "generated:shipper-queue-example", join(config.projectDir, ".openspec-shipper/queue.example.md"), defaultQueueExample()));
  installed.push(await ensureStateDirectory(config.projectDir, ".openspec-shipper/runs"));
  installed.push(await ensureStateDirectory(config.projectDir, ".openspec-shipper/tmp"));

  const gitignorePath = join(config.projectDir, ".gitignore");
  installed.push(await ensureShipperGitignore(config, gitignorePath));

  installed.push(await updatePackageJson(config));
  if (config.installDependencies) {
    const installer = config.dependencyInstaller ?? installProjectDependencies;
    await installer({ projectDir: config.projectDir, packageManager: shipperConfig.packageManager });
  }

  return installed;
}

export async function installProjectDependencies(input: DependencyInstallInput): Promise<string> {
  const args = dependencyInstallArgs(input.packageManager);
  const command = args[0];
  if (!command) {
    throw new Error(`Unsupported package manager: ${input.packageManager}`);
  }
  const commandArgs = args.slice(1);
  const result = spawnSync(command, commandArgs, {
    cwd: input.projectDir,
    env: process.env,
    encoding: "utf8",
    timeout: 10 * 60_000,
  });
  const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
  if (result.error) {
    throw new Error(`Dependency install failed: ${result.error.message}`);
  }
  if (result.status !== 0) {
    throw new Error(`Dependency install failed with ${args.join(" ")}: ${firstLine(output) ?? `exit code ${result.status}`}`);
  }

  return output || `${args.join(" ")} completed.`;
}

function dependencyInstallArgs(packageManager: PackageManager): string[] {
  switch (packageManager) {
    case "bun":
      return ["bun", "install"];
    case "pnpm":
      return ["pnpm", "install"];
    case "npm":
      return ["npm", "install"];
  }
}

function applyProviderOptions(
  shipperConfig: ReturnType<typeof defaultShipperConfig>,
  provider: ExecutorProviderId,
  config: SetupConfig,
): void {
  switch (provider) {
    case "opencode":
      shipperConfig.executor.opencode.bin = config.providerBin ?? shipperConfig.executor.opencode.bin;
      shipperConfig.executor.opencode.model = config.model ?? shipperConfig.executor.opencode.model;
      return;
    case "codex-cli":
      shipperConfig.executor.codex.bin = config.providerBin ?? shipperConfig.executor.codex.bin;
      shipperConfig.executor.codex.model = config.model ?? shipperConfig.executor.codex.model;
      shipperConfig.executor.codex.reasoningEffort = config.effort ?? shipperConfig.executor.codex.reasoningEffort;
      return;
    case "claude-code":
      shipperConfig.executor.claude.bin = config.providerBin ?? shipperConfig.executor.claude.bin;
      shipperConfig.executor.claude.model = config.model ?? shipperConfig.executor.claude.model;
      shipperConfig.executor.claude.effort = config.effort ?? shipperConfig.executor.claude.effort;
      shipperConfig.executor.claude.permissionMode = config.permissionMode ?? shipperConfig.executor.claude.permissionMode;
  }
}

async function installProviderTemplates(provider: ExecutorProviderId, config: SetupConfig): Promise<InstalledFile[]> {
  switch (provider) {
    case "opencode":
      return await installOpenCodeTemplates(config);
    case "codex-cli":
      return await installCodexTemplates(config);
    case "claude-code":
      return await installClaudeTemplates(config);
  }
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

async function ensureStateDirectory(projectDir: string, relativePath: string): Promise<InstalledFile> {
  const target = join(projectDir, relativePath);
  const currentStat = await stat(target).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  });
  if (currentStat?.isDirectory()) {
    return { source: `generated:${relativePath}`, target, status: "unchanged" };
  }
  if (currentStat) {
    return { source: `generated:${relativePath}`, target, status: "drifted" };
  }

  await mkdir(target, { recursive: true });
  return { source: `generated:${relativePath}`, target, status: "installed" };
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
    "lint:commits": "commitlint --from origin/$(git branch --show-current) --to HEAD",
  };
}

function defaultDevDependencies(): Record<string, string> {
  return {
    "@commitlint/cli": "^21.0.2",
    "@commitlint/config-conventional": "^21.0.2",
    "@fission-ai/openspec": "^1.2.0",
  };
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function defaultEnvExample(provider: ExecutorProviderId = "codex-cli"): string {
  return [
    `OPENSPEC_SHIPPER_PROVIDER=${provider}`,
    "OPENSPEC_SHIPPER_OPENCODE_BIN=opencode",
    "OPENSPEC_SHIPPER_OPENCODE_MODEL=opencode-go/deepseek-v4-pro",
    "OPENSPEC_SHIPPER_CODEX_BIN=codex",
    "OPENSPEC_SHIPPER_CODEX_MODEL=gpt-5.6-luna",
    "OPENSPEC_SHIPPER_CODEX_REASONING_EFFORT=xhigh",
    "OPENSPEC_SHIPPER_CLAUDE_BIN=claude",
    "OPENSPEC_SHIPPER_CLAUDE_MODEL=sonnet",
    "OPENSPEC_SHIPPER_CLAUDE_EFFORT=low",
    "OPENSPEC_SHIPPER_CLAUDE_PERMISSION_MODE=dontAsk",
    "OPENSPEC_SHIPPER_CLAUDE_MAX_TURNS=",
    "OPENSPEC_SHIPPER_CLAUDE_MAX_BUDGET_USD=",
    "OPENSPEC_SHIPPER_LOOP_DELAY_MS=5000",
    "OPENSPEC_SHIPPER_BUSY_DELAY_MS=60000",
    "OPENSPEC_SHIPPER_ALLOW_ACTIVE_EXECUTOR=2",
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
