import type { DeliverPhase, QueueTask } from "../queue/queue";
import type { ShipperConfig } from "../config/shipper-config";

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
  config: Pick<
    ShipperConfig,
    "executor" | "opencodePrintLogs" | "opencodeLogLevel"
  >;
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
