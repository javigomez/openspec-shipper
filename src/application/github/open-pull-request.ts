import { spawnSync } from "node:child_process";

export type GitHubCliResult = {
  status: number | null;
  stdout: string;
  stderr: string;
  error?: Error;
};

export type GitHubCliRunner = (cwd: string, args: string[]) => GitHubCliResult;

export type OpenPullRequestInput = {
  projectDir: string;
  cwd: string;
  branch: string;
  baseBranch: string;
  title: string;
  body: string;
};

export type OpenPullRequestResult = {
  url: string;
  created: boolean;
  output: string;
};

export async function findOpenPullRequest(
  projectDir: string,
  branch: string,
  run: GitHubCliRunner = runGitHubCli,
): Promise<string | undefined> {
  const result = run(projectDir, ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--limit", "1"]);
  if (result.status !== 0) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(result.stdout) as Array<{ url?: unknown }>;
    const url = parsed[0]?.url;
    return typeof url === "string" && url.length > 0 ? url : undefined;
  } catch {
    return undefined;
  }
}

export async function openPullRequest(
  input: OpenPullRequestInput,
  run: GitHubCliRunner = runGitHubCli,
): Promise<OpenPullRequestResult> {
  const existing = await findOpenPullRequest(input.projectDir, input.branch, run);
  if (existing) {
    return { url: existing, created: false, output: `Pull request already exists: ${existing}` };
  }

  const created = requireSuccessfulGitHubCommand(input.cwd, [
    "pr",
    "create",
    "--base",
    input.baseBranch,
    "--head",
    input.branch,
    "--title",
    input.title,
    "--body",
    input.body,
  ], run).trim();
  const detected = await findOpenPullRequest(input.projectDir, input.branch, run);
  const url = detected ?? extractPullRequestUrl(created);
  if (!url) {
    throw new Error(`gh pr create completed but no open pull request was found for ${input.branch}.`);
  }

  return {
    url,
    created: true,
    output: created || `Created pull request: ${url}`,
  };
}

export function runGitHubCli(cwd: string, args: string[]): GitHubCliResult {
  const result = spawnSync("gh", args, {
    cwd,
    env: process.env,
    encoding: "utf8",
    timeout: 30_000,
  });
  return {
    status: result.status,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
    error: result.error,
  };
}

export function requireSuccessfulGitHubCommand(
  cwd: string,
  args: string[],
  run: GitHubCliRunner = runGitHubCli,
): string {
  const result = run(cwd, args);
  if (result.error || result.status !== 0) {
    const detail = result.error?.message
      ?? firstLine(result.stderr)
      ?? firstLine(result.stdout)
      ?? `exited with code ${result.status ?? "unknown"}`;
    throw new Error(`gh ${args.join(" ")} failed: ${detail}`);
  }
  return result.stdout || result.stderr;
}

function extractPullRequestUrl(output: string): string | undefined {
  return output.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/)?.[0];
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}
