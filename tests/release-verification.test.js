import { describe, expect, test } from "bun:test";
import { verifyPublishedVersion } from "../scripts/release-verification.mjs";

describe("release verification", () => {
  test("retries registry propagation with capped exponential backoff", async () => {
    const calls = [];
    const delays = [];
    const retries = [];
    const results = [
      failed("npm error code E404"),
      failed("npm error code E404"),
      passed("1.0.13\n"),
    ];

    const verification = await verifyPublishedVersion({
      capture(command, args) {
        calls.push([command, args]);
        return results.shift();
      },
      packageName: "openspec-shipper",
      expectedVersion: "1.0.13",
      registry: "https://registry.npmjs.org/",
      attempts: 5,
      initialDelayMs: 2_000,
      maxDelayMs: 3_000,
      sleep: async (ms) => delays.push(ms),
      onRetry: (event) => retries.push(event),
    });

    expect(verification).toEqual({ ok: true, version: "1.0.13", attempts: 3 });
    expect(delays).toEqual([2_000, 3_000]);
    expect(retries.map((event) => event.detail)).toEqual(["npm error code E404", "npm error code E404"]);
    expect(calls[0]).toEqual(["npm", [
      "view",
      "openspec-shipper@1.0.13",
      "version",
      "--prefer-online",
      "--registry",
      "https://registry.npmjs.org/",
    ]]);
  });

  test("returns the final npm diagnostic after exhausting attempts", async () => {
    const verification = await verifyPublishedVersion({
      capture: () => failed("npm error code E503"),
      packageName: "openspec-shipper",
      expectedVersion: "1.0.14",
      registry: "https://registry.npmjs.org/",
      attempts: 3,
      initialDelayMs: 1,
      maxDelayMs: 1,
      sleep: async () => {},
    });

    expect(verification).toEqual({
      ok: false,
      attempts: 3,
      detail: "npm error code E503",
      status: 1,
      registryVersion: "",
    });
  });

  test("retries an unexpected registry version instead of exiting successfully", async () => {
    const results = [passed("1.0.12\n"), passed("1.0.13\n")];

    const verification = await verifyPublishedVersion({
      capture: () => results.shift(),
      packageName: "openspec-shipper",
      expectedVersion: "1.0.13",
      registry: "https://registry.npmjs.org/",
      attempts: 2,
      initialDelayMs: 1,
      sleep: async () => {},
    });

    expect(verification).toEqual({ ok: true, version: "1.0.13", attempts: 2 });
  });
});

function passed(stdout) {
  return { status: 0, stdout, stderr: "" };
}

function failed(stderr) {
  return { status: 1, stdout: "", stderr };
}
