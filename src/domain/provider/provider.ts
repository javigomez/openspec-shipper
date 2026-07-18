import type { DeliverPhase, QueueTask } from "../queue/queue.js";
export type ExecutorProviderId = "opencode" | "codex-cli" | "claude-code";

export type ProviderCommand = {
  command: string;
  args: string[];
  cwd: string;
  stdin?: string;
};

export type BuildCommandInput = {
  phase: DeliverPhase;
  task: QueueTask;
  projectDir: string;
  config: ProviderRuntimeConfig;
};

export type ProviderRuntimeConfig = {
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
      permissionMode?: string;
      maxTurns?: number;
      maxBudgetUsd?: number;
    };
  };
  opencodePrintLogs?: boolean;
  opencodeLogLevel?: string;
};

export type DoctorCheck = {
  name: string;
  ok: boolean;
  message: string;
  severity: "error" | "warning";
};

export type ExecutorProvider = {
  id: ExecutorProviderId;
  displayName: string;
  defaultBin: string;
  activeProcessNames: string[];
  buildCommand(input: BuildCommandInput): ProviderCommand;
  detectFailureSignal(output: string): string | undefined;
};
