import type { BuildCommandInput, ExecutorProvider } from "../../../domain/provider/provider.js";

export const codexCliProvider: ExecutorProvider = {
  id: "codex-cli",
  displayName: "Codex CLI (experimental)",
  defaultBin: "codex",
  activeProcessNames: ["codex"],
  buildCommand(input: BuildCommandInput) {
    const prompt = buildCodexPrompt(input);
    const args = [
      "exec",
      "-C",
      input.projectDir,
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
    ];

    if (input.config.executor.codex.model) {
      args.push("--model", input.config.executor.codex.model);
    }

    args.push(prompt);

    return {
      command: input.config.executor.codex.bin,
      args,
      cwd: input.projectDir,
    };
  },
  detectFailureSignal(output: string): string | undefined {
    if (/blocked|cannot continue without|permission requested|approval/i.test(output)) {
      return "Codex CLI reported a blocker";
    }

    return undefined;
  },
};

function buildCodexPrompt(input: BuildCommandInput): string {
  const change = input.task.change ? ` for OpenSpec change ${input.task.change}` : "";
  return [
    `Run the OpenSpec ${input.phase} phase${change}.`,
    "Follow AGENTS.md and the repository OpenSpec workflow.",
    "Use main for planning, sync, and archive. Use worktrees/<change-name> for implementation.",
    "Respect .openspec-shipper/config.json safety flags for push and archive.",
    "Stop and report a clear blocker if you cannot continue safely.",
  ].join("\n");
}
