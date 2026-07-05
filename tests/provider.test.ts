import { describe, expect, test } from "bun:test";
import { parseQueue } from "../src/domain/queue/queue";
import { codexCliProvider } from "../src/infrastructure/providers/codex-cli/provider";
import { opencodeProvider } from "../src/infrastructure/providers/opencode/provider";

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
    const task = parseQueue("- [ ] deliver add-name-greeting\n").tasks[0]!;

    const command = opencodeProvider.buildCommand({
      phase: "apply",
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

  test("Codex CLI provider builds an experimental exec command", () => {
    const task = parseQueue("- [ ] deliver add-name-greeting\n").tasks[0]!;

    const command = codexCliProvider.buildCommand({
      phase: "apply",
      task,
      projectDir: "/repo",
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
      "/repo",
      "--sandbox",
      "workspace-write",
      "--ask-for-approval",
      "never",
      "--model",
    ]);
    expect(command.args).toContain("gpt-5.4");
    expect(command.args.at(-1)).toContain("OpenSpec apply phase");
  });
});
