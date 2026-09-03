import { commandAcceptsChangeArgument, type DeliverPhase } from "../../../domain/queue/queue.js";
import type { BuildCommandInput, BuildRecoveryCommandInput, ExecutorProvider, ProviderFailureSignal } from "../../../domain/provider/provider.js";
import { dirname, join } from "node:path";
import { resolveProviderAsset, resolveProviderDirectory } from "../../templates/provider-assets.js";

export const opencodeProvider: ExecutorProvider = {
  id: "opencode",
  displayName: "OpenCode",
  defaultBin: "opencode",
  activeProcessNames: ["opencode"],
  buildCommand(input: BuildCommandInput) {
    const commandName = openCodeCommandName(input.phase);
    const args = ["run"];

    if (input.config.opencodePrintLogs) {
      args.push("--print-logs");
    }

    if (input.config.opencodeLogLevel) {
      args.push("--log-level", input.config.opencodeLogLevel);
    }

    if (input.config.executor.opencode.model) {
      args.push("--model", input.config.executor.opencode.model);
    }

    args.push("--command", commandName);
    if (input.task.change && commandAcceptsChangeArgument(input.task)) {
      args.push(input.task.change);
    }

    return {
      command: input.config.executor.opencode.bin,
      args,
      cwd: input.projectDir,
      env: { OPENCODE_CONFIG_DIR: openCodeConfigDir(input.assetsDir ?? input.projectDir, input.phase) },
    };
  },
  buildRecoveryCommand(input: BuildRecoveryCommandInput) {
    const args = ["run", "--auto"];
    if (input.config.opencodePrintLogs) {
      args.push("--print-logs");
    }
    if (input.config.opencodeLogLevel) {
      args.push("--log-level", input.config.opencodeLogLevel);
    }
    if (input.config.executor.opencode.model) {
      args.push("--model", input.config.executor.opencode.model);
    }
    args.push(input.prompt);
    return {
      command: input.config.executor.opencode.bin,
      args,
      cwd: input.cwd,
      env: { OPENCODE_CONFIG_DIR: openCodeConfigDir(input.assetsDir) },
    };
  },
  classifyFailureSignal,
  detectFailureSignal,
};

export function openCodeConfigDir(projectDir: string, phase?: DeliverPhase): string {
  if (phase) {
    return dirname(dirname(openCodeCommandPath(projectDir, phase)));
  }
  return resolveProviderDirectory(projectDir, ".opencode", join("opencode", "assets"));
}

export function openCodeCommandPath(projectDir: string, phase: DeliverPhase): string {
  const fileName = `${openCodeCommandName(phase)}.md`;
  return resolveProviderAsset(
    projectDir,
    join(".opencode", "commands", fileName),
    join("opencode", "assets", "commands", fileName),
  );
}

export function openCodeCommandName(phase: DeliverPhase): string {
  switch (phase) {
    case "implement":
      return "openspec-apply-worktree";
    case "archive":
      return "openspec-archive-merged";
    case "prepare_worktree":
    case "refresh_branch":
    case "push":
    case "publish_archive":
    case "cleanup_worktree":
    case "waiting_for_merge":
    case "waiting_for_archive_merge":
      throw new Error(`${phase} is native OpenSpec Shipper runner logic and has no OpenCode command`);
  }
}

export function detectFailureSignal(output: string): string | undefined {
  return classifyFailureSignal(output)?.reason;
}

export function classifyFailureSignal(output: string): ProviderFailureSignal | undefined {
  const finalOutput = finalOutputSection(output);
  const explicitErrorOutput = explicitProviderErrorSection(finalOutput);
  const blockedReason = finalBlockedReason(output);
  if (blockedReason) {
    return { kind: "worker_blocker", reason: `Worker reported a blocker: ${blockedReason}` };
  }

  if (
    /only available hosted in China/i.test(finalOutput) ||
    /model (?:is )?not (?:available|found)|unknown model/i.test(explicitErrorOutput)
  ) {
    return { kind: "provider_unavailable", reason: "OpenCode model is unavailable" };
  }
  if (/usage limit|rate limit|quota exceeded|insufficient credits/i.test(explicitErrorOutput)) {
    return { kind: "provider_unavailable", reason: "OpenCode provider usage limit was reached" };
  }
  if (/not logged in|unauthorized|authentication required|invalid api key/i.test(explicitErrorOutput)) {
    return { kind: "authentication", reason: "OpenCode provider authentication failed" };
  }
  if (
    /auto-rejecting|permission requested/i.test(finalOutput) ||
    /permission denied/i.test(explicitErrorOutput)
  ) {
    return { kind: "permission", reason: "OpenCode reported a permission blocker" };
  }

  const patterns: Array<[RegExp, ProviderFailureSignal]> = [
    [/UnknownError/i, { kind: "provider_unavailable", reason: "OpenCode returned UnknownError" }],
    [/Unexpected server error/i, { kind: "provider_unavailable", reason: "OpenCode returned an unexpected server error" }],
    [/AI_APICallError/i, { kind: "provider_unavailable", reason: "OpenCode stream failed with AI_APICallError" }],
    [/not a recognized command or skill/i, { kind: "configuration", reason: "OpenCode did not recognize the command" }],
    [/command not found:\s*openspec/i, { kind: "configuration", reason: "OpenSpec CLI was not available" }],
    [/^#+\s*Blocked:/im, { kind: "worker_blocker", reason: "Worker reported a blocker" }],
    [/\bnot push-ready\b/i, { kind: "worker_blocker", reason: "Worker reported a blocker" }],
    [/\bnot eligible for push\b/i, { kind: "worker_blocker", reason: "Worker reported a blocker" }],
    [/\bArchive blocked\b/i, { kind: "worker_blocker", reason: "OpenSpec archive worker reported a blocker" }],
    [/\bnot archive-ready\b/i, { kind: "worker_blocker", reason: "OpenSpec archive worker reported a blocker" }],
    [/\b(worker reported a blocker|task is blocked|cannot continue without)\b/i, { kind: "worker_blocker", reason: "Worker reported a blocker" }],
  ];

  return patterns.find(([pattern]) => pattern.test(finalOutput))?.[1];
}

function explicitProviderErrorSection(output: string): string {
  return output
    .split(/\r?\n/)
    .map((line) => line.replace(/\u001B\[[0-9;]*m/g, "").trim())
    .filter((line) =>
      /^(?:error|fatal)(?:\b|:)/i.test(line) ||
      /^(?:http\s+)?(?:401|429)\b/i.test(line) ||
      /^(?:unauthorized|authentication required|invalid api key)(?:\b|:)/i.test(line) ||
      /^(?:AI_APICallError|UnknownError)(?:\b|:)/i.test(line) ||
      /^"(?:error|level|type)"\s*:\s*(?:"(?:error|fatal|failed)"|\{)/i.test(line),
    )
    .join("\n");
}

function finalOutputSection(output: string, lineCount = 80): string {
  return output
    .split(/\r?\n/)
    .slice(-lineCount)
    .join("\n");
}

function finalBlockedReason(output: string): string | undefined {
  const finalLine = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(-1)[0];
  const match = finalLine?.match(/^OPENSPEC_SHIPPER_BLOCKED:\s*(.+)$/i);
  return match?.[1]?.trim();
}
