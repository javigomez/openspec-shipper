import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { DeliverPhase } from "../../../domain/queue/queue.js";
import type { BuildCommandInput, ExecutorProvider } from "../../../domain/provider/provider.js";
import type { ClaudeSandboxMode } from "../../../domain/config/shipper-config.js";

const RESULT_SCHEMA = JSON.stringify({
  type: "object",
  properties: {
    status: { type: "string", enum: ["completed", "blocked"] },
    summary: { type: "string" },
    reason: { type: ["string", "null"] },
  },
  required: ["status", "summary", "reason"],
  additionalProperties: false,
});

export const claudeCodeProvider: ExecutorProvider = {
  id: "claude-code",
  displayName: "Claude Code (experimental)",
  defaultBin: "claude",
  activeProcessNames: ["claude"],
  buildCommand(input: BuildCommandInput) {
    const claude = input.config.executor.claude;
    const args = [
      "-p",
      "--permission-mode",
      claude.permissionMode ?? "dontAsk",
      "--settings",
      claudeSettingsPath(input.projectDir),
      "--append-system-prompt-file",
      claudeWorkflowPath(input.projectDir),
      "--tools",
      "Bash,Read,Edit,Write,Glob,Grep",
      "--allowedTools",
      "Bash,Read,Edit,Write,Glob,Grep",
      "--strict-mcp-config",
      "--disable-slash-commands",
      "--output-format",
      "json",
      "--json-schema",
      RESULT_SCHEMA,
      "--no-session-persistence",
    ];

    if (claude.model) {
      args.push("--model", claude.model);
    }
    if (claude.effort) {
      args.push("--effort", claude.effort);
    }
    if (claude.maxTurns) {
      args.push("--max-turns", String(claude.maxTurns));
    }
    if (claude.maxBudgetUsd) {
      args.push("--max-budget-usd", String(claude.maxBudgetUsd));
    }
    args.push("Execute the OpenSpec Shipper phase described in stdin.");

    return {
      command: claude.bin,
      args,
      cwd: input.projectDir,
      stdin: buildClaudePrompt(input),
    };
  },
  detectFailureSignal(output: string): string | undefined {
    const result = parseClaudeResult(output);
    if (result?.structured_output?.status === "blocked") {
      const reason = result.structured_output.reason?.trim() || "Claude Code reported a blocker";
      return `Worker reported a blocker: ${reason}`;
    }
    if (result?.is_error) {
      return `Claude Code reported an error: ${result.result?.trim() || result.subtype || "unknown error"}`;
    }

    const assistantOutput = result?.result ?? output;
    const blocked = assistantOutput.match(/^OPENSPEC_SHIPPER_BLOCKED:\s*(.+)$/im);
    if (blocked?.[1] && blocked[1].trim() !== "<short reason>") {
      return `Worker reported a blocker: ${blocked[1].trim()}`;
    }
    if (/\b(permission denied|permission required|not logged in|max(?:imum)? turns|max budget)\b/i.test(assistantOutput)) {
      return "Claude Code reported a blocker";
    }
    if (!result?.structured_output || result.structured_output.status !== "completed") {
      return "Claude Code did not return the required structured completion result";
    }
    return undefined;
  },
};

type ClaudeResult = {
  type?: string;
  subtype?: string;
  is_error?: boolean;
  result?: string;
  structured_output?: {
    status?: "completed" | "blocked";
    summary?: string;
    reason?: string | null;
  };
};

export function parseClaudeResult(output: string): ClaudeResult | undefined {
  try {
    const parsed = JSON.parse(output.trim()) as ClaudeResult;
    if (isClaudeResult(parsed)) {
      return parsed;
    }
  } catch {
    // Continue with line and suffix parsing for interleaved heartbeats/stderr.
  }

  const lines = output.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    try {
      const parsed = JSON.parse(lines[index]!) as ClaudeResult;
      if (isClaudeResult(parsed)) {
        return parsed;
      }
    } catch {
      // Heartbeats and stderr can be interleaved with the final JSON result.
    }
  }

  for (let index = output.lastIndexOf("\n{"); index >= 0; index = output.lastIndexOf("\n{", index - 1)) {
    try {
      const parsed = JSON.parse(output.slice(index + 1).trim()) as ClaudeResult;
      if (isClaudeResult(parsed)) {
        return parsed;
      }
    } catch {
      // Try the preceding JSON object boundary.
    }
  }
  return undefined;
}

function isClaudeResult(value: ClaudeResult): boolean {
  return value.type === "result" || Boolean(value.structured_output) || typeof value.result === "string";
}

function buildClaudePrompt(input: BuildCommandInput): string {
  const prompt = readFileSync(claudePromptPath(input.projectDir, input.phase), "utf8");
  const changeName = input.task.change ?? "";
  return renderTemplate(
    [
      prompt,
      "",
      "## Invocation Context",
      "",
      `- phase: ${input.phase}`,
      `- change: ${changeName || "(none)"}`,
      `- branch: ${changeName ? `feat/${changeName}` : "(none)"}`,
      `- worktree: ${changeName ? `worktrees/${changeName}` : "(none)"}`,
      `- projectDir: ${input.projectDir}`,
      "",
      "Return the required structured result after finishing the work.",
    ].join("\n"),
    {
      PHASE: input.phase,
      CHANGE_NAME: changeName,
      BRANCH_NAME: changeName ? `feat/${changeName}` : "",
      WORKTREE_PATH: changeName ? `worktrees/${changeName}` : "",
      PROJECT_DIR: input.projectDir,
    },
  );
}

export function claudePromptPath(projectDir: string, phase: DeliverPhase): string {
  return join(projectDir, ".openspec-shipper", "claude", "prompts", claudePromptFileName(phase));
}

export function claudeWorkflowPath(projectDir: string): string {
  return join(projectDir, ".openspec-shipper", "claude", "workflow.md");
}

export function claudeSettingsPath(projectDir: string): string {
  return join(projectDir, ".openspec-shipper", "claude", "settings.json");
}

export function claudeSettingsContent(mode: ClaudeSandboxMode): string {
  const sandbox = mode === "off"
    ? { enabled: false }
    : {
        enabled: true,
        autoAllowBashIfSandboxed: true,
        failIfUnavailable: mode === "strict",
        allowUnsandboxedCommands: mode === "permissive",
      };

  return `${JSON.stringify({ includeGitInstructions: false, sandbox }, null, 2)}\n`;
}

function claudePromptFileName(phase: DeliverPhase): string {
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
      throw new Error(`${phase} is native OpenSpec Shipper runner logic and has no Claude prompt`);
  }
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{([A-Z_]+)}}/g, (_match, key: string) => values[key] ?? "");
}
