#!/usr/bin/env node
import { spawnSync } from "node:child_process";

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

function ensureNpmLogin() {
  const whoami = capture("npm", ["whoami"]);
  if (whoami.status === 0) {
    console.log(`npm logged in as ${whoami.stdout.trim()}`);
    return;
  }

  console.log("npm login required.");
  run("npm", ["login"]);
}

ensureCleanGitTree();
ensureNpmLogin();
run("npm", ["run", "typecheck"]);
run("bun", ["test"]);
run("npm", ["run", "prepack"]);
if (!releaseCurrentVersion) {
  run("npm", ["version", "patch"]);
}
run("npm", ["pack", "--dry-run"]);
run("npm", ["publish", "--access", "public"]);

const version = capture("npm", ["view", "openspec-shipper", "version"]);
if (version.status === 0) {
  console.log(`\nPublished openspec-shipper@${version.stdout.trim()}`);
}
