import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { defaultConfig, runQueue, type Executor, type RunnerConfig } from "../src/runner";

describe("runner", () => {
  test("default config discovers the shipper project root from a nested directory", async () => {
    const previousCwd = process.cwd();
    const projectDir = await realpath(await mkdtemp(join(tmpdir(), "shipper-root-")));
    const nestedDir = join(projectDir, "openspec/changes");
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await mkdir(nestedDir, { recursive: true });
    await writeFile(join(projectDir, ".openspec-shipper/config.json"), "{}\n");

    delete process.env.OPENSPEC_SHIPPER_PROJECT_DIR;
    delete process.env.OPENSPEC_SHIPPER_QUEUE_PATH;
    delete process.env.PROJECT_DIR;
    delete process.env.QUEUE_PATH;
    process.chdir(nestedDir);
    try {
      const config = defaultConfig();

      expect(config.projectDir).toBe(projectDir);
      expect(config.queuePath).toBe(join(projectDir, ".openspec-shipper/queue.md"));
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("default config loads executor settings from shipper config json", async () => {
    const previousCwd = process.cwd();
    const projectDir = await realpath(await mkdtemp(join(tmpdir(), "shipper-config-")));
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await writeFile(
      join(projectDir, ".openspec-shipper/config.json"),
      JSON.stringify({
        executor: {
          provider: "opencode",
          opencode: {
            bin: "custom-opencode",
            model: "opencode-go/deepseek-v4-pro",
          },
          codex: {
            bin: "codex",
            model: "gpt-5.4",
          },
        },
      }),
    );

    delete process.env.OPENSPEC_SHIPPER_PROJECT_DIR;
    delete process.env.OPENSPEC_SHIPPER_PROVIDER;
    delete process.env.OPENSPEC_SHIPPER_OPENCODE_BIN;
    delete process.env.OPENSPEC_SHIPPER_OPENCODE_MODEL;
    delete process.env.PROJECT_DIR;
    delete process.env.OPENCODE_BIN;
    delete process.env.OPENCODE_MODEL;
    process.chdir(projectDir);
    try {
      const config = defaultConfig();

      expect(config.providerId).toBe("opencode");
      expect(config.opencodeBin).toBe("custom-opencode");
      expect(config.opencodeModel).toBe("opencode-go/deepseek-v4-pro");
    } finally {
      process.chdir(previousCwd);
    }
  });

  test("environment executor settings override shipper config json", async () => {
    const previousCwd = process.cwd();
    const projectDir = await realpath(await mkdtemp(join(tmpdir(), "shipper-config-")));
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await writeFile(
      join(projectDir, ".openspec-shipper/config.json"),
      JSON.stringify({
        executor: {
          opencode: {
            bin: "config-opencode",
            model: "opencode-go/deepseek-v4-pro",
          },
        },
      }),
    );

    delete process.env.OPENSPEC_SHIPPER_PROJECT_DIR;
    delete process.env.PROJECT_DIR;
    process.env.OPENSPEC_SHIPPER_OPENCODE_BIN = "env-opencode";
    process.env.OPENSPEC_SHIPPER_OPENCODE_MODEL = "opencode-go/env-model";
    process.chdir(projectDir);
    try {
      const config = defaultConfig();

      expect(config.opencodeBin).toBe("env-opencode");
      expect(config.opencodeModel).toBe("opencode-go/env-model");
    } finally {
      delete process.env.OPENSPEC_SHIPPER_OPENCODE_BIN;
      delete process.env.OPENSPEC_SHIPPER_OPENCODE_MODEL;
      process.chdir(previousCwd);
    }
  });

  test("does not execute when the queue has a blocked task", async () => {
    const harness = await createHarness("- [!] ship <!-- blocked: earlier -->\n- [ ] sync\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
  });

  test("skips existing blocked tasks within the configured limit", async () => {
    const harness = await createHarness("- [!] ship <!-- blocked: earlier -->\n- [ ] sync\n");
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      maxBlockedTasks: 1,
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual(["run", "--command", "openspec-main-sync"]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] ship");
    expect(queue).toContain("- [x] sync");
  });

  test("pauses when blocked tasks exceed the configured limit", async () => {
    const harness = await createHarness(
      "- [!] ship <!-- blocked: earlier -->\n- [!] archive <!-- blocked: earlier -->\n- [ ] sync\n",
    );
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      maxBlockedTasks: 1,
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
  });

  test("does not execute when there are no pending tasks", async () => {
    const harness = await createHarness("- [x] ship\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "" };
      },
    });

    expect(exitCode).toBe(0);
    expect(called).toBe(false);
  });

  test("marks the first pending task done on clean success", async () => {
    const harness = await createHarness("- [ ] sync\n- [ ] archive\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: cleanExecutor,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [x] sync");
    expect(queue).toContain("- [ ] archive");
  });

  test("passes the configured model to opencode", async () => {
    const harness = await createHarness("- [ ] sync\n");
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      opencodeModel: "opencode-go/deepseek-v4-pro",
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual([
      "run",
      "--model",
      "opencode-go/deepseek-v4-pro",
      "--command",
      "openspec-main-sync",
    ]);
  });

  test("passes the configured model to targeted apply commands", async () => {
    const harness = await createHarness("- [ ] apply test-20-migrate-notebook-access-button-rntl\n");
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      opencodeModel: "opencode-go/deepseek-v4-pro",
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual([
      "run",
      "--model",
      "opencode-go/deepseek-v4-pro",
      "--command",
      "openspec-apply-worktree",
      "test-20-migrate-notebook-access-button-rntl",
    ]);
  });

  test("advances a deliver task to the next phase on success", async () => {
    const harness = await createHarness("- [ ] deliver test-20-migrate-notebook-access-button-rntl\n");
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual([
      "run",
      "--command",
      "openspec-apply-worktree",
      "test-20-migrate-notebook-access-button-rntl",
    ]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver test-20-migrate-notebook-access-button-rntl");
    expect(queue).toContain("phase: ship");
    expect(queue).toContain("checked: 2026-06-17T12:00:00.000Z");
    expect(queue).toContain("started: 2026-06-17T12:00:00.000Z");
  });

  test("marks a task as running before invoking the executor", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    let queueDuringExecution = "";

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => {
        queueDuringExecution = await readFile(harness.queuePath, "utf8");
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(queueDuringExecution).toContain("phase: apply");
    expect(queueDuringExecution).toContain("running: 2026-06-17T12:00:00.000Z");
    expect(queueDuringExecution).toContain("![apply running](https://img.shields.io/badge/apply-running-yellow)");
  });

  test("writes log links relative to the queue file", async () => {
    const harness = await createHarness("");
    const queuePath = join(harness.config.stateDir, "queue.md");
    await mkdir(harness.config.stateDir, { recursive: true });
    await writeFile(queuePath, "- [ ] sync\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      rootDir: join(harness.rootDir, "node_modules/openspec-shipper"),
      queuePath,
      executor: cleanExecutor,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(queuePath, "utf8");
    expect(queue).toContain("log: runs/2026-06-17T12-00-00-000Z-sync.log");
    expect(queue).toContain("_([log](runs/2026-06-17T12-00-00-000Z-sync.log))_");
    expect(queue).not.toContain("../../.openspec-shipper");
  });

  test("runs the current deliver phase", async () => {
    const harness = await createHarness(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: ship -->\n",
    );
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual([
      "run",
      "--command",
      "openspec-ship-worktree",
      "test-20-migrate-notebook-access-button-rntl",
    ]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: waiting_for_merge");
  });

  test("advances deliver ship phase to waiting for PR when no pull request exists after success", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: ship -->\n");
    let checkedBranch = "";

    const exitCode = await runQueue("next", {
      ...harness.config,
      pullRequestDetector: async (_projectDir, branch) => {
        checkedBranch = branch;
        return undefined;
      },
      executor: cleanExecutor,
    });

    expect(exitCode).toBe(0);
    expect(checkedBranch).toBe("feat/add-name-greeting");
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver add-name-greeting");
    expect(queue).toContain("phase: waiting_for_pr");
    expect(queue).toContain("![waiting_for_pr waiting](https://img.shields.io/badge/waiting_for_pr-waiting-orange)");
    expect(queue).not.toContain("waiting_for_merge");
  });

  test("marks a deliver task done after archive succeeds", async () => {
    const harness = await createHarness(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: archive -->\n",
    );

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: cleanExecutor,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [x] deliver test-20-migrate-notebook-access-button-rntl");
  });

  test("skips deliver tasks waiting for dependencies", async () => {
    const harness = await createHarness(
      [
        "- [ ] deliver change-b <!-- depends_on: change-a -->",
        "- [ ] deliver change-c",
      ].join("\n"),
    );
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual(["run", "--command", "openspec-apply-worktree", "change-c"]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver change-b <!-- depends_on: change-a -->");
    expect(queue).toContain("- [ ] deliver change-c");
    expect(queue).toContain("phase: ship");
  });

  test("skips deliver tasks waiting for merge", async () => {
    const harness = await createHarness(
      [
        "- [ ] deliver change-b <!-- phase: waiting_for_merge -->",
        "- [ ] deliver change-c",
      ].join("\n"),
    );
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual(["run", "--command", "openspec-apply-worktree", "change-c"]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver change-b <!-- phase: waiting_for_merge -->");
    expect(queue).toContain("- [ ] deliver change-c");
    expect(queue).toContain("phase: ship");
  });

  test("passes OpenCode log flags before the command", async () => {
    const harness = await createHarness("- [ ] sync\n");
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      opencodeModel: "opencode-go/deepseek-v4-pro",
      opencodePrintLogs: true,
      opencodeLogLevel: "ERROR",
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual([
      "run",
      "--print-logs",
      "--log-level",
      "ERROR",
      "--model",
      "opencode-go/deepseek-v4-pro",
      "--command",
      "openspec-main-sync",
    ]);
  });

  test("passes OpenCode stats options to the executor when enabled", async () => {
    const harness = await createHarness("- [ ] sync\n");
    let receivedOptions: Parameters<Executor>[2] | undefined;

    const exitCode = await runQueue("next", {
      ...harness.config,
      opencodeStats: true,
      opencodeStatsIntervalMs: 120_000,
      opencodeStatsTimeoutMs: 10_000,
      opencodeStatsProject: "",
      opencodeStatsModels: "5",
      executor: async (_command, _args, options) => {
        receivedOptions = options;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedOptions?.stats).toEqual({
      command: "mock-opencode",
      cwd: harness.rootDir,
      intervalMs: 120_000,
      timeoutMs: 10_000,
      project: "",
      models: "5",
      days: undefined,
    });
  });

  test("marks the first pending task blocked on non-zero exit", async () => {
    const harness = await createHarness("- [ ] ship\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => ({ exitCode: 1, output: "failed" }),
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] ship");
    expect(queue).toContain("command exited with code 1");
  });

  test("marks the first pending task blocked when output contains an error signal", async () => {
    const harness = await createHarness("- [ ] ship\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => ({ exitCode: 0, output: "Unexpected server error" }),
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] ship");
    expect(queue).toContain("unexpected server error");
  });

  test("blocks deliver ship phase when the worker reports a push blocker", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: ship -->\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => ({
        exitCode: 0,
        output: "## Blocked: `add-name-greeting` is not push-ready\nNo worktree has been created.",
      }),
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: ship");
    expect(queue).toContain("Worker reported a blocker");
    expect(queue).not.toContain("waiting_for_merge");
  });

  test("blocks deliver ship phase when the worker emits the blocked sentinel", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: ship -->\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => ({
        exitCode: 0,
        output: "Pushed branch\nOPENSPEC_SHIPPER_BLOCKED: no open pull request exists for feat/add-name-greeting",
      }),
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: ship");
    expect(queue).toContain("no open pull request exists for feat/add-name-greeting");
    expect(queue).not.toContain("waiting_for_merge");
  });

  test("marks the first pending task blocked when the executor cannot start", async () => {
    const harness = await createHarness("- [ ] sync\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => {
        throw new Error("spawn failed");
      },
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] sync");
    expect(queue).toContain("spawn failed");
  });

  test("blocks before execution when the project command file is missing", async () => {
    const harness = await createHarness("- [ ] ship\n", { createCommandFiles: false });
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] ship");
    expect(queue).toContain("OpenCode command file not found");
  });

  test("blocks ship before execution when git remote origin is missing", async () => {
    const harness = await createHarness("- [ ] ship\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      gitRemoteDetector: async () => undefined,
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] ship");
    expect(queue).toContain("Git remote origin is not configured");
  });

  test("blocks deliver ship phase before waiting for merge when git remote origin is missing", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: ship -->\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      gitRemoteDetector: async () => undefined,
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: ship");
    expect(queue).toContain("Git remote origin is not configured");
    expect(queue).not.toContain("waiting_for_merge");
  });

  test("blocks apply before execution when main is dirty and no claim exists", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      gitStatusDetector: async () => [" M package.json", "?? .opencode/"],
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: apply");
    expect(queue).toContain("no existing worktree or branch for add-name-greeting");
  });

  test("ignores shipper runtime files when checking dirty main", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      gitStatusDetector: async () => ["?? .openspec-shipper/shipper.lock"],
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(called).toBe(true);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: ship");
  });

  test("allows apply with dirty main when the change worktree already exists", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    await mkdir(join(harness.rootDir, "worktrees/add-name-greeting"), { recursive: true });
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      gitStatusDetector: async () => [" M package.json", "?? .opencode/"],
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(called).toBe(true);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: ship");
  });

  test("next mode marks the task as checking before detecting active opencode", async () => {
    const harness = await createHarness("- [ ] ship\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      processDetector: async () => ["12345"],
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] ship <!-- checking: 2026-06-17T12:00:00.000Z -->");
    expect(queue).toContain("![task checking](https://img.shields.io/badge/task-checking-yellow)");
  });

  test("run mode processes pending tasks until the queue is complete", async () => {
    const harness = await createHarness("- [ ] sync\n- [ ] archive\n");
    const calls: string[] = [];
    const sleeps: number[] = [];

    const exitCode = await runQueue("run", {
      ...harness.config,
      executor: async (_command, args) => {
        calls.push(args.join(" "));
        return { exitCode: 0, output: "done" };
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [x] sync");
    expect(queue).toContain("- [x] archive");
  });

  test("run mode continues after the first blocked task by default", async () => {
    const harness = await createHarness("- [ ] sync\n- [ ] archive\n");
    let calls = 0;

    const exitCode = await runQueue("run", {
      ...harness.config,
      maxBlockedTasks: 100,
      executor: async () => {
        calls += 1;
        return { exitCode: 1, output: "failed" };
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(2);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] sync");
    expect(queue).toContain("- [!] archive");
  });

  test("run mode continues after blocked tasks within the configured limit", async () => {
    const harness = await createHarness("- [ ] sync\n- [ ] archive\n");
    let calls = 0;

    const exitCode = await runQueue("run", {
      ...harness.config,
      maxBlockedTasks: 1,
      executor: async () => {
        calls += 1;
        return calls === 1 ? { exitCode: 1, output: "failed" } : { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(2);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] sync");
    expect(queue).toContain("- [x] archive");
  });

  test("run mode waits instead of blocking when opencode is already active", async () => {
    const harness = await createHarness("- [ ] sync\n");
    const sleeps: number[] = [];
    let checks = 0;
    let calls = 0;

    const exitCode = await runQueue("run", {
      ...harness.config,
      busyDelayMs: 5,
      processDetector: async () => {
        checks += 1;
        return checks === 1 ? ["12345"] : [];
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      executor: async () => {
        calls += 1;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(1);
    expect(sleeps).toEqual([5]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [x] sync");
  });

  test("stop mode requests a safe queue stop", async () => {
    const harness = await createHarness("- [ ] sync\n");

    const exitCode = await runQueue("stop", harness.config);

    expect(exitCode).toBe(0);
    const stop = await readFile(join(harness.config.stateDir, "stop"), "utf8");
    expect(stop).toContain("Stop queue:run at the next safe checkpoint");
  });

  test("run mode exits while waiting when stop is requested", async () => {
    const harness = await createHarness("- [ ] sync\n");
    const sleeps: number[] = [];
    let called = false;

    const exitCode = await runQueue("run", {
      ...harness.config,
      busyDelayMs: 60_000,
      processDetector: async () => ["12345"],
      sleep: async (ms) => {
        sleeps.push(ms);
        await writeFile(join(harness.config.stateDir, "stop"), "{}");
      },
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(called).toBe(false);
    expect(sleeps).toEqual([1_000]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] sync <!-- checking: 2026-06-17T12:00:00.000Z -->");
    expect(queue).toContain("![task checking](https://img.shields.io/badge/task-checking-yellow)");
  });
});

const cleanExecutor: Executor = async () => ({ exitCode: 0, output: "done" });

async function createHarness(queueContent: string, options: { createCommandFiles?: boolean } = {}) {
  const rootDir = await mkdtemp(join(tmpdir(), "orchester-test-"));
  const queuePath = join(rootDir, "queue.md");
  await writeFile(queuePath, queueContent);
  const createCommandFiles = options.createCommandFiles ?? true;

  if (createCommandFiles) {
    const commandDir = join(rootDir, ".opencode", "commands");
    await mkdir(commandDir, { recursive: true });
    await Promise.all(
      [
        "openspec-apply-worktree",
        "openspec-ship-worktree",
        "openspec-main-sync",
        "openspec-archive-merged",
      ].map((commandName) => writeFile(join(commandDir, `${commandName}.md`), "")),
    );
  }

  const config: RunnerConfig = {
    rootDir,
    projectDir: rootDir,
    queuePath,
    stateDir: join(rootDir, ".openspec-shipper"),
    opencodeBin: "mock-opencode",
    opencodeStatsIntervalMs: 120_000,
    opencodeStatsTimeoutMs: 10_000,
    opencodeStatsProject: "",
    loopDelayMs: 0,
    busyDelayMs: 0,
    taskTimeoutMs: 1_000,
    heartbeatMs: 0,
    maxBlockedTasks: 0,
    processDetector: async () => [],
    gitRemoteDetector: async () => "git@github.com:example/project.git",
    gitStatusDetector: async () => [],
    pullRequestDetector: async () => "https://github.com/example/project/pull/1",
    now: () => new Date("2026-06-17T12:00:00.000Z"),
  };

  return { rootDir, queuePath, config };
}
