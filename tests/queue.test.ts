import { describe, expect, test } from "bun:test";
import {
  advanceDeliverTask,
  buildOpenCodeArgs,
  detectFailureSignal,
  deliverPhase,
  findBlockedTasks,
  findFirstRunnableTask,
  findWaitingTasks,
  normalizeChangeName,
  openCodeCommandName,
  parseQueue,
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
      logPath: ".orchester/runs/apply.log",
    });

    expect(next).toContain(
      "- [ ] deliver test-20-migrate-notebook-access-button-rntl <!-- phase: ship; advanced: 2026-06-25T12:00:00.000Z; log: .orchester/runs/apply.log -->",
    );
    expect(next).toContain(
      "![ship](https://img.shields.io/badge/ship-pending-blue) · _([log](.orchester/runs/apply.log))_",
    );
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
      "- [x] deliver test-10-migrate-tap-zone-layer-rntl <!-- done: 2026-06-25T19:22:32.954Z; log: .orchester/runs/deliver.log --> ![done](https://img.shields.io/badge/done-success-brightgreen) · _([log](.orchester/runs/deliver.log))_\n",
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
