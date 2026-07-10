import { execFileSync } from "node:child_process";

const branchPattern =
  /^(feat|fix|docs|refactor|test|chore|ci|build|perf)\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

function currentBranch() {
  return execFileSync("git", ["branch", "--show-current"], {
    encoding: "utf8",
  }).trim();
}

const branchName =
  process.argv[2] ??
  process.env.GITHUB_HEAD_REF ??
  process.env.BRANCH_NAME ??
  currentBranch();

if (branchName === "main") {
  console.log("Branch name OK: main");
  process.exit(0);
}

if (!branchPattern.test(branchName)) {
  console.error(
    [
      `Invalid branch name: ${branchName}`,
      "",
      "Expected:",
      "  <type>/<branch-name>",
      "",
      "Allowed types:",
      "  feat, fix, docs, refactor, test, chore, ci, build, perf",
      "",
      "Examples:",
      "  feat/rating-prompt-polish",
      "  fix/notebook-page1-drawing-persistence",
      "  chore/openspec-auto-pr-workflow",
    ].join("\n"),
  );
  process.exit(1);
}

console.log(`Branch name OK: ${branchName}`);
