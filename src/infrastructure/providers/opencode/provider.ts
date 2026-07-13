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
    case "apply":
      return "openspec-apply-worktree";
    case "ship":
      return "openspec-ship-worktree";
    case "sync":
      return "openspec-main-sync";
    case "archive":
      return "openspec-archive-merged";
    case "cleanup":
      return "openspec-cleanup-worktree";
    case "waiting_for_pr":
      return "openspec-main-sync";
    case "waiting_for_merge":
      return "openspec-main-sync";
  }
}

export function detectFailureSignal(output: string): string | undefined {
  const blocked = output.match(/^OPENSPEC_SHIPPER_BLOCKED:\s*(.+)$/im);
  if (blocked?.[1]) {
    return `Worker reported a blocker: ${blocked[1].trim()}`;
  }

  const patterns: Array<[RegExp, string]> = [
    [/UnknownError/i, "OpenCode returned UnknownError"],
    [/Unexpected server error/i, "OpenCode returned an unexpected server error"],
    [/AI_APICallError/i, "OpenCode stream failed with AI_APICallError"],
    [/not a recognized command or skill/i, "OpenCode did not recognize the command"],
    [/command not found:\s*openspec/i, "OpenSpec CLI was not available"],
    [/auto-rejecting/i, "OpenCode auto-rejected a permission request"],
    [/permission requested/i, "OpenCode requested permission in non-interactive mode"],
    [/\bNo pull request exists\b/i, "Ship worker did not find an open pull request"],
    [/^#+\s*Blocked:/im, "Worker reported a blocker"],
    [/\bnot push-ready\b/i, "Worker reported a blocker"],
    [/\bnot eligible for push\b/i, "Worker reported a blocker"],
    [/\bArchive blocked\b/i, "OpenSpec archive worker reported a blocker"],
    [/\bnot archive-ready\b/i, "OpenSpec archive worker reported a blocker"],
    [/\bCleanup blocked\b/i, "OpenSpec cleanup worker reported a blocker"],
    [/\bnot cleanup-ready\b/i, "OpenSpec cleanup worker reported a blocker"],
    [/\b(worker reported a blocker|task is blocked|cannot continue without)\b/i, "Worker reported a blocker"],
  ];

  return patterns.find(([pattern]) => pattern.test(output))?.[1];
}
