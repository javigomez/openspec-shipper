import { commandAcceptsChangeArgument, type DeliverPhase } from "../../../domain/queue/queue.js";
import type { BuildCommandInput, ExecutorProvider } from "../../../domain/provider/provider.js";

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
    };
  },
  detectFailureSignal,
};

export function openCodeCommandName(phase: DeliverPhase): string {
  switch (phase) {
    case "implement":
      return "openspec-apply-worktree";
    case "archive":
      return "openspec-archive-merged";
    case "prepare_worktree":
    case "push":
    case "sync_main":
    case "cleanup_worktree":
    case "waiting_for_merge":
      throw new Error(`${phase} is native OpenSpec Shipper runner logic and has no OpenCode command`);
  }
}

export function detectFailureSignal(output: string): string | undefined {
  const finalOutput = finalOutputSection(output);
  const blockedReason = finalBlockedReason(output);
  if (blockedReason) {
    return `Worker reported a blocker: ${blockedReason}`;
  }

  const patterns: Array<[RegExp, string]> = [
    [/UnknownError/i, "OpenCode returned UnknownError"],
    [/Unexpected server error/i, "OpenCode returned an unexpected server error"],
    [/AI_APICallError/i, "OpenCode stream failed with AI_APICallError"],
    [/not a recognized command or skill/i, "OpenCode did not recognize the command"],
    [/command not found:\s*openspec/i, "OpenSpec CLI was not available"],
    [/^OpenCode auto-rejected\b/im, "OpenCode auto-rejected a permission request"],
    [/^#+\s*Blocked:/im, "Worker reported a blocker"],
    [/\bnot push-ready\b/i, "Worker reported a blocker"],
    [/\bnot eligible for push\b/i, "Worker reported a blocker"],
    [/\bArchive blocked\b/i, "OpenSpec archive worker reported a blocker"],
    [/\bnot archive-ready\b/i, "OpenSpec archive worker reported a blocker"],
    [/\b(worker reported a blocker|task is blocked|cannot continue without)\b/i, "Worker reported a blocker"],
  ];

  return patterns.find(([pattern]) => pattern.test(finalOutput))?.[1];
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
