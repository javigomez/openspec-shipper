import { describe, expect, test } from "bun:test";
import {
  enablePullRequestAutoMerge,
  PullRequestAutoMergeError,
} from "../src/application/github/enable-pull-request-auto-merge";
import { openPullRequest, type GitHubCliRunner, type GitHubCliResult } from "../src/application/github/open-pull-request";

const pullRequestUrl = "https://github.com/example/project/pull/12";

describe("GitHub pull request adapters", () => {
  test("reuses an existing pull request without creating another one", async () => {
    const calls: string[][] = [];
    const run: GitHubCliRunner = (_cwd, args) => {
      calls.push(args);
      return ok(JSON.stringify([{ url: pullRequestUrl }]));
    };

    const result = await openPullRequest(input(), run);

    expect(result).toEqual({
      url: pullRequestUrl,
      created: false,
      output: `Pull request already exists: ${pullRequestUrl}`,
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.slice(0, 2)).toEqual(["pr", "list"]);
  });

  test("creates a pull request and returns its detected URL", async () => {
    const calls: string[][] = [];
    const run: GitHubCliRunner = (_cwd, args) => {
      calls.push(args);
      if (args[1] === "list") {
        return ok(calls.length === 1 ? "[]" : JSON.stringify([{ url: pullRequestUrl }]));
      }
      return ok(`${pullRequestUrl}\n`);
    };

    const result = await openPullRequest(input(), run);

    expect(result.created).toBe(true);
    expect(result.url).toBe(pullRequestUrl);
    expect(calls.some((args) => args[1] === "create")).toBe(true);
  });

  test("does not repeat auto-merge when it is already enabled", async () => {
    const calls: string[][] = [];
    const output = await enablePullRequestAutoMerge(
      { projectDir: "/project", pullRequest: pullRequestUrl },
      (_cwd, args) => {
        calls.push(args);
        return ok(JSON.stringify({
          state: "OPEN",
          url: pullRequestUrl,
          mergeable: "MERGEABLE",
          mergeStateStatus: "BLOCKED",
          autoMergeRequest: { mergeMethod: "SQUASH" },
        }));
      },
    );

    expect(output).toContain("already enabled");
    expect(calls).toHaveLength(1);
  });

  test("enables squash auto-merge when the pull request is eligible", async () => {
    const calls: string[][] = [];
    const output = await enablePullRequestAutoMerge(
      { projectDir: "/project", pullRequest: pullRequestUrl },
      (_cwd, args) => {
        calls.push(args);
        return args[1] === "view"
          ? ok(JSON.stringify({ state: "OPEN", url: pullRequestUrl, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", autoMergeRequest: null }))
          : ok("Auto-merge enabled\n");
      },
    );

    expect(output).toBe("Auto-merge enabled");
    expect(calls[1]).toEqual(["pr", "merge", pullRequestUrl, "--auto", "--squash"]);
  });

  test("reports conflicting pull requests as an intervention blocker", async () => {
    const error = await enablePullRequestAutoMerge(
      { projectDir: "/project", pullRequest: pullRequestUrl },
      () => ok(JSON.stringify({ state: "OPEN", url: pullRequestUrl, mergeable: "CONFLICTING", mergeStateStatus: "DIRTY", autoMergeRequest: null })),
    ).catch((cause: unknown) => cause);

    expect(error).toBeInstanceOf(PullRequestAutoMergeError);
    expect((error as PullRequestAutoMergeError).failure).toBe("conflict");
    expect((error as Error).message).toContain("CONFLICTING");
  });

  test("reports GitHub permission and repository-policy failures clearly", async () => {
    const inspect = ok(JSON.stringify({ state: "OPEN", url: pullRequestUrl, mergeable: "MERGEABLE", mergeStateStatus: "BLOCKED", autoMergeRequest: null }));
    const permission = (await enablePullRequestAutoMerge(
      { projectDir: "/project", pullRequest: pullRequestUrl },
      sequence(inspect, failed("HTTP 403: Resource not accessible by integration")),
    ).catch((cause: unknown) => cause)) as PullRequestAutoMergeError;
    const policy = (await enablePullRequestAutoMerge(
      { projectDir: "/project", pullRequest: pullRequestUrl },
      sequence(inspect, failed("Auto-merge is not enabled for this repository")),
    ).catch((cause: unknown) => cause)) as PullRequestAutoMergeError;

    expect(permission.failure).toBe("permission");
    expect(permission.message).toContain("write access");
    expect(policy.failure).toBe("not_allowed");
    expect(policy.message).toContain("repository does not allow auto-merge");
  });
});

function input() {
  return {
    projectDir: "/project",
    cwd: "/project/worktree",
    branch: "feat/example",
    baseBranch: "main",
    title: "feat: example",
    body: "Example body",
  };
}

function ok(stdout: string): GitHubCliResult {
  return { status: 0, stdout, stderr: "" };
}

function failed(stderr: string): GitHubCliResult {
  return { status: 1, stdout: "", stderr };
}

function sequence(...results: GitHubCliResult[]): GitHubCliRunner {
  let index = 0;
  return () => results[index++] ?? results.at(-1)!;
}
