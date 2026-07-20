import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import { queueAdd } from "../src/application/queue/queue-add";
import type { RunnerConfig } from "../src/runner";
import { silenceConsoleDuringTests } from "./test-console";

silenceConsoleDuringTests();

describe("queue add", () => {
  test("creates a queue and avoids duplicate changes", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipper-queue-"));
    const config = testConfig(join(dir, ".openspec-shipper/queue.md"));

    expect(await queueAdd(config, ["add-name-greeting"])).toBe(0);
    expect(await queueAdd(config, ["add-name-greeting"])).toBe(0);

    const queue = await readFile(config.queuePath, "utf8");
    expect(queue.match(/add-name-greeting/g)).toHaveLength(1);
  });

  test("adds dependencies as queue metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipper-queue-"));
    const config = testConfig(join(dir, ".openspec-shipper/queue.md"));

    expect(await queueAdd(config, ["add-spanish-greeting", "--depends-on", "add-name-greeting"])).toBe(0);

    const queue = await readFile(config.queuePath, "utf8");
    expect(queue).toContain("- [ ] deliver add-spanish-greeting <!-- depends_on: add-name-greeting -->");
  });

  test("adds an explicit planning branch and archive ordering metadata", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipper-queue-"));
    const config = testConfig(join(dir, ".openspec-shipper/queue.md"));

    expect(await queueAdd(config, [
      "add-shouting-greeting",
      "--source-branch",
      "spec/add-shouting-greeting",
      "--archive-after",
      "add-name-greeting,add-spanish-greeting",
    ])).toBe(0);

    const queue = await readFile(config.queuePath, "utf8");
    expect(queue).toContain(
      "<!-- source_branch: spec/add-shouting-greeting; archive_after: add-name-greeting,add-spanish-greeting -->",
    );
  });

  test("rejects malformed queue add flags", async () => {
    const dir = await mkdtemp(join(tmpdir(), "shipper-queue-"));
    const config = testConfig(join(dir, ".openspec-shipper/queue.md"));

    expect(await queueAdd(config, ["add-name-greeting", "--source-branch"])).toBe(2);
    expect(await queueAdd(config, ["add-name-greeting", "--unexpected"])).toBe(2);
  });
});

function testConfig(queuePath: string): RunnerConfig {
  return {
    rootDir: join(queuePath, ".."),
    projectDir: join(queuePath, ".."),
    queuePath,
    stateDir: join(queuePath, "..", "runs"),
    opencodeBin: "opencode",
    opencodeStatsIntervalMs: 120_000,
    opencodeStatsTimeoutMs: 10_000,
    opencodeStatsProject: "",
    loopDelayMs: 0,
    busyDelayMs: 0,
    taskTimeoutMs: 1_000,
    heartbeatMs: 0,
    maxBlockedTasks: 0,
  };
}
