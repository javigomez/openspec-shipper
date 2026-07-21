import { readFileSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export type PackageManager = "npm" | "pnpm" | "bun";
export type ShipperProfile = "generic" | "node-npm" | "node-pnpm" | "bun";
export type ExecutorProviderId = "opencode" | "codex-cli" | "claude-code";
export type ClaudeSandboxMode = "strict" | "permissive" | "off";
export type DeliveryRefreshPolicy = "auto" | "always" | "conflicts-only" | "never";
export type ArchivePublishMode = "direct" | "pull-request";

export type ShipperConfig = {
  version: 2;
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
      reasoningEffort?: string;
    };
    claude: {
      bin: string;
      model?: string;
      effort?: string;
      permissionMode?: "dontAsk" | "bypassPermissions";
      sandbox: ClaudeSandboxMode;
      maxTurns?: number;
      maxBudgetUsd?: number;
    };
  };
  github: {
    autoOpenPr: boolean;
    prChecks: boolean;
  };
  checks: {
    install: string;
    updateDependencies: string;
    branch: string;
    commits: string;
    typecheck: string;
    lint: string;
    format: string;
    unit: string;
    openspec: string;
    validateProposal: string;
  };
  worktree: {
    install: boolean;
    installTimeoutMs: number;
  };
  delivery: {
    refreshPolicy: DeliveryRefreshPolicy;
  };
  archive: {
    publishMode: ArchivePublishMode;
    maxAttempts: number;
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
  const updateDependencies = packageManager === "bun" ? "bun install" : packageManager === "pnpm" ? "pnpm install" : "npm install";

  return {
    version: 2,
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
        model: "gpt-5.6-luna",
        reasoningEffort: "xhigh",
      },
      claude: {
        bin: "claude",
        model: "sonnet",
        effort: "low",
        permissionMode: "dontAsk",
        sandbox: "strict",
      },
    },
    github: {
      autoOpenPr: false,
      prChecks: false,
    },
    checks: {
      install,
      updateDependencies,
      branch: `${run} lint:branch --`,
      commits: "npx commitlint",
      typecheck: "",
      lint: "",
      format: "",
      unit: "",
      openspec: `${run} openspec:cli --`,
      validateProposal: `${run} openspec:validate-proposal --`,
    },
    worktree: {
      install: true,
      installTimeoutMs: 10 * 60_000,
    },
    delivery: {
      refreshPolicy: "auto",
    },
    archive: {
      publishMode: "direct",
      maxAttempts: 3,
    },
    safety: {
      enablePush: true,
      enableArchive: true,
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

export function readShipperConfigSync(projectDir: string): ShipperConfig | undefined {
  try {
    return migrateConfig(JSON.parse(readFileSync(join(projectDir, CONFIG_PATH), "utf8")) as Partial<ShipperConfig>);
  } catch (error) {
    if (isNotFoundError(error)) {
      return undefined;
    }

    throw error;
  }
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

function migrateConfig(config: Partial<ShipperConfig>): ShipperConfig {
  const defaults = defaultShipperConfig(config.profile ?? "node-npm");
  return {
    ...defaults,
    ...config,
    version: 2,
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
      claude: {
        ...defaults.executor.claude,
        ...(config.executor?.claude ?? {}),
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
    worktree: {
      ...defaults.worktree,
      ...(config.worktree ?? {}),
    },
    delivery: {
      ...defaults.delivery,
      ...(config.delivery ?? {}),
    },
    archive: {
      ...defaults.archive,
      ...(config.archive ?? {}),
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
