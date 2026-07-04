import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "bun";
export type OrchesterProfile = "generic" | "node-npm" | "node-pnpm" | "bun";

export type OrchesterConfig = {
  version: 1;
  profile: OrchesterProfile;
  baseBranch: string;
  packageManager: PackageManager;
  github: {
    autoOpenPr: boolean;
    prChecks: boolean;
  };
  checks: {
    install: string;
    branch: string;
    commits: string;
    typecheck: string;
    lint: string;
    format: string;
    unit: string;
    openspec: string;
    validateProposal: string;
  };
  safety: {
    enablePush: boolean;
    enableArchive: boolean;
  };
};

export const CONFIG_PATH = ".orchester/config.json";

export function defaultOrchesterConfig(profile: OrchesterProfile = "node-npm"): OrchesterConfig {
  const packageManager = packageManagerForProfile(profile);
  const run = packageManager === "bun" ? "bun run" : packageManager === "pnpm" ? "pnpm" : "npm run";
  const install = packageManager === "bun" ? "bun install" : packageManager === "pnpm" ? "pnpm install --frozen-lockfile" : "npm ci";

  return {
    version: 1,
    profile,
    baseBranch: "main",
    packageManager,
    github: {
      autoOpenPr: true,
      prChecks: true,
    },
    checks: {
      install,
      branch: `${run} lint:branch --`,
      commits: "npx commitlint",
      typecheck: `${run} test:types`,
      lint: `${run} lint`,
      format: `${run} format:check`,
      unit: `${run} test:unit`,
      openspec: `${run} openspec:cli --`,
      validateProposal: `${run} openspec:validate-proposal --`,
    },
    safety: {
      enablePush: false,
      enableArchive: false,
    },
  };
}

export async function readOrchesterConfig(projectDir: string): Promise<OrchesterConfig | undefined> {
  const path = join(projectDir, CONFIG_PATH);
  const raw = await readFile(path, "utf8").catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  });

  if (!raw) {
    return undefined;
  }

  return JSON.parse(raw) as OrchesterConfig;
}

export async function writeOrchesterConfig(projectDir: string, config: OrchesterConfig): Promise<void> {
  await writeFile(join(projectDir, CONFIG_PATH), `${JSON.stringify(config, null, 2)}\n`);
}

export function packageManagerForProfile(profile: OrchesterProfile): PackageManager {
  switch (profile) {
    case "node-pnpm":
      return "pnpm";
    case "bun":
      return "bun";
    case "generic":
    case "node-npm":
      return "npm";
  }
}

export function isOrchesterProfile(value: string): value is OrchesterProfile {
  return value === "generic" || value === "node-npm" || value === "node-pnpm" || value === "bun";
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
