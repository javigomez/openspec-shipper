import {
  requireSuccessfulGitHubCommand,
  runGitHubCli,
  type GitHubCliRunner,
} from "./open-pull-request.js";

export type EnablePullRequestAutoMergeInput = {
  projectDir: string;
  pullRequest: string;
};

export type EnablePullRequestAutoMerge = (input: EnablePullRequestAutoMergeInput) => Promise<string>;
export type PullRequestAutoMergeFailure = "permission" | "conflict" | "not_allowed" | "unknown";

export class PullRequestAutoMergeError extends Error {
  constructor(
    readonly failure: PullRequestAutoMergeFailure,
    message: string,
  ) {
    super(message);
    this.name = "PullRequestAutoMergeError";
  }
}

export async function enablePullRequestAutoMerge(
  input: EnablePullRequestAutoMergeInput,
  run: GitHubCliRunner = runGitHubCli,
): Promise<string> {
  const stateResult = run(input.projectDir, [
    "pr",
    "view",
    input.pullRequest,
    "--json",
    "state,url,mergeable,mergeStateStatus,autoMergeRequest",
  ]);
  if (stateResult.status !== 0 || stateResult.error) {
    throw classifyAutoMergeError(commandDetail(stateResult), input.pullRequest);
  }

  let state: {
    state?: unknown;
    url?: unknown;
    mergeable?: unknown;
    mergeStateStatus?: unknown;
    autoMergeRequest?: unknown;
  };
  try {
    state = JSON.parse(stateResult.stdout);
  } catch {
    throw new PullRequestAutoMergeError(
      "unknown",
      `Could not inspect pull request ${input.pullRequest} before enabling auto-merge: gh returned invalid JSON.`,
    );
  }

  const url = typeof state.url === "string" ? state.url : input.pullRequest;
  if (String(state.state).toUpperCase() === "MERGED") {
    return `Pull request is already merged: ${url}`;
  }
  if (state.autoMergeRequest) {
    return `Pull request auto-merge is already enabled: ${url}`;
  }
  if (
    String(state.mergeable).toUpperCase() === "CONFLICTING"
    || String(state.mergeStateStatus).toUpperCase() === "DIRTY"
  ) {
    throw new PullRequestAutoMergeError(
      "conflict",
      `Cannot enable auto-merge for ${url}: the pull request is CONFLICTING. Resolve its conflicts; Shipper will remain waiting for intervention.`,
    );
  }

  try {
    const output = requireSuccessfulGitHubCommand(
      input.projectDir,
      ["pr", "merge", input.pullRequest, "--auto", "--squash"],
      run,
    ).trim();
    return output || `Enabled squash auto-merge for pull request: ${url}`;
  } catch (error) {
    throw classifyAutoMergeError(error instanceof Error ? error.message : String(error), url);
  }
}

function classifyAutoMergeError(detail: string, pullRequest: string): PullRequestAutoMergeError {
  if (/conflict|conflicting|not mergeable|dirty/i.test(detail)) {
    return new PullRequestAutoMergeError(
      "conflict",
      `Cannot enable auto-merge for ${pullRequest}: the pull request is CONFLICTING. Resolve its conflicts; Shipper will remain waiting for intervention. Detail: ${detail}`,
    );
  }
  if (/permission|forbidden|resource not accessible|not authorized|must have (?:push|write)|403/i.test(detail)) {
    return new PullRequestAutoMergeError(
      "permission",
      `Cannot enable auto-merge for ${pullRequest}: GitHub denied permission. Confirm that gh is authenticated with write access. Detail: ${detail}`,
    );
  }
  if (/auto.?merge.*(?:not allowed|not enabled|disabled|enable)|branch protection/i.test(detail)) {
    return new PullRequestAutoMergeError(
      "not_allowed",
      `Cannot enable auto-merge for ${pullRequest}: the repository does not allow auto-merge. Enable it in GitHub repository settings and configure branch protection. Detail: ${detail}`,
    );
  }
  return new PullRequestAutoMergeError(
    "unknown",
    `Cannot enable auto-merge for ${pullRequest}: ${detail}`,
  );
}

function commandDetail(result: { status: number | null; stdout: string; stderr: string; error?: Error }): string {
  return result.error?.message
    ?? firstLine(result.stderr)
    ?? firstLine(result.stdout)
    ?? `gh exited with code ${result.status ?? "unknown"}`;
}

function firstLine(value: string): string | undefined {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}
