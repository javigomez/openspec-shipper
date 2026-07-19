import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseQueue } from "../src/domain/queue/queue";
import { codexCliProvider } from "../src/infrastructure/providers/codex-cli/provider";
import { claudeCodeProvider, claudeSettingsContent, parseClaudeResult } from "../src/infrastructure/providers/claude-code/provider";
import { opencodeProvider } from "../src/infrastructure/providers/opencode/provider";
import { installClaudeTemplates, installCodexTemplates } from "../src/application/init/setup";

const config = {
  executor: {
    provider: "opencode" as const,
    opencode: {
      bin: "opencode",
      model: "opencode-go/deepseek-v4-pro",
    },
    codex: {
      bin: "codex",
      model: "gpt-5.5",
      reasoningEffort: "low",
    },
    claude: {
      bin: "claude",
      model: "sonnet",
      effort: "low",
      permissionMode: "dontAsk",
    },
  },
  opencodePrintLogs: true,
  opencodeLogLevel: "ERROR",
};

describe("executor providers", () => {
  test("OpenCode provider builds the current apply command", () => {
    const task = parseQueue("- [ ] deliver add-name-greeting <!-- phase: implement -->\n").tasks[0]!;

    const command = opencodeProvider.buildCommand({
      phase: "implement",
      task,
      projectDir: "/repo",
      config,
    });

    expect(command).toEqual({
      command: "opencode",
      args: [
        "run",
        "--print-logs",
        "--log-level",
        "ERROR",
        "--model",
        "opencode-go/deepseek-v4-pro",
        "--command",
        "openspec-apply-worktree",
        "add-name-greeting",
      ],
      cwd: "/repo",
    });
  });

  test("OpenCode provider builds archive command with the target change", () => {
    const task = parseQueue("- [ ] deliver add-name-greeting <!-- phase: archive -->\n").tasks[0]!;

    const command = opencodeProvider.buildCommand({
      phase: "archive",
      task,
      projectDir: "/repo",
      config,
    });

    expect(command.args).toContain("openspec-archive-merged");
    expect(command.args.at(-1)).toBe("add-name-greeting");
  });

  test("Codex CLI provider builds an experimental exec command from installed prompts", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "shipper-codex-provider-"));
    await installCodexTemplates({ rootDir: join(import.meta.dir, ".."), projectDir });
    const task = parseQueue("- [ ] deliver add-name-greeting\n").tasks[0]!;

    const command = codexCliProvider.buildCommand({
      phase: "implement",
      task,
      projectDir,
      config: {
        ...config,
        executor: {
          ...config.executor,
          provider: "codex-cli",
        },
      },
    });

    expect(command.command).toBe("codex");
    expect(command.args.slice(0, 8)).toEqual([
      "exec",
      "-C",
      projectDir,
      "--sandbox",
      "workspace-write",
      "-c",
      'approval_policy="never"',
      "--model",
    ]);
    expect(command.args).toContain("gpt-5.5");
    expect(command.args).toContain('model_reasoning_effort="low"');
    expect(command.args.at(-1)).toContain("OpenSpec Shipper Codex Phase: implement");
    expect(command.args.at(-1)).toContain("add-name-greeting");
    expect(command.args.at(-1)).toContain("Installed Workflow Reference");
  });

  test("Codex CLI provider treats blocked sentinel lines as failures", () => {
    expect(codexCliProvider.detectFailureSignal("All checks passed\nOPENSPEC_SHIPPER_BLOCKED: missing gh auth")).toBe(
      "Worker reported a blocker: missing gh auth",
    );
    expect(codexCliProvider.detectFailureSignal("approval required for command")).toBe("Codex CLI reported a blocker");
  });

  test("Codex CLI provider ignores blocked sentinel examples echoed from the prompt", () => {
    const output = [
      "user",
      "If blocked, print:",
      "OPENSPEC_SHIPPER_BLOCKED: <short reason>",
      "OPENSPEC_SHIPPER_BLOCKED: prepared worktree missing for add-name-greeting",
      "codex",
      "Implemented the change and committed it successfully.",
    ].join("\n");

    expect(codexCliProvider.detectFailureSignal(output)).toBeUndefined();
  });

  test("Codex CLI provider detects blocked sentinel lines in assistant output", () => {
    const output = [
      "user",
      "OPENSPEC_SHIPPER_BLOCKED: <short reason>",
      "codex",
      "I cannot continue.",
      "OPENSPEC_SHIPPER_BLOCKED: missing gh auth",
    ].join("\n");

    expect(codexCliProvider.detectFailureSignal(output)).toBe("Worker reported a blocker: missing gh auth");
  });

  test("Codex CLI provider keeps scanning after placeholder blocker examples", () => {
    const output = [
      "user",
      "Run the phase.",
      "codex",
      "Reading workflow.md",
      "OPENSPEC_SHIPPER_BLOCKED: <short reason>",
      "The repo is dirty, so I cannot continue.",
      "OPENSPEC_SHIPPER_BLOCKED: dirty root main checkout",
    ].join("\n");

    expect(codexCliProvider.detectFailureSignal(output)).toBe("Worker reported a blocker: dirty root main checkout");
  });

  test("Claude Code provider builds a sandboxed non-interactive command with prompt on stdin", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "shipper-claude-provider-"));
    await installClaudeTemplates({ rootDir: join(import.meta.dir, ".."), projectDir });
    const task = parseQueue("- [ ] deliver add-name-greeting <!-- phase: implement -->\n").tasks[0]!;

    const command = claudeCodeProvider.buildCommand({
      phase: "implement",
      task,
      projectDir,
      config: {
        ...config,
        executor: { ...config.executor, provider: "claude-code" },
      },
    });

    expect(command.command).toBe("claude");
    expect(command.args).toContain("-p");
    expect(command.args).toContain("dontAsk");
    expect(command.args).toContain("sonnet");
    expect(command.args).toContain("low");
    expect(command.args).toContain("--json-schema");
    expect(command.args).toContain("--strict-mcp-config");
    expect(command.args.join(" ")).toContain(".openspec-shipper/claude/settings.json");
    expect(command.stdin).toContain("OpenSpec Shipper Claude Phase: implement");
    expect(command.stdin).toContain("add-name-greeting");
  });

  test("Claude Code settings render strict, permissive, and off sandbox modes", () => {
    expect(JSON.parse(claudeSettingsContent("strict")).sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      failIfUnavailable: true,
      allowUnsandboxedCommands: false,
    });
    expect(JSON.parse(claudeSettingsContent("permissive")).sandbox).toEqual({
      enabled: true,
      autoAllowBashIfSandboxed: true,
      failIfUnavailable: false,
      allowUnsandboxedCommands: true,
    });
    expect(JSON.parse(claudeSettingsContent("off")).sandbox).toEqual({ enabled: false });
  });

  test("Claude Code provider detects structured blockers and successful results", () => {
    const blocked = JSON.stringify({
      type: "result",
      is_error: false,
      structured_output: { status: "blocked", summary: "Cannot continue", reason: "tests fail" },
    });
    const completed = JSON.stringify({
      type: "result",
      is_error: false,
      structured_output: { status: "completed", summary: "Done", reason: null },
    });

    expect(claudeCodeProvider.detectFailureSignal(blocked)).toBe("Worker reported a blocker: tests fail");
    expect(claudeCodeProvider.detectFailureSignal(completed)).toBeUndefined();
    expect(parseClaudeResult(`heartbeat\n${completed}\n` )?.structured_output?.status).toBe("completed");
  });

  test("Claude Code provider trusts completed structured output even when text quotes blocker words", () => {
    const completed = JSON.stringify({
      type: "result",
      is_error: false,
      result: [
        "A test fixture intentionally prints: permission denied.",
        "The historical log also mentioned max turns and OPENSPEC_SHIPPER_BLOCKED: old failure.",
      ].join("\n"),
      structured_output: {
        status: "completed",
        summary: "Completed after verifying a quoted permission denied fixture.",
        reason: null,
      },
    });

    expect(claudeCodeProvider.detectFailureSignal(completed)).toBeUndefined();
  });

  test("Claude Code provider detects structured CLI errors and sentinel fallback", () => {
    const cliError = JSON.stringify({ type: "result", is_error: true, subtype: "error_max_turns", result: "turn limit reached" });
    expect(claudeCodeProvider.detectFailureSignal(cliError)).toBe("Claude Code reported an error: turn limit reached");
    expect(claudeCodeProvider.detectFailureSignal("OPENSPEC_SHIPPER_BLOCKED: missing worktree")).toBe(
      "Worker reported a blocker: missing worktree",
    );
    expect(parseClaudeResult("not json")).toBeUndefined();
    expect(claudeCodeProvider.detectFailureSignal("Implemented successfully")).toBe(
      "Claude Code did not return the required structured completion result",
    );
  });

  test("OpenCode provider treats blocked sentinel lines as failures", () => {
    expect(opencodeProvider.detectFailureSignal("All checks passed\nOPENSPEC_SHIPPER_BLOCKED: no open pull request exists")).toBe(
      "Worker reported a blocker: no open pull request exists",
    );
  });

  test("OpenCode provider treats worker blocked summaries as failures", () => {
    expect(opencodeProvider.detectFailureSignal("Archive blocked because the change was not merged")).toBe(
      "OpenSpec archive worker reported a blocker",
    );
  });

  test("OpenCode provider ignores blocker-looking text outside the final output section", () => {
    const output = [
      "npm test output:",
      "### Blocked: this heading belongs to a markdown fixture",
      "OpenCode auto-rejected a permission request in an old copied log",
      "No pull request exists in this intentionally quoted test fixture",
      "OPENSPEC_SHIPPER_BLOCKED: copied from an old log",
      ...Array.from({ length: 90 }, (_, index) => `progress line ${index}`),
      "All implementation tasks completed.",
    ].join("\n");

    expect(opencodeProvider.detectFailureSignal(output)).toBeUndefined();
  });

  test("OpenCode provider still detects final blocker signals without structured output", () => {
    expect(opencodeProvider.detectFailureSignal([
      "All checks passed earlier.",
      ...Array.from({ length: 90 }, (_, index) => `progress line ${index}`),
      "### Blocked: GitHub permissions are missing",
    ].join("\n"))).toBe("Worker reported a blocker");

    expect(opencodeProvider.detectFailureSignal([
      "All checks passed earlier.",
      "OPENSPEC_SHIPPER_BLOCKED: missing gh auth",
    ].join("\n"))).toBe("Worker reported a blocker: missing gh auth");
  });
});
