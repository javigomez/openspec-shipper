import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeliverPhase } from "../../../domain/queue/queue.js";
import type { BuildCommandInput, BuildRecoveryCommandInput, ExecutorProvider, ProviderFailureSignal } from "../../../domain/provider/provider.js";
import { resolveProviderAsset } from "../../templates/provider-assets.js";

export const codexCliProvider: ExecutorProvider = {
  id: "codex-cli",
  displayName: "Codex CLI",
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

    if (input.config.executor.codex.reasoningEffort) {
      args.push("-c", `model_reasoning_effort="${input.config.executor.codex.reasoningEffort}"`);
    }

    args.push(prompt);

    return {
      command: input.config.executor.codex.bin,
      args,
      cwd: input.projectDir,
    };
  },
  buildRecoveryCommand(input: BuildRecoveryCommandInput) {
    return buildCodexRecoveryCommand(input.assetsDir, input.prompt, input.config);
  },
  classifyFailureSignal: classifyCodexFailureSignal,
  detectFailureSignal(output: string): string | undefined {
    return classifyCodexFailureSignal(output)?.reason;
  },
};

function classifyCodexFailureSignal(output: string): ProviderFailureSignal | undefined {
  const detectionOutput = codexAssistantOutput(output);
  const blockedSignals = detectionOutput.matchAll(/^OPENSPEC_SHIPPER_BLOCKED:\s*(.+)$/gim);
  for (const blocked of blockedSignals) {
    const reason = blocked[1]?.trim();
    if (reason !== "<short reason>") {
      return { kind: "worker_blocker", reason: `Worker reported a blocker: ${reason}` };
    }
  }
  if (/usage limit|rate limit|quota exceeded|insufficient credits/i.test(detectionOutput)) {
    return { kind: "provider_unavailable", reason: "Codex CLI usage limit was reached" };
  }
  if (/model (?:is )?not (?:available|found)|unknown model/i.test(detectionOutput)) {
    return { kind: "provider_unavailable", reason: "Codex model is unavailable" };
  }
  if (/not logged in|unauthorized|authentication required|invalid api key/i.test(detectionOutput)) {
    return { kind: "authentication", reason: "Codex CLI authentication failed" };
  }
  if (/\b(permission requested|approval required|permission denied|cannot continue without)\b/i.test(detectionOutput)) {
    return { kind: "permission", reason: "Codex CLI reported a blocker" };
  }
  return undefined;
}

function buildCodexRecoveryCommand(
  projectDir: string,
  prompt: string,
  config: BuildCommandInput["config"],
) {
  const args = ["exec", "-C", projectDir, "--sandbox", "danger-full-access", "-c", 'approval_policy="never"'];
  if (config.executor.codex.model) {
    args.push("--model", config.executor.codex.model);
  }
  if (config.executor.codex.reasoningEffort) {
    args.push("-c", `model_reasoning_effort="${config.executor.codex.reasoningEffort}"`);
  }
  args.push(prompt);
  return { command: config.executor.codex.bin, args, cwd: projectDir };
}

function codexAssistantOutput(output: string): string {
  if (!/^codex$/m.test(output)) {
    return output;
  }

  // Codex may include multiple assistant turns in one captured transcript.
  // Only the final turn is authoritative; an earlier retry blocker must not
  // poison a later successful implementation.
  return output.split(/^codex$/m).at(-1) ?? output;
}

function buildCodexPrompt(input: BuildCommandInput): string {
  const assetsDir = input.assetsDir ?? input.projectDir;
  const prompt = readFileSync(codexPromptPath(assetsDir, input.phase), "utf8");
  const workflow = readFileSync(codexWorkflowPath(assetsDir), "utf8");
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
  const fileName = codexPromptFileName(phase);
  return resolveProviderAsset(
    projectDir,
    join(".openspec-shipper", "codex", "prompts", fileName),
    join("codex-cli", "assets", "prompts", fileName),
  );
}

export function codexWorkflowPath(projectDir: string): string {
  return resolveProviderAsset(
    projectDir,
    join(".openspec-shipper", "codex", "workflow.md"),
    join("codex-cli", "assets", "workflow.md"),
  );
}

function codexPromptFileName(phase: DeliverPhase): string {
  switch (phase) {
    case "implement":
      return "implement.md";
    case "archive":
      return "archive.md";
    case "prepare_worktree":
    case "refresh_branch":
    case "push":
    case "publish_archive":
    case "cleanup_worktree":
    case "waiting_for_merge":
    case "waiting_for_archive_merge":
      throw new Error(`${phase} is native OpenSpec Shipper runner logic and has no Codex prompt`);
  }
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{([A-Z_]+)}}/g, (_match, key: string) => values[key] ?? "");
}
