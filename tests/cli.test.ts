import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { runCli } from "../src/infrastructure/cli.js";
import { silenceConsoleDuringTests } from "./test-console";

silenceConsoleDuringTests();

const envKeys = [
  "OPENSPEC_SHIPPER_PROJECT_DIR",
  "OPENSPEC_SHIPPER_QUEUE_PATH",
  "OPENSPEC_SHIPPER_PROVIDER",
  "PROJECT_DIR",
  "QUEUE_PATH",
];

const originalEnv = new Map(envKeys.map((key) => [key, process.env[key]]));

afterEach(() => {
  process.exitCode = undefined;
  for (const key of envKeys) {
    const value = originalEnv.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

describe("CLI parser", () => {
  beforeEach(() => {
    for (const key of envKeys) {
      delete process.env[key];
    }
  });

  test("supports queue add with global flags before the command", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "shipper-cli-"));
    const queuePath = join(projectDir, ".openspec-shipper/queue.md");
    try {
      await runCli(["--project", projectDir, "--queue", queuePath, "queue", "add", "add-name-greeting"]);

      expect(process.exitCode).toBe(0);
      await expect(readFile(queuePath, "utf8")).resolves.toContain(
        "- [ ] deliver add-name-greeting",
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });

  test("supports the top-level add alias", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "shipper-cli-"));
    const queuePath = join(projectDir, ".openspec-shipper/queue.md");
    try {
      await runCli(["add", "add-spanish-greeting", "--project", projectDir, "--queue", queuePath]);

      expect(process.exitCode).toBe(0);
      await expect(readFile(queuePath, "utf8")).resolves.toContain(
        "- [ ] deliver add-spanish-greeting",
      );
    } finally {
      await rm(projectDir, { recursive: true, force: true });
    }
  });
});
