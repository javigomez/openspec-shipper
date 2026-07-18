import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { parseQueue } from "../src/domain/queue/queue";
import { codexCliProvider } from "../src/infrastructure/providers/codex-cli/provider";
import { opencodeProvider } from "../src/infrastructure/providers/opencode/provider";
import { installCodexTemplates } from "../src/application/init/setup";

const config = {
  executor: {
    provider: "opencode" as const,
    opencode: {
      bin: "opencode",
      model: "opencode-go/deepseek-v4-pro",
    },
    codex: {
      bin: "codex",
      model: "gpt-5.4",
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
    expect(command.args).toContain("gpt-5.4");
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
});
