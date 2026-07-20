import { spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { DeliverPhase } from "../../../domain/queue/queue.js";
import type { BuildCommandInput, ExecutorProvider } from "../../../domain/provider/provider.js";
import type { ClaudeSandboxMode } from "../../../domain/config/shipper-config.js";
import { resolveProviderAsset } from "../../templates/provider-assets.js";

export const CLAUDE_MIN_VERSION = "2.1.69";
export const CLAUDE_MAX_TESTED_VERSION = "2.1.215";

export const CLAUDE_RESULT_SCHEMA = JSON.stringify({
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
  displayName: "Claude Code",
  defaultBin: "claude",
  activeProcessNames: ["claude"],
  buildCommand(input: BuildCommandInput) {
    const claude = input.config.executor.claude;
    const assetsDir = input.assetsDir ?? input.projectDir;

    return {
      command: claude.bin,
      args: buildClaudeCliArgs(assetsDir, claude),
      cwd: input.projectDir,
      stdin: buildClaudePrompt(input),
    };
  },
  detectFailureSignal(output: string): string | undefined {
    const result = parseClaudeResult(output);
    if (result?.structured_output?.status === "completed") {
      return undefined;
    }
    if (result?.structured_output?.status === "blocked") {
      const reason = result.structured_output.reason?.trim() || "Claude Code reported a blocker";
      return `Worker reported a blocker: ${reason}`;
    }
    if (result?.is_error) {
      return `Claude Code reported an error: ${result.result?.trim() || result.subtype || "unknown error"}`;
    }

    const assistantOutput = result?.result ?? output;
    const blockedReason = finalBlockedReason(assistantOutput);
    if (blockedReason && blockedReason !== "<short reason>") {
      return `Worker reported a blocker: ${blockedReason}`;
    }
    if (/\b(permission denied|permission required|not logged in|max(?:imum)? turns|max budget)\b/i.test(finalOutputSection(assistantOutput))) {
      return "Claude Code reported a blocker";
    }
    if (!result?.structured_output || result.structured_output.status !== "completed") {
      return "Claude Code did not return the required structured completion result";
    }
    return undefined;
  },
};

export type ClaudeCliOptions = {
  bin: string;
  model?: string;
  effort?: string;
  permissionMode?: string;
  maxTurns?: number;
  maxBudgetUsd?: number;
};

export function buildClaudeCliArgs(projectDir: string, claude: ClaudeCliOptions): string[] {
  const args = [
    "-p",
    "--permission-mode",
    claude.permissionMode ?? "dontAsk",
    "--settings",
    claudeSettingsPath(projectDir),
    "--append-system-prompt-file",
    claudeWorkflowPath(projectDir),
    "--tools",
    "Bash,Read,Edit,Write,Glob,Grep",
    "--allowedTools",
    "Bash,Read,Edit,Write,Glob,Grep",
    "--strict-mcp-config",
    "--disable-slash-commands",
    "--output-format",
    "json",
    "--json-schema",
    CLAUDE_RESULT_SCHEMA,
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
  return args;
}

export type ClaudeContractResult = {
  ok: boolean;
  cached: boolean;
  message: string;
  version?: string;
  fingerprint?: string;
};

type ClaudeContractCache = {
  version: 1;
  fingerprint: string;
  claudeVersion: string;
  checkedAt: string;
};

export async function verifyClaudeCliContract(input: {
  projectDir: string;
  claude: ClaudeCliOptions;
  force?: boolean;
}): Promise<ClaudeContractResult> {
  const versionResult = spawnSync(input.claude.bin, ["--version"], {
    cwd: input.projectDir,
    encoding: "utf8",
    timeout: 10_000,
  });
  const version = extractClaudeVersion(versionResult.stdout || versionResult.stderr);
  if (versionResult.error || versionResult.status !== 0 || !version) {
    return {
      ok: false,
      cached: false,
      message: firstNonEmptyLine(versionResult.stderr || versionResult.stdout)
        ?? versionResult.error?.message
        ?? "could not read Claude Code version",
    };
  }

  const args = buildClaudeCliArgs(input.projectDir, input.claude);
  const fingerprint = await claudeContractFingerprint(input.projectDir, input.claude.bin, version, args);
  const cachePath = claudeContractCachePath(input.projectDir);
  if (!input.force) {
    const cache = await readClaudeContractCache(cachePath);
    if (cache?.fingerprint === fingerprint && cache.claudeVersion === version) {
      return { ok: true, cached: true, message: `CLI contract already verified for Claude Code ${version}`, version, fingerprint };
    }
  }

  const tmpDir = join(input.projectDir, ".openspec-shipper", "tmp");
  await mkdir(tmpDir, { recursive: true });
  const marker = join(tmpDir, `claude-contract-${randomUUID()}.txt`);
  const stdin = [
    "This is an OpenSpec Shipper CLI contract check, not a project task.",
    "Use the Bash tool exactly once.",
    `Run this exact command: printf contract-ok > ${JSON.stringify(marker)}`,
    "After it succeeds, return status completed, summary contract-ok, and reason null.",
  ].join("\n");
  const result = spawnSync(input.claude.bin, args, {
    cwd: input.projectDir,
    encoding: "utf8",
    input: stdin,
    timeout: 120_000,
  });
  const markerContent = await readFile(marker, "utf8").catch(() => undefined);
  await unlink(marker).catch(() => undefined);
  const parsed = parseClaudeResult(result.stdout);
  const completed = parsed?.structured_output?.status === "completed";
  if (result.error || result.status !== 0 || markerContent !== "contract-ok" || !completed) {
    const detail = firstNonEmptyLine(result.stderr)
      ?? parsed?.result
      ?? firstNonEmptyLine(result.stdout)
      ?? result.error?.message
      ?? `Claude exited with code ${result.status}`;
    return { ok: false, cached: false, message: detail, version, fingerprint };
  }

  const cache: ClaudeContractCache = {
    version: 1,
    fingerprint,
    claudeVersion: version,
    checkedAt: new Date().toISOString(),
  };
  await writeFile(cachePath, `${JSON.stringify(cache, null, 2)}\n`);
  return { ok: true, cached: false, message: `CLI contract verified for Claude Code ${version}`, version, fingerprint };
}

export function extractClaudeVersion(output: string): string | undefined {
  return output.match(/(\d+)\.(\d+)\.(\d+)/)?.[0];
}

export function compareClaudeVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

async function claudeContractFingerprint(
  projectDir: string,
  command: string,
  version: string,
  args: string[],
): Promise<string> {
  const [settings, workflow] = await Promise.all([
    readFile(claudeSettingsPath(projectDir), "utf8"),
    readFile(claudeWorkflowPath(projectDir), "utf8"),
  ]);
  const executable = resolveExecutable(command, projectDir);
  return createHash("sha256").update(JSON.stringify({
    executable,
    version,
    args,
    platform: process.platform,
    arch: process.arch,
    settings,
    workflow,
  })).digest("hex");
}

function resolveExecutable(command: string, cwd: string): string {
  const resolver = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(resolver, [command], { cwd, encoding: "utf8", timeout: 10_000 });
  return firstNonEmptyLine(result.stdout) ?? command;
}

function claudeContractCachePath(projectDir: string): string {
  return join(projectDir, ".openspec-shipper", "tmp", "claude-contract.json");
}

async function readClaudeContractCache(path: string): Promise<ClaudeContractCache | undefined> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as ClaudeContractCache;
    return parsed.version === 1 ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function firstNonEmptyLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
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
  const fileName = claudePromptFileName(phase);
  return resolveProviderAsset(
    projectDir,
    join(".openspec-shipper", "claude", "prompts", fileName),
    join("claude-code", "assets", "prompts", fileName),
  );
}

export function claudeWorkflowPath(projectDir: string): string {
  return resolveProviderAsset(
    projectDir,
    join(".openspec-shipper", "claude", "workflow.md"),
    join("claude-code", "assets", "workflow.md"),
  );
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
    case "refresh_branch":
    case "push":
    case "publish_archive":
    case "cleanup_worktree":
    case "waiting_for_merge":
    case "waiting_for_archive_merge":
      throw new Error(`${phase} is native OpenSpec Shipper runner logic and has no Claude prompt`);
  }
}

function renderTemplate(template: string, values: Record<string, string>): string {
  return template.replace(/{{([A-Z_]+)}}/g, (_match, key: string) => values[key] ?? "");
}
