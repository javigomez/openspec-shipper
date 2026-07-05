import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "bun";
export type ShipperProfile = "generic" | "node-npm" | "node-pnpm" | "bun";
export type ExecutorProviderId = "opencode" | "codex-cli";

export type ShipperConfig = {
  version: 1;
  profile: ShipperProfile;
  baseBranch: string;
  packageManager: PackageManager;
  executor: {
    provider: ExecutorProviderId;
    opencode: {
      bin: string;
      model?: string;
    };
    codex: {
      bin: string;
      model?: string;
    };
  };
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

export const SHIPPER_DIR = ".openspec-shipper";
export const CONFIG_PATH = `${SHIPPER_DIR}/config.json`;
export const ENV_PATH = `${SHIPPER_DIR}/.env`;
export const ENV_EXAMPLE_PATH = `${SHIPPER_DIR}/.env.example`;
export const DEFAULT_QUEUE_PATH = `${SHIPPER_DIR}/queue.md`;
export const DEFAULT_STATE_DIR = SHIPPER_DIR;

export function defaultShipperConfig(profile: ShipperProfile = "node-npm"): ShipperConfig {
  const packageManager = packageManagerForProfile(profile);
  const run = packageManager === "bun" ? "bun run" : packageManager === "pnpm" ? "pnpm" : "npm run";
  const install = packageManager === "bun" ? "bun install" : packageManager === "pnpm" ? "pnpm install --frozen-lockfile" : "npm ci";

  return {
    version: 1,
    profile,
    baseBranch: "main",
    packageManager,
    executor: {
      provider: "opencode",
      opencode: {
        bin: "opencode",
        model: "opencode-go/deepseek-v4-pro",
      },
      codex: {
        bin: "codex",
        model: "gpt-5.1-codex",
      },
    },
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

export async function readShipperConfig(projectDir: string): Promise<ShipperConfig | undefined> {
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

  return migrateConfig(JSON.parse(raw) as Partial<ShipperConfig>);
}

export async function writeShipperConfig(projectDir: string, config: ShipperConfig): Promise<void> {
  await writeFile(join(projectDir, CONFIG_PATH), `${JSON.stringify(config, null, 2)}\n`);
}

export function packageManagerForProfile(profile: ShipperProfile): PackageManager {
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

export function isShipperProfile(value: string): value is ShipperProfile {
  return value === "generic" || value === "node-npm" || value === "node-pnpm" || value === "bun";
}

export const defaultOrchesterConfig = defaultShipperConfig;
export const readOrchesterConfig = readShipperConfig;
export const writeOrchesterConfig = writeShipperConfig;
export const isOrchesterProfile = isShipperProfile;
export type OrchesterConfig = ShipperConfig;
export type OrchesterProfile = ShipperProfile;

function migrateConfig(config: Partial<ShipperConfig>): ShipperConfig {
  const defaults = defaultShipperConfig(config.profile ?? "node-npm");
  return {
    ...defaults,
    ...config,
    executor: {
      ...defaults.executor,
      ...(config.executor ?? {}),
      opencode: {
        ...defaults.executor.opencode,
        ...(config.executor?.opencode ?? {}),
      },
      codex: {
        ...defaults.executor.codex,
        ...(config.executor?.codex ?? {}),
      },
    },
    github: {
      ...defaults.github,
      ...(config.github ?? {}),
    },
    checks: {
      ...defaults.checks,
      ...(config.checks ?? {}),
    },
    safety: {
      ...defaults.safety,
      ...(config.safety ?? {}),
    },
  };
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
