import { spawnSync } from "node:child_process";

const changeName = process.argv[2];

if (!changeName) {
  console.error("Usage: npm run openspec:validate-proposal -- <change-name>");
  process.exit(2);
}

const result = spawnSync("openspec", ["validate", changeName], {
  stdio: "inherit",
  env: {
    ...process.env,
    OPENSPEC_TELEMETRY: "0",
    DO_NOT_TRACK: "1",
  },
});

process.exit(result.status ?? 1);
