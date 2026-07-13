import { describe, expect, test } from "bun:test";
import {
  advanceDeliverTask,
  BLOCKED_TASK_RETRY_HINT,
  buildOpenCodeArgs,
  detectFailureSignal,
  deliverPhase,
  findBlockedTasks,
  findFirstRunnableTask,
  findWaitingTasks,
  markTask,
  markTaskChecking,
  markTaskRunning,
  normalizeChangeName,
  openCodeCommandName,
  parseQueue,
  removeRetryHintsForUnblockedTasks,
} from "../src/queue";

describe("queue parser", () => {
  test("reads pending, done, and blocked tasks", () => {
    const result = parseQueue(
      [
        "- [ ] apply openspec/changes/test-18-migrate-cover-background-rntl",
        "- [x] ship",
        "- [!] archive <!-- blocked: earlier -->",
      ].join("\n"),
    );

    expect(result.errors).toEqual([]);
    expect(result.tasks.map((task) => task.status)).toEqual(["pending", "done", "blocked"]);
    expect(findFirstRunnableTask(result.tasks)?.rawCommand).toBe(
      "apply openspec/changes/test-18-migrate-cover-background-rntl",
    );
    expect(findBlockedTasks(result.tasks)).toHaveLength(1);
  });

  test("rejects unknown commands and typos", () => {
    const result = parseQueue("- [ ] opencode run /openspec-apply-wortree test-18\n");

    expect(result.tasks).toEqual([]);
    expect(result.errors[0]).toContain("unknown task action `opencode`");
  });

  test("normalizes OpenSpec change names", () => {
    expect(normalizeChangeName("openspec/changes/test-18-migrate-cover-background-rntl/")).toBe(
      "test-18-migrate-cover-background-rntl",
    );
    expect(normalizeChangeName("test-19-migrate-back-to-console-button-rntl")).toBe(
      "test-19-migrate-back-to-console-button-rntl",
    );
    expect(normalizeChangeName("../bad")).toBeUndefined();
  });

  test("builds opencode arguments for a targeted apply", () => {
    const result = parseQueue("- [ ] apply test-18-migrate-cover-background-rntl\n");
    const task = result.tasks[0]!;

    expect(openCodeCommandName(task)).toBe("openspec-apply-worktree");
    expect(openCodeCommandName(task).startsWith("/")).toBe(false);
    expect(buildOpenCodeArgs(task)).toEqual([
      "run",
      "--command",
      "openspec-apply-worktree",
      "test-18-migrate-cover-background-rntl",
    ]);
  });

  test("parses deliver tasks with phase and dependencies", () => {
    const result = parseQueue(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: ship; depends_on: test-08-add-rntl-test-infra -->\n",
    );
    const task = result.tasks[0]!;

    expect(result.errors).toEqual([]);
    expect(task.action).toBe("deliver");
    expect(task.change).toBe("test-20-migrate-notebook-access-button-rntl");
    expect(deliverPhase(task)).toBe("ship");
    expect(task.dependsOn).toEqual(["test-08-add-rntl-test-infra"]);
    expect(openCodeCommandName(task)).toBe("openspec-ship-worktree");
    expect(buildOpenCodeArgs(task)).toEqual([
      "run",
      "--command",
      "openspec-ship-worktree",
      "test-20-migrate-notebook-access-button-rntl",
    ]);
  });

  test("advances deliver phases before marking done", () => {
    const result = parseQueue("- [ ] deliver test-20-migrate-notebook-access-button-rntl\n");
    const task = result.tasks[0]!;

    const next = advanceDeliverTask(result.lines, task, {
      timestamp: "2026-06-25T12:00:00.000Z",
      checkedAt: "2026-06-25T11:59:58.000Z",
      startedAt: "2026-06-25T12:00:00.000Z",
      logPath: ".openspec-shipper/runs/apply.log",
    });

    expect(next).toContain(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: ship; advanced: 2026-06-25T12:00:00.000Z; checked: 2026-06-25T11:59:58.000Z; started: 2026-06-25T12:00:00.000Z; log: .openspec-shipper/runs/apply.log -->",
    );
    expect(next).toContain(
      "![ship ready](https://img.shields.io/badge/ship-ready-blue) · _([log](.openspec-shipper/runs/apply.log))_",
    );
  });

  test("advances ship to waiting for PR when PR creation is external", () => {
    const result = parseQueue("- [ ] deliver add-name-greeting <!-- phase: ship -->\n");
    const task = result.tasks[0]!;

    const next = advanceDeliverTask(result.lines, task, {
      timestamp: "2026-07-13T08:21:00.000Z",
    });

    expect(next).toContain("phase: waiting_for_pr");
    expect(next).toContain("![waiting_for_pr waiting](https://img.shields.io/badge/waiting_for_pr-waiting-orange)");
    const parsed = parseQueue(next).tasks[0]!;
    expect(deliverPhase(parsed)).toBe("waiting_for_pr");
    expect(findFirstRunnableTask([parsed])).toBeUndefined();
  });

  test("advances archive to cleanup before marking deliver done", () => {
    const result = parseQueue("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
    const task = result.tasks[0]!;

    const next = advanceDeliverTask(result.lines, task, {
      timestamp: "2026-07-13T12:00:00.000Z",
    });

    expect(next).toContain("phase: cleanup");
    expect(next).toContain("![cleanup ready](https://img.shields.io/badge/cleanup-ready-blue)");
    const parsed = parseQueue(next).tasks[0]!;
    expect(deliverPhase(parsed)).toBe("cleanup");
  });

  test("marks deliver done after cleanup", () => {
    const result = parseQueue("- [ ] deliver add-name-greeting <!-- phase: cleanup -->\n");
    const task = result.tasks[0]!;

    const next = advanceDeliverTask(result.lines, task, {
      timestamp: "2026-07-13T12:00:00.000Z",
    });

    expect(next).toContain("- [x] deliver add-name-greeting");
    expect(next).toContain("![cleanup done](https://img.shields.io/badge/cleanup-done-brightgreen)");
  });

  test("marks a deliver task as running without changing its queue status", () => {
    const result = parseQueue("- [ ] deliver add-name-greeting\n");
    const task = result.tasks[0]!;

    const next = markTaskRunning(result.lines, task, {
      timestamp: "2026-07-09T16:22:20.003Z",
      logPath: ".openspec-shipper/runs/apply.log",
    });

    expect(next).toContain(
      "- [ ] deliver add-name-greeting <!-- phase: apply; running: 2026-07-09T16:22:20.003Z; log: .openspec-shipper/runs/apply.log -->",
    );
    expect(next).toContain(
      "![apply running](https://img.shields.io/badge/apply-running-yellow) · _([log](.openspec-shipper/runs/apply.log))_",
    );
    const parsed = parseQueue(next).tasks[0]!;
    expect(parsed.status).toBe("pending");
    expect(deliverPhase(parsed)).toBe("apply");
  });

  test("marks a deliver task as checking without changing its queue status", () => {
    const result = parseQueue("- [ ] deliver add-name-greeting\n");
    const task = result.tasks[0]!;

    const next = markTaskChecking(result.lines, task, {
      timestamp: "2026-07-10T08:15:00.000Z",
    });

    expect(next).toContain(
      "- [ ] deliver add-name-greeting <!-- phase: apply; checking: 2026-07-10T08:15:00.000Z -->",
    );
    expect(next).toContain(
      "![apply checking](https://img.shields.io/badge/apply-checking-yellow)",
    );
    const parsed = parseQueue(next).tasks[0]!;
    expect(parsed.status).toBe("pending");
    expect(deliverPhase(parsed)).toBe("apply");
  });

  test("adds a human retry hint when a task is blocked", () => {
    const result = parseQueue("- [ ] deliver add-name-greeting <!-- phase: archive -->\n");
    const task = result.tasks[0]!;

    const next = markTask(result.lines, task, "blocked", {
      timestamp: "2026-07-13T15:41:00.829Z",
      reason: "OpenSpec archive worker reported a blocker",
      logPath: "runs/archive.log",
    });

    expect(next).toContain("- [!] deliver add-name-greeting");
    expect(next).toContain("![archive blocked](https://img.shields.io/badge/archive-blocked-red)");
    expect(next).toContain(BLOCKED_TASK_RETRY_HINT);
  });

  test("removes a stale retry hint when the human changes blocked to pending", () => {
    const content = [
      "- [ ] deliver add-name-greeting <!-- phase: archive; blocked: 2026-07-13T15:41:00.829Z; reason: fixed now --> ![archive blocked](https://img.shields.io/badge/archive-blocked-red)",
      BLOCKED_TASK_RETRY_HINT,
      "- [ ] deliver add-spanish-greeting <!-- depends_on: add-name-greeting -->",
      "",
    ].join("\n");

    const next = removeRetryHintsForUnblockedTasks(content);

    expect(next).not.toContain(BLOCKED_TASK_RETRY_HINT);
    expect(next).toContain("- [ ] deliver add-name-greeting");
    expect(next).toContain("- [ ] deliver add-spanish-greeting");
  });

  test("finds the first runnable task after waiting dependencies", () => {
    const result = parseQueue(
      [
        "- [ ] deliver change-b <!-- depends_on: change-a -->",
        "- [ ] deliver change-c",
      ].join("\n"),
    );

    expect(findWaitingTasks(result.tasks).map((task) => task.change)).toEqual(["change-b"]);
    expect(findFirstRunnableTask(result.tasks)?.change).toBe("change-c");
  });

  test("ignores visual badges and log links when parsing commands", () => {
    const result = parseQueue(
      "- [x] deliver test-10-migrate-tap-zone-layer-rntl <!-- done: 2026-06-25T19:22:32.954Z; log: .openspec-shipper/runs/deliver.log --> ![task done](https://img.shields.io/badge/task-done-brightgreen) · _([log](.openspec-shipper/runs/deliver.log))_\n",
    );
    const task = result.tasks[0]!;

    expect(result.errors).toEqual([]);
    expect(task.rawCommand).toBe("deliver test-10-migrate-tap-zone-layer-rntl");
    expect(task.status).toBe("done");
  });
});

describe("failure detection", () => {
  test("detects noisy success exits that should block the queue", () => {
    expect(detectFailureSignal("Error: UnknownError")).toBe("OpenCode returned UnknownError");
    expect(detectFailureSignal("permission requested: external_directory; auto-rejecting")).toBe(
      "OpenCode auto-rejected a permission request",
    );
    expect(detectFailureSignal("zsh:1: command not found: openspec")).toBe(
      "OpenSpec CLI was not available",
    );
    expect(detectFailureSignal("stream error: AI_APICallError: <none>")).toBe(
      "OpenCode stream failed with AI_APICallError",
    );
    expect(detectFailureSignal("## 🛑 Archive blocked — change not eligible")).toBe(
      "OpenSpec archive worker reported a blocker",
    );
    expect(detectFailureSignal("The target change is not archive-ready.")).toBe(
      "OpenSpec archive worker reported a blocker",
    );
    expect(detectFailureSignal("all good")).toBeUndefined();
  });

  test("does not treat generic blocked wording as a blocker", () => {
    expect(detectFailureSignal("Direct commits on main are blocked in this repo.")).toBeUndefined();
  });
});
