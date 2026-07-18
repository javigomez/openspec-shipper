import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeliverPhase } from "../../../domain/queue/queue.js";
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
      "-c",
      'approval_policy="never"',
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
    const detectionOutput = codexAssistantOutput(output);
    const blockedSignals = detectionOutput.matchAll(/^OPENSPEC_SHIPPER_BLOCKED:\s*(.+)$/gim);
    for (const blocked of blockedSignals) {
      const reason = blocked[1]?.trim();
      if (reason !== "<short reason>") {
        return `Worker reported a blocker: ${reason}`;
      }
    }

    if (/\b(permission requested|approval required|cannot continue without)\b/i.test(detectionOutput)) {
      return "Codex CLI reported a blocker";
    }

    return undefined;
  },
};

function codexAssistantOutput(output: string): string {
  if (!/^codex$/m.test(output)) {
    return output;
  }

  return output.split(/^codex$/m).slice(1).join("\n");
}

function buildCodexPrompt(input: BuildCommandInput): string {
  const prompt = readFileSync(codexPromptPath(input.projectDir, input.phase), "utf8");
  const workflow = readFileSync(codexWorkflowPath(input.projectDir), "utf8");
  const changeName = input.task.change ?? "";
  const branchName = changeName ? `feat/${changeName}` : "";
  const worktreePath = changeName ? `worktrees/${changeName}` : "";
  return renderTemplate(
    [
      prompt,
      "",
      "## Installed Workflow Reference",
      "",
      workflow,
      "",
      "## Invocation Context",
      "",
      `- phase: ${input.phase}`,
      `- change: ${changeName || "(none)"}`,
      `- branch: ${branchName || "(none)"}`,
      `- worktree: ${worktreePath || "(none)"}`,
      `- projectDir: ${input.projectDir}`,
    ].join("\n"),
    {
      PHASE: input.phase,
      CHANGE_NAME: changeName,
      BRANCH_NAME: branchName,
      WORKTREE_PATH: worktreePath,
      PROJECT_DIR: input.projectDir,
    },
  );
}

export function codexPromptPath(projectDir: string, phase: DeliverPhase): string {
  return join(projectDir, ".openspec-shipper", "codex", "prompts", codexPromptFileName(phase));
}

export function codexWorkflowPath(projectDir: string): string {
  return join(projectDir, ".openspec-shipper", "codex", "workflow.md");
}

function codexPromptFileName(phase: DeliverPhase): string {
  switch (phase) {
    case "implement":
      return "implement.md";
    case "archive":
      return "archive.md";
    case "prepare_worktree":
    case "push":
    case "sync_main":
    case "cleanup_worktree":
    case "waiting_for_merge":
      throw new Error(`${phase} is native OpenSpec Shipper runner logic and has no Codex prompt`);
  }
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{([A-Z_]+)}}/g, (_match, key: string) => values[key] ?? "");
}
