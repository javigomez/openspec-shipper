import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, test } from "bun:test";
import { defaultConfig, detectMainSyncStatus, runQueue, synchronizeBaseBranchWithOrigin, type Executor, type RunnerConfig } from "../src/runner";
import { BLOCKED_TASK_RETRY_HINT } from "../src/queue";
import { installCodexTemplates } from "../src/application/init/setup";
import { silenceConsoleDuringTests } from "./test-console";

silenceConsoleDuringTests();

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
    const harness = await createHarness(
      "- [!] deliver add-name-greeting <!-- phase: push; blocked: earlier -->\n- [ ] deliver add-spanish-greeting <!-- phase: sync_main -->\n",
    );
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
    const harness = await createHarness(
      "- [!] deliver add-name-greeting <!-- phase: push; blocked: earlier -->\n- [ ] deliver add-spanish-greeting <!-- phase: sync_main -->\n",
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

    expect(exitCode).toBe(0);
    expect(called).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("- [ ] deliver add-spanish-greeting");
    expect(queue).toContain("phase: archive");
  });

  test("pauses when blocked tasks exceed the configured limit", async () => {
    const harness = await createHarness(
      [
        "- [!] deliver add-name-greeting <!-- phase: push; blocked: earlier -->",
        "- [!] deliver add-spanish-greeting <!-- phase: archive; blocked: earlier -->",
        "- [ ] deliver add-shouting-greeting <!-- phase: sync_main -->",
      ].join("\n"),
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
    const harness = await createHarness("- [x] deliver add-name-greeting <!-- phase: cleanup_worktree -->\n");
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

  test("advances the first pending deliver task on clean success", async () => {
    const harness = await createHarness(
      "- [ ] deliver add-name-greeting <!-- phase: sync_main -->\n- [ ] deliver add-spanish-greeting <!-- phase: archive -->\n",
    );

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: cleanExecutor,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver add-name-greeting");
    expect(queue).toContain("phase: archive");
    expect(queue).toContain("- [ ] deliver add-spanish-greeting");
  });

  test("passes the configured model to opencode", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
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
      "openspec-archive-merged",
      "add-name-greeting",
    ]);
  });

  test("passes the configured model to targeted apply commands", async () => {
    const harness = await createHarness(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: implement -->\n",
    );
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      localClaimDetector: async (_projectDir, changeName) =>
        changeName === "test-20-migrate-notebook-access-button-rntl",
      tasksCompleteDetector: async () => false,
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
    let preparedChange = "";

    const exitCode = await runQueue("next", {
      ...harness.config,
      maxBlockedTasks: 1,
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
      prepareWorkspace: async (input) => {
        preparedChange = input.changeName;
        return "prepared\n";
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual([]);
    expect(preparedChange).toBe("test-20-migrate-notebook-access-button-rntl");
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver test-20-migrate-notebook-access-button-rntl");
    expect(queue).toContain("phase: implement");
    expect(queue).toContain("checked: 2026-06-17T12:00:00.000Z");
    expect(queue).toContain("started: 2026-06-17T12:00:00.000Z");
  });

  test("marks a native prepare task as running before preparing the workspace", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    let queueDuringExecution = "";

    const exitCode = await runQueue("next", {
      ...harness.config,
      prepareWorkspace: async () => {
        queueDuringExecution = await readFile(harness.queuePath, "utf8");
        return "prepared\n";
      },
    });

    expect(exitCode).toBe(0);
    expect(queueDuringExecution).toContain("phase: prepare_worktree");
    expect(queueDuringExecution).toContain("running: 2026-06-17T12:00:00.000Z");
    expect(queueDuringExecution).toContain("![prepare_worktree running](https://img.shields.io/badge/prepare_worktree-running-yellow)");
  });

  test("writes log links relative to the queue file", async () => {
    const harness = await createHarness("");
    const queuePath = join(harness.config.stateDir, "queue.md");
    await mkdir(harness.config.stateDir, { recursive: true });
    await writeFile(queuePath, "- [ ] deliver add-name-greeting <!-- phase: sync_main -->\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      rootDir: join(harness.rootDir, "node_modules/openspec-shipper"),
      queuePath,
      executor: cleanExecutor,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(queuePath, "utf8");
    expect(queue).toContain("log: runs/2026-06-17T12-00-00-000Z-deliver-sync_main-add-name-greeting.log");
    expect(queue).toContain("_([log](runs/2026-06-17T12-00-00-000Z-deliver-sync_main-add-name-greeting.log))_");
    expect(queue).not.toContain("../../.openspec-shipper");
  });

  test("runs the current deliver phase", async () => {
    const harness = await createHarness(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: push -->\n",
    );
    let receivedArgs: string[] = [];
    let pushedChange = "";

    const exitCode = await runQueue("next", {
      ...harness.config,
      ...implementedChangeEvidence("test-20-migrate-notebook-access-button-rntl"),
      pushBranchAndOpenPullRequest: async (input) => {
        pushedChange = input.changeName;
        return "pushed and opened PR\n";
      },
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual([]);
    expect(pushedChange).toBe("test-20-migrate-notebook-access-button-rntl");
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver test-20-migrate-notebook-access-button-rntl");
    expect(queue).toContain("phase: waiting_for_merge");
    expect(queue).toContain("![waiting_for_merge blocked](https://img.shields.io/badge/waiting_for_merge-blocked-red)");
    expect(queue).toContain(BLOCKED_TASK_RETRY_HINT);
  });

  test("advances deliver push phase to waiting for merge after opening a PR", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: push -->\n");
    let pushedBranch = "";
    let baseBranch = "";

    const exitCode = await runQueue("next", {
      ...harness.config,
      baseBranch: "develop",
      ...implementedChangeEvidence("add-name-greeting"),
      pushBranchAndOpenPullRequest: async (input) => {
        pushedBranch = input.branch;
        baseBranch = input.baseBranch;
        return "pushed and opened PR\n";
      },
      executor: cleanExecutor,
    });

    expect(exitCode).toBe(0);
    expect(pushedBranch).toBe("feat/add-name-greeting");
    expect(baseBranch).toBe("develop");
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: waiting_for_merge");
    expect(queue).toContain("![waiting_for_merge blocked](https://img.shields.io/badge/waiting_for_merge-blocked-red)");
    expect(queue).toContain(BLOCKED_TASK_RETRY_HINT);
  });

  test("advances a deliver task to cleanup after archive succeeds", async () => {
    const harness = await createHarness(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: archive -->\n",
    );

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: cleanExecutor,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver test-20-migrate-notebook-access-button-rntl");
    expect(queue).toContain("phase: cleanup_worktree");
    expect(queue).toContain("![cleanup_worktree ready](https://img.shields.io/badge/cleanup_worktree-ready-blue)");
  });

  test("finalizes archive by committing and pushing OpenSpec diff", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "shipper-archive-finalize-"));
    const originDir = join(rootDir, "origin.git");
    const projectDir = join(rootDir, "project");

    git(rootDir, ["init", "--bare", originDir]);
    await mkdir(projectDir, { recursive: true });
    git(projectDir, ["init", "-b", "main"]);
    git(projectDir, ["config", "user.name", "Test User"]);
    git(projectDir, ["config", "user.email", "test@example.com"]);
    git(projectDir, ["remote", "add", "origin", originDir]);
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await mkdir(join(projectDir, ".opencode/commands"), { recursive: true });
    await writeFile(join(projectDir, ".gitignore"), ".openspec-shipper/queue.md\n.openspec-shipper/runs/\n");
    await writeFile(join(projectDir, ".openspec-shipper/config.json"), JSON.stringify({ safety: { enableArchive: true } }));
    await writeFile(join(projectDir, ".opencode/commands/openspec-archive-merged.md"), "archive\n");
    await writeFile(join(projectDir, "README.md"), "demo\n");
    git(projectDir, ["add", "."]);
    git(projectDir, ["commit", "-m", "chore: initial"]);
    git(projectDir, ["push", "-u", "origin", "main"]);

    const queuePath = join(projectDir, ".openspec-shipper/queue.md");
    await writeFile(queuePath, "- [ ] deliver add-name-greeting <!-- phase: archive -->\n");

    const exitCode = await runQueue("next", {
      rootDir: projectDir,
      projectDir,
      queuePath,
      stateDir: join(projectDir, ".openspec-shipper"),
      opencodeBin: "mock-opencode",
      opencodeStatsIntervalMs: 120_000,
      opencodeStatsTimeoutMs: 10_000,
      opencodeStatsProject: "",
      loopDelayMs: 0,
      busyDelayMs: 0,
      taskTimeoutMs: 1_000,
      heartbeatMs: 0,
      maxBlockedTasks: 0,
      executor: async () => {
        const archiveDir = join(projectDir, "openspec/changes/archive/2026-07-18-add-name-greeting");
        await mkdir(archiveDir, { recursive: true });
        await mkdir(join(projectDir, "openspec/specs/hello-cli"), { recursive: true });
        await writeFile(join(archiveDir, "proposal.md"), "proposal\n");
        await writeFile(join(archiveDir, "design.md"), "design\n");
        await writeFile(join(archiveDir, "tasks.md"), "- [x] done\n");
        await writeFile(join(projectDir, "openspec/specs/hello-cli/spec.md"), "## Purpose\n\nGreeting.\n");
        return { exitCode: 0, output: "archived\n" };
      },
    });

    expect(exitCode).toBe(0);
    expect(git(projectDir, ["log", "-1", "--pretty=%s"]).trim()).toBe("chore: archive add-name-greeting");
    expect(git(originDir, ["rev-parse", "main"]).trim()).toBe(git(projectDir, ["rev-parse", "HEAD"]).trim());
    const queue = await readFile(queuePath, "utf8");
    expect(queue).toContain("phase: cleanup_worktree");
  });

  test("marks a deliver task done after cleanup succeeds", async () => {
    const harness = await createHarness(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: cleanup_worktree -->\n",
    );

    const exitCode = await runQueue("next", {
      ...harness.config,
      cleanupWorkspace: async () => "cleaned\n",
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
    let preparedChange = "";

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async (_command, args) => {
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
      prepareWorkspace: async (input) => {
        preparedChange = input.changeName;
        return "prepared\n";
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedArgs).toEqual([]);
    expect(preparedChange).toBe("change-c");
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver change-b <!-- depends_on: change-a -->");
    expect(queue).toContain("- [ ] deliver change-c");
    expect(queue).toContain("phase: implement");
  });

  test("blocks deliver tasks waiting for merge", async () => {
    const harness = await createHarness(
      [
        "- [ ] deliver change-b <!-- phase: waiting_for_merge -->",
        "- [ ] deliver change-c",
      ].join("\n"),
    );
    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => {
        throw new Error("waiting for merge should block before running another task");
      },
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver change-b");
    expect(queue).toContain("phase: waiting_for_merge");
    expect(queue).toContain("![waiting_for_merge blocked](https://img.shields.io/badge/waiting_for_merge-blocked-red)");
    expect(queue).toContain(BLOCKED_TASK_RETRY_HINT);
    expect(queue).toContain("- [ ] deliver change-c");
    expect(queue).not.toContain("phase: implement");
  });

  test("refreshes waiting-for-merge tasks to sync when the PR is merged", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: waiting_for_merge -->\n");

    const exitCode = await runQueue("dry-run", {
      ...harness.config,
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async (_projectDir, branch) =>
        branch === "feat/add-name-greeting" ? "https://github.com/example/project/pull/1" : undefined,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: sync_main");
    expect(queue).toContain("![sync_main ready](https://img.shields.io/badge/sync_main-ready-blue)");
  });

  test("reconstructs waiting-for-merge from a bare deliver task when a PR is open", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");

    const exitCode = await runQueue("run", {
      ...harness.config,
      maxBlockedTasks: 1,
      activeChangeDetector: async () => false,
      remoteBranchDetector: async (_projectDir, branch) => branch === "feat/add-name-greeting",
      pullRequestDetector: async (_projectDir, branch) =>
        branch === "feat/add-name-greeting" ? "https://github.com/example/project/pull/1" : undefined,
      executor: async () => {
        throw new Error("reconcile should not run a worker for an open PR");
      },
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: waiting_for_merge");
    expect(queue).toContain(BLOCKED_TASK_RETRY_HINT);
  });

  test("reconstructs sync from a bare deliver task when the PR is already merged", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");

    const exitCode = await runQueue("dry-run", {
      ...harness.config,
      activeChangeDetector: async () => false,
      remoteBranchDetector: async (_projectDir, branch) => branch === "feat/add-name-greeting",
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async (_projectDir, branch) =>
        branch === "feat/add-name-greeting" ? "https://github.com/example/project/pull/1" : undefined,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: sync_main");
  });

  test("prefers active local changes over stale merged PR evidence", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    let preparedChange = "";

    const exitCode = await runQueue("next", {
      ...harness.config,
      activeChangeDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      localClaimDetector: async () => false,
      remoteBranchDetector: async (_projectDir, branch) => branch === "feat/add-name-greeting",
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async (_projectDir, branch) =>
        branch === "feat/add-name-greeting" ? "https://github.com/example/project/pull/1" : undefined,
      prepareWorkspace: async (input) => {
        preparedChange = input.changeName;
        return "prepared\n";
      },
      executor: async () => {
        throw new Error("stale PR evidence should not skip prepare_worktree");
      },
    });

    expect(exitCode).toBe(0);
    expect(preparedChange).toBe("add-name-greeting");
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: implement");
    expect(queue).not.toContain("phase: sync_main");
    expect(queue).not.toContain("phase: archive");
  });

  test("regresses stale advanced phases when local implementation tasks are incomplete", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: sync_main -->\n");

    const exitCode = await runQueue("dry-run", {
      ...harness.config,
      activeChangeDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      localClaimDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      tasksCompleteDetector: async () => false,
      remoteBranchDetector: async (_projectDir, branch) => branch === "feat/add-name-greeting",
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async (_projectDir, branch) =>
        branch === "feat/add-name-greeting" ? "https://github.com/example/project/pull/1" : undefined,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: implement");
    expect(queue).not.toContain("phase: sync_main");
    expect(queue).not.toContain("phase: archive");
  });

  test("prefers push when local completed work is not published despite stale merged PR evidence", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");

    const exitCode = await runQueue("dry-run", {
      ...harness.config,
      activeChangeDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      localClaimDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      localClaimPublishedDetector: async () => false,
      tasksCompleteDetector: async () => true,
      pushBranchAndOpenPullRequest: async () => "pushed and opened PR\n",
      remoteBranchDetector: async (_projectDir, branch) => branch === "feat/add-name-greeting",
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async (_projectDir, branch) =>
        branch === "feat/add-name-greeting" ? "https://github.com/example/project/pull/1" : undefined,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: push");
    expect(queue).not.toContain("phase: sync_main");
    expect(queue).not.toContain("phase: archive");
  });

  test("does not regress archive back to sync when the PR is already merged", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
    let remoteChecks = 0;

    const exitCode = await runQueue("dry-run", {
      ...harness.config,
      activeChangeDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      localClaimDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      localClaimPublishedDetector: async () => true,
      tasksCompleteDetector: async () => true,
      remoteBranchDetector: async () => {
        remoteChecks += 1;
        return true;
      },
      pullRequestDetector: async () => {
        remoteChecks += 1;
        return undefined;
      },
      mergedPullRequestDetector: async () => {
        remoteChecks += 1;
        return "https://github.com/example/project/pull/1";
      },
    });

    expect(exitCode).toBe(0);
    expect(remoteChecks).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: archive");
    expect(queue).not.toContain("phase: sync_main");
  });

  test("reconstructs push from a bare deliver task when only the remote branch exists", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");

    const exitCode = await runQueue("dry-run", {
      ...harness.config,
      activeChangeDetector: async () => false,
      tasksCompleteDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      pushBranchAndOpenPullRequest: async () => "pushed and opened PR\n",
      remoteBranchDetector: async (_projectDir, branch) => branch === "feat/add-name-greeting",
      pullRequestDetector: async () => undefined,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: push");
  });

  test("reconstructs ship from a bare deliver task when local implementation tasks are complete", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");

    const exitCode = await runQueue("dry-run", {
      ...harness.config,
      localClaimDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      tasksCompleteDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      pushBranchAndOpenPullRequest: async () => "pushed and opened PR\n",
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: push");
  });

  test("marks a bare deliver task done when archive exists and cleanup is complete", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");

    const exitCode = await runQueue("status", {
      ...harness.config,
      activeChangeDetector: async () => false,
      archivedChangeDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      localClaimDetector: async () => false,
      remoteBranchDetector: async () => false,
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async () => undefined,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [x] deliver add-name-greeting");
    expect(queue).toContain("![cleanup_worktree done](https://img.shields.io/badge/cleanup_worktree-done-brightgreen)");
  });

  test("reconstructs cleanup when archive exists and local claim remains", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");

    const exitCode = await runQueue("dry-run", {
      ...harness.config,
      activeChangeDetector: async () => false,
      archivedChangeDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      localClaimDetector: async (_projectDir, changeName) => changeName === "add-name-greeting",
      remoteBranchDetector: async () => false,
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async () => undefined,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: cleanup_worktree");
  });

  test("does not regress an explicit waiting-for-merge task when PR state is temporarily unavailable", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: waiting_for_merge -->\n");

    const exitCode = await runQueue("status", {
      ...harness.config,
      activeChangeDetector: async () => false,
      archivedChangeDetector: async () => false,
      localClaimDetector: async () => false,
      remoteBranchDetector: async () => false,
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async () => undefined,
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: waiting_for_merge");
    expect(queue).toContain("waits for its PR to merge");
    expect(queue).toContain(BLOCKED_TASK_RETRY_HINT);
  });

  test("blocks a bare deliver task when no evidence of the change exists", async () => {
    const harness = await createHarness("- [ ] deliver missing-change\n");

    const exitCode = await runQueue("status", {
      ...harness.config,
      activeChangeDetector: async () => false,
      archivedChangeDetector: async () => false,
      localClaimDetector: async () => false,
      remoteBranchDetector: async () => false,
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async () => undefined,
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver missing-change");
    expect(queue).toContain("was not found in active changes");
  });

  test("removes retry hints left below manually unblocked tasks", async () => {
    const harness = await createHarness(
      [
        "- [ ] deliver add-name-greeting <!-- phase: waiting_for_merge; blocked: 2026-07-13T15:41:00.829Z; reason: fixed now --> ![waiting_for_merge blocked](https://img.shields.io/badge/waiting_for_merge-blocked-red)",
        BLOCKED_TASK_RETRY_HINT,
        "",
      ].join("\n"),
    );

    const exitCode = await runQueue("status", {
      ...harness.config,
      pullRequestDetector: async () => undefined,
      mergedPullRequestDetector: async (_projectDir, branch) =>
        branch === "feat/add-name-greeting" ? "https://github.com/example/project/pull/1" : undefined,
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).not.toContain(BLOCKED_TASK_RETRY_HINT);
    expect(queue).toContain("- [ ] deliver add-name-greeting");
    expect(queue).toContain("phase: sync_main");
  });

  test("passes OpenCode log flags before the command", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
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
      "openspec-archive-merged",
      "add-name-greeting",
    ]);
  });

  test("passes OpenCode stats options to the executor when enabled", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
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
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => ({ exitCode: 1, output: "failed" }),
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("command exited with code 1");
  });

  test("marks the first pending task blocked when output contains an error signal", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => ({ exitCode: 0, output: "Unexpected server error" }),
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("unexpected server error");
  });

  test("blocks deliver archive phase when the worker reports a blocker", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => ({
        exitCode: 0,
        output: "## Blocked: `add-name-greeting` is not archive-ready\nNo merged PR found.",
      }),
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: archive");
    expect(queue).toContain("Worker reported a blocker");
    expect(queue).not.toContain("waiting_for_merge");
  });

  test("moves native push to waiting for merge after opening a pull request", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: push -->\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      ...implementedChangeEvidence("add-name-greeting"),
      pushBranchAndOpenPullRequest: async () => "pushed and opened PR\n",
    });

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("phase: waiting_for_merge");
    expect(queue).toContain("![waiting_for_merge blocked](https://img.shields.io/badge/waiting_for_merge-blocked-red)");
  });

  test("marks the first pending task blocked when the executor cannot start", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");

    const exitCode = await runQueue("next", {
      ...harness.config,
      executor: async () => {
        throw new Error("spawn failed");
      },
    });

    expect(exitCode).toBe(1);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("spawn failed");
  });

  test("blocks before execution when the project command file is missing", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n", { createCommandFiles: false });
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
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("OpenCode command file not found");
  });

  test("dry-runs native prepare without requiring an OpenCode command file", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n", { createCommandFiles: false });

    const exitCode = await runQueue("dry-run", harness.config);

    expect(exitCode).toBe(0);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver add-name-greeting");
    expect(queue).not.toContain("OpenCode command file not found");
  });

  test("blocks Codex execution before spending tokens when prompts are missing", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: implement -->\n", { createCommandFiles: false });
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      providerId: "codex-cli",
      codexBin: "codex",
      localClaimDetector: async () => true,
      tasksCompleteDetector: async () => false,
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("Codex workflow file not found");
  });

  test("runs Codex with installed phase prompts", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: implement -->\n", { createCommandFiles: false });
    await installCodexTemplates({ rootDir: join(import.meta.dir, ".."), projectDir: harness.rootDir });
    let receivedCommand = "";
    let receivedArgs: string[] = [];

    const exitCode = await runQueue("next", {
      ...harness.config,
      providerId: "codex-cli",
      codexBin: "codex",
      codexModel: "gpt-5.4",
      localClaimDetector: async () => true,
      tasksCompleteDetector: async () => false,
      executor: async (command, args) => {
        receivedCommand = command;
        receivedArgs = args;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(receivedCommand).toBe("codex");
    expect(receivedArgs.slice(0, 8)).toEqual([
      "exec",
      "-C",
      harness.rootDir,
      "--sandbox",
      "workspace-write",
      "-c",
      'approval_policy="never"',
      "--model",
    ]);
    expect(receivedArgs).toContain("gpt-5.4");
    expect(receivedArgs.at(-1)).toContain("OpenSpec Shipper Codex Phase: implement");
    expect(receivedArgs.at(-1)).toContain("add-name-greeting");
  });

  test("blocks ship before execution when git remote origin is missing", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: push -->\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      ...implementedChangeEvidence("add-name-greeting"),
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
    expect(queue).toContain("Git remote origin is not configured");
  });

  test("blocks deliver push phase before waiting for merge when git remote origin is missing", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: push -->\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      ...implementedChangeEvidence("add-name-greeting"),
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
    expect(queue).toContain("phase: push");
    expect(queue).toContain("Git remote origin is not configured");
    expect(queue).not.toContain("waiting_for_merge");
  });

  test("blocks prepare before execution when main is dirty and no claim exists", async () => {
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
    expect(queue).toContain("phase: prepare_worktree");
    expect(queue).toContain("no existing worktree or branch for add-name-greeting");
  });

  test("detects synchronizable main without mutating when it is behind origin", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "shipper-main-sync-"));
    const originDir = join(rootDir, "origin.git");
    const seedDir = join(rootDir, "seed");
    const cloneDir = join(rootDir, "clone");

    git(rootDir, ["init", "--bare", originDir]);
    await mkdir(seedDir, { recursive: true });
    git(seedDir, ["init", "-b", "main"]);
    git(seedDir, ["config", "user.name", "Test User"]);
    git(seedDir, ["config", "user.email", "test@example.com"]);
    await writeFile(join(seedDir, "README.md"), "one\n");
    git(seedDir, ["add", "README.md"]);
    git(seedDir, ["commit", "-m", "chore: initial"]);
    git(seedDir, ["remote", "add", "origin", originDir]);
    git(seedDir, ["push", "-u", "origin", "main"]);

    git(rootDir, ["clone", originDir, cloneDir]);
    const before = git(cloneDir, ["rev-parse", "HEAD"]).trim();

    await writeFile(join(seedDir, "README.md"), "two\n");
    git(seedDir, ["add", "README.md"]);
    git(seedDir, ["commit", "-m", "chore: update"]);
    git(seedDir, ["push"]);

    const status = await detectMainSyncStatus(cloneDir);

    expect(status).toEqual({ ok: true });
    expect(git(cloneDir, ["rev-parse", "HEAD"]).trim()).toBe(before);
  });

  test("dry-run prepare does not push local main commits", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "shipper-dry-run-no-push-"));
    const originDir = join(rootDir, "origin.git");
    const seedDir = join(rootDir, "seed");
    const cloneDir = join(rootDir, "clone");

    git(rootDir, ["init", "--bare", originDir]);
    await mkdir(seedDir, { recursive: true });
    git(seedDir, ["init", "-b", "main"]);
    git(seedDir, ["config", "user.name", "Test User"]);
    git(seedDir, ["config", "user.email", "test@example.com"]);
    await writeFile(join(seedDir, "README.md"), "one\n");
    git(seedDir, ["add", "README.md"]);
    git(seedDir, ["commit", "-m", "chore: initial"]);
    git(seedDir, ["remote", "add", "origin", originDir]);
    git(seedDir, ["push", "-u", "origin", "main"]);

    git(rootDir, ["clone", originDir, cloneDir]);
    git(cloneDir, ["config", "user.name", "Test User"]);
    git(cloneDir, ["config", "user.email", "test@example.com"]);
    await writeFile(join(cloneDir, ".gitignore"), ".openspec-shipper/queue.md\n");
    await mkdir(join(cloneDir, "openspec/changes/add-name-greeting/specs/hello-cli"), { recursive: true });
    await writeFile(join(cloneDir, "openspec/changes/add-name-greeting/proposal.md"), "proposal\n");
    await writeFile(join(cloneDir, "openspec/changes/add-name-greeting/design.md"), "design\n");
    await writeFile(join(cloneDir, "openspec/changes/add-name-greeting/tasks.md"), "- [ ] implement\n");
    await writeFile(join(cloneDir, "openspec/changes/add-name-greeting/specs/hello-cli/spec.md"), "spec\n");
    git(cloneDir, ["add", ".gitignore", "openspec"]);
    git(cloneDir, ["commit", "-m", "chore: local proposal"]);

    const queuePath = join(cloneDir, ".openspec-shipper/queue.md");
    await mkdir(join(cloneDir, ".openspec-shipper"), { recursive: true });
    await writeFile(queuePath, "- [ ] deliver add-name-greeting\n");
    const localHead = git(cloneDir, ["rev-parse", "HEAD"]).trim();
    const originBefore = git(cloneDir, ["rev-parse", "origin/main"]).trim();

    const exitCode = await runQueue("dry-run", {
      rootDir: cloneDir,
      projectDir: cloneDir,
      queuePath,
      stateDir: join(cloneDir, ".openspec-shipper"),
      opencodeBin: "mock-opencode",
      opencodeStatsIntervalMs: 120_000,
      opencodeStatsTimeoutMs: 10_000,
      opencodeStatsProject: "",
      loopDelayMs: 0,
      busyDelayMs: 0,
      taskTimeoutMs: 1_000,
      heartbeatMs: 0,
      maxBlockedTasks: 0,
    });

    expect(exitCode).toBe(0);
    expect(git(cloneDir, ["rev-parse", "HEAD"]).trim()).toBe(localHead);
    expect(git(cloneDir, ["rev-parse", "origin/main"]).trim()).toBe(originBefore);
    expect(git(originDir, ["rev-parse", "main"]).trim()).toBe(originBefore);
  });

  test("synchronizes main by pushing local commits when no upstream is configured", async () => {
    const rootDir = await mkdtemp(join(tmpdir(), "shipper-main-no-upstream-"));
    const originDir = join(rootDir, "origin.git");
    const seedDir = join(rootDir, "seed");
    const cloneDir = join(rootDir, "clone");

    git(rootDir, ["init", "--bare", originDir]);
    await mkdir(seedDir, { recursive: true });
    git(seedDir, ["init", "-b", "main"]);
    git(seedDir, ["config", "user.name", "Test User"]);
    git(seedDir, ["config", "user.email", "test@example.com"]);
    await writeFile(join(seedDir, "README.md"), "one\n");
    git(seedDir, ["add", "README.md"]);
    git(seedDir, ["commit", "-m", "chore: initial"]);
    git(seedDir, ["remote", "add", "origin", originDir]);
    git(seedDir, ["push", "-u", "origin", "main"]);

    git(rootDir, ["clone", originDir, cloneDir]);
    git(cloneDir, ["branch", "--unset-upstream", "main"]);
    git(cloneDir, ["config", "user.name", "Test User"]);
    git(cloneDir, ["config", "user.email", "test@example.com"]);
    await writeFile(join(cloneDir, "local.txt"), "local\n");
    git(cloneDir, ["add", "local.txt"]);
    git(cloneDir, ["commit", "-m", "chore: local"]);

    const output = await synchronizeBaseBranchWithOrigin(cloneDir, "main");

    expect(output).toContain("main");
    expect(git(cloneDir, ["rev-parse", "HEAD"]).trim()).toBe(git(cloneDir, ["rev-parse", "origin/main"]).trim());
  });

  test("blocks prepare when main cannot be safely synchronized with origin", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    let prepareCalled = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      mainSyncDetector: async () => ({ ok: false, reason: "Main has diverged from origin/main; reconcile main before preparing a new worktree." }),
      prepareWorkspace: async () => {
        prepareCalled = true;
        return "prepared\n";
      },
    });

    expect(exitCode).toBe(1);
    expect(prepareCalled).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("Main has diverged from origin/main");
  });

  test("ignores shipper runtime files when checking dirty main", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    let executorCalled = false;
    let prepareCalled = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      gitStatusDetector: async () => ["?? .openspec-shipper/shipper.lock"],
      executor: async () => {
        executorCalled = true;
        return { exitCode: 0, output: "done" };
      },
      prepareWorkspace: async () => {
        prepareCalled = true;
        return "prepared\n";
      },
    });

    expect(exitCode).toBe(0);
    expect(executorCalled).toBe(false);
    expect(prepareCalled).toBe(true);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: implement");
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
    expect(queue).toContain("phase: push");
  });

  test("allows prepare phase with unsynced main when the change worktree already exists", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting\n");
    await mkdir(join(harness.rootDir, "worktrees/add-name-greeting"), { recursive: true });
    let prepareCalled = false;
    let executorCalled = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      mainSyncDetector: async () => ({ ok: false, reason: "Main is behind origin/main" }),
      executor: async () => {
        executorCalled = true;
        return { exitCode: 0, output: "done" };
      },
      prepareWorkspace: async () => {
        prepareCalled = true;
        return "already prepared\n";
      },
    });

    expect(exitCode).toBe(0);
    expect(prepareCalled).toBe(false);
    expect(executorCalled).toBe(true);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: push");
  });

  test("next mode marks the task as checking before detecting active opencode", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      activeExecutorAllowance: 0,
      processDetector: async () => ["12345"],
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(1);
    expect(called).toBe(false);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver add-name-greeting <!-- phase: archive; checking: 2026-06-17T12:00:00.000Z -->");
    expect(queue).toContain("![archive checking](https://img.shields.io/badge/archive-checking-yellow)");
  });

  test("next mode allows up to two active executor processes by default", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
    let called = false;

    const exitCode = await runQueue("next", {
      ...harness.config,
      processDetector: async () => ["12345", "67890"],
      executor: async () => {
        called = true;
        return { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(called).toBe(true);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("phase: cleanup_worktree");
  });

  test("run mode processes pending tasks until the queue is complete", async () => {
    const harness = await createHarness(
      [
        "- [ ] deliver add-name-greeting <!-- phase: cleanup_worktree -->",
        "- [ ] deliver add-spanish-greeting <!-- phase: cleanup_worktree -->",
      ].join("\n"),
    );
    const calls: string[] = [];
    const sleeps: number[] = [];

    const exitCode = await runQueue("run", {
      ...harness.config,
      cleanupWorkspace: async (input) => {
        calls.push(input.changeName);
        return "cleaned\n";
      },
      sleep: async (ms) => {
        sleeps.push(ms);
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toHaveLength(2);
    expect(sleeps).toEqual([]);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [x] deliver add-name-greeting");
    expect(queue).toContain("- [x] deliver add-spanish-greeting");
  });

  test("run mode continues after the first blocked task by default", async () => {
    const harness = await createHarness(
      [
        "- [ ] deliver add-name-greeting <!-- phase: archive -->",
        "- [ ] deliver add-spanish-greeting <!-- phase: archive -->",
      ].join("\n"),
    );
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
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("- [!] deliver add-spanish-greeting");
  });

  test("run mode continues after blocked tasks within the configured limit", async () => {
    const harness = await createHarness(
      [
        "- [ ] deliver add-name-greeting <!-- phase: archive -->",
        "- [ ] deliver add-spanish-greeting <!-- phase: archive -->",
      ].join("\n"),
    );
    let calls = 0;

    const exitCode = await runQueue("run", {
      ...harness.config,
      maxBlockedTasks: 1,
      cleanupWorkspace: async () => "cleaned\n",
      executor: async () => {
        calls += 1;
        return calls === 1 ? { exitCode: 1, output: "failed" } : { exitCode: 0, output: "done" };
      },
    });

    expect(exitCode).toBe(0);
    expect(calls).toBe(2);
    const queue = await readFile(harness.queuePath, "utf8");
    expect(queue).toContain("- [!] deliver add-name-greeting");
    expect(queue).toContain("- [x] deliver add-spanish-greeting");
  });

  test("run mode waits instead of blocking when opencode is already active", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
    const sleeps: number[] = [];
    let checks = 0;
    let calls = 0;

    const exitCode = await runQueue("run", {
      ...harness.config,
      busyDelayMs: 5,
      activeExecutorAllowance: 0,
      processDetector: async () => {
        checks += 1;
        return checks === 1 ? ["12345"] : [];
      },
      cleanupWorkspace: async () => "cleaned\n",
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
    expect(queue).toContain("- [x] deliver add-name-greeting");
  });

  test("stop mode requests a safe queue stop", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: sync_main -->\n");

    const exitCode = await runQueue("stop", harness.config);

    expect(exitCode).toBe(0);
    const stop = await readFile(join(harness.config.stateDir, "stop"), "utf8");
    expect(stop).toContain("Stop queue:run at the next safe checkpoint");
  });

  test("run mode exits while waiting when stop is requested", async () => {
    const harness = await createHarness("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
    const sleeps: number[] = [];
    let called = false;

    const exitCode = await runQueue("run", {
      ...harness.config,
      busyDelayMs: 60_000,
      activeExecutorAllowance: 0,
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
    expect(queue).toContain("- [ ] deliver add-name-greeting <!-- phase: archive; checking: 2026-06-17T12:00:00.000Z -->");
    expect(queue).toContain("![archive checking](https://img.shields.io/badge/archive-checking-yellow)");
  });
});

const cleanExecutor: Executor = async () => ({ exitCode: 0, output: "done" });

function git(cwd: string, args: string[]): string {
  const result = spawnSync("git", args, { cwd, encoding: "utf8" });
  if (result.status !== 0) {
    throw new Error(result.stderr || result.stdout || `git ${args.join(" ")} failed`);
  }

  return result.stdout;
}

function implementedChangeEvidence(changeName: string): Partial<RunnerConfig> {
  return {
    localClaimDetector: async (_projectDir, candidate) => candidate === changeName,
    tasksCompleteDetector: async (_projectDir, candidate) => candidate === changeName,
  };
}

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
    mainSyncDetector: async () => ({ ok: true }),
    syncBaseBranch: async (_projectDir, baseBranch) => `synced ${baseBranch}\n`,
    activeChangeDetector: async () => true,
    pullRequestDetector: async () => undefined,
    prepareWorkspace: async (input) => `prepared ${input.changeName} at ${input.worktreeDir}\n`,
    finalizeArchive: async (input) => `finalized archive for ${input.changeName} on ${input.baseBranch}\n`,
    now: () => new Date("2026-06-17T12:00:00.000Z"),
  };

  return { rootDir, queuePath, config };
}
