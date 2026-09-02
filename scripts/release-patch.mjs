#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { verifyPublishedVersion } from "./release-verification.mjs";

const npmCache = process.env.npm_config_cache ?? process.env.NPM_CONFIG_CACHE ?? "/private/tmp/openspec-shipper-npm-cache";
const env = {
  ...process.env,
  npm_config_cache: npmCache,
  NPM_CONFIG_CACHE: npmCache,
};
const releaseCurrentVersion = process.argv[2] === "current";

function run(command, args, options = {}) {
  console.log(`\n$ ${[command, ...args].join(" ")}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    env,
    ...options,
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

function capture(command, args) {
  return spawnSync(command, args, {
    encoding: "utf8",
    env,
  });
}

function ensureCleanGitTree() {
  const result = capture("git", ["status", "--porcelain"]);
  if (result.status !== 0) {
    process.stderr.write(result.stderr);
    process.exit(result.status ?? 1);
  }

  if (result.stdout.trim()) {
    console.error("Release aborted: commit or stash local changes before running release-patch.");
    console.error(result.stdout);
    process.exit(1);
  }
}

function ensureNpmLogin(registry) {
  const whoami = capture("npm", ["whoami", "--registry", registry]);
  if (whoami.status === 0) {
    console.log(`npm logged in as ${whoami.stdout.trim()}`);
    return;
  }

  console.log("npm login required.");
  run("npm", ["login", "--registry", registry]);
}

function configuredNpmRegistry() {
  const configured = capture("npm", ["config", "get", "registry"]);
  const registry = configured.stdout?.trim() ?? "";
  if (configured.status !== 0 || !registry) {
    process.stderr.write(configured.stderr);
    console.error("Release aborted: could not determine the configured npm registry.");
    process.exit(configured.status ?? 1);
  }
  return registry;
}

ensureCleanGitTree();
const npmRegistry = configuredNpmRegistry();
ensureNpmLogin(npmRegistry);
run("npm", ["run", "typecheck"]);
run("bun", ["test"]);
run("npm", ["run", "prepack"]);
if (!releaseCurrentVersion) {
  run("npm", ["version", "patch"]);
}
run("npm", ["pack", "--dry-run"]);
run("npm", ["publish", "--access", "public", "--registry", npmRegistry]);

const localVersion = capture("node", ["-p", "require('./package.json').version"]);
if (localVersion.status !== 0) {
  console.error("Release verification failed: could not read the local package version.");
  process.exit(localVersion.status ?? 1);
}

const expectedVersion = localVersion.stdout.trim();
const verification = await verifyPublishedVersion({
  capture,
  packageName: "openspec-shipper",
  expectedVersion,
  registry: npmRegistry,
  onRetry({ attempt, totalAttempts, delayMs, detail }) {
    console.warn(
      `Registry verification attempt ${attempt}/${totalAttempts} did not confirm openspec-shipper@${expectedVersion}: ${detail}. Retrying in ${delayMs / 1_000}s...`,
    );
  },
});
if (!verification.ok) {
  console.error(`Release verification remained inconclusive after ${verification.attempts} attempts for openspec-shipper@${expectedVersion}.`);
  console.error(`Last npm view result: ${verification.detail}.`);
  console.error("Do not rerun release-patch: it would increment the package version again.");
  console.error(`Check manually: npm view openspec-shipper@${expectedVersion} version --registry=${npmRegistry}`);
  console.error("If the version is still absent after the registry settles, resume the same version with: npm run release-current");
  process.exit(1);
}

console.log(`\nPublished openspec-shipper@${verification.version} (verified after ${verification.attempts} attempt${verification.attempts === 1 ? "" : "s"})`);
