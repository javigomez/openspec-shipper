import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { loadShipperEnv } from "../src/infrastructure/env/load-shipper-env";

const touchedKeys = [
  "OPENSPEC_SHIPPER_PROJECT_DIR",
  "OPENSPEC_SHIPPER_QUEUE_PATH",
  "OPENSPEC_SHIPPER_PROVIDER",
  "APP_SECRET",
];

afterEach(() => {
  for (const key of touchedKeys) {
    delete process.env[key];
  }
});

describe("shipper env loading", () => {
  test("loads only .openspec-shipper/.env and ignores the app .env", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "shipper-env-"));
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await writeFile(join(projectDir, ".env"), "APP_SECRET=from-app\nOPENSPEC_SHIPPER_PROVIDER=bad\n");
    await writeFile(join(projectDir, ".openspec-shipper/.env"), "OPENSPEC_SHIPPER_PROVIDER=opencode\n");

    await loadShipperEnv({ projectDir });

    expect(process.env.OPENSPEC_SHIPPER_PROVIDER).toBe("opencode");
    expect(process.env.APP_SECRET).toBeUndefined();
  });

  test("real environment wins over .openspec-shipper/.env and flags win over both", async () => {
    const projectDir = await mkdtemp(join(tmpdir(), "shipper-env-"));
    await mkdir(join(projectDir, ".openspec-shipper"), { recursive: true });
    await writeFile(join(projectDir, ".openspec-shipper/.env"), "OPENSPEC_SHIPPER_PROVIDER=opencode\n");
    process.env.OPENSPEC_SHIPPER_PROVIDER = "codex-cli";

    await loadShipperEnv({ projectDir, provider: "opencode" });

    expect(process.env.OPENSPEC_SHIPPER_PROVIDER).toBe("opencode");
  });
});
