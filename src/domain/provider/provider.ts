import type { DeliverPhase, QueueTask } from "../queue/queue.js";
export type ExecutorProviderId = "opencode" | "codex-cli";

export type ProviderCommand = {
  command: string;
  args: string[];
  cwd: string;
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
