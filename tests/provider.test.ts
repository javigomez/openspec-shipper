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

  test("OpenCode provider builds cleanup command with the target change", () => {
    const task = parseQueue("- [ ] deliver add-name-greeting <!-- phase: cleanup_worktree -->\n").tasks[0]!;

    const command = opencodeProvider.buildCommand({
      phase: "cleanup_worktree",
      task,
      projectDir: "/repo",
      config,
    });

    expect(command.args).toContain("openspec-cleanup-worktree");
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

  test("OpenCode provider treats missing pull requests as a ship failure", () => {
    expect(opencodeProvider.detectFailureSignal("No pull request exists yet — branch-push automation should create it.")).toBe(
      "Ship worker did not find an open pull request",
    );
  });

  test("OpenCode provider treats blocked sentinel lines as failures", () => {
    expect(opencodeProvider.detectFailureSignal("All checks passed\nOPENSPEC_SHIPPER_BLOCKED: no open pull request exists")).toBe(
      "Worker reported a blocker: no open pull request exists",
    );
  });

  test("OpenCode provider treats worker blocked summaries as failures", () => {
    expect(opencodeProvider.detectFailureSignal("## Blocked: `add-name-greeting` is not push-ready")).toBe(
      "Worker reported a blocker",
    );
    expect(opencodeProvider.detectFailureSignal("The target change is not eligible for push.")).toBe(
      "Worker reported a blocker",
    );
  });
});
