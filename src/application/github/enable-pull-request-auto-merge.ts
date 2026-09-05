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
export type PullRequestAutoMergeWaitState =
  | { kind: "merged"; detail: string }
  | { kind: "pending"; detail: string }
  | { kind: "failed"; detail: string };
export type InspectPullRequestAutoMergeWait = (
  input: EnablePullRequestAutoMergeInput,
) => Promise<PullRequestAutoMergeWaitState>;
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

export async function inspectPullRequestAutoMergeWait(
  input: EnablePullRequestAutoMergeInput,
  run: GitHubCliRunner = runGitHubCli,
): Promise<PullRequestAutoMergeWaitState> {
  const result = run(input.projectDir, [
    "pr",
    "view",
    input.pullRequest,
    "--json",
    "state,url,mergeable,mergeStateStatus,autoMergeRequest",
  ]);
  if (result.status !== 0 || result.error) {
    return { kind: "pending", detail: `could not inspect GitHub yet: ${commandDetail(result)}` };
  }

  let state: {
    state?: unknown;
    url?: unknown;
    mergeable?: unknown;
    mergeStateStatus?: unknown;
    autoMergeRequest?: unknown;
  };
  try {
    state = JSON.parse(result.stdout);
  } catch {
    return { kind: "pending", detail: "could not inspect GitHub yet: gh returned invalid JSON" };
  }

  const url = typeof state.url === "string" ? state.url : input.pullRequest;
  const pullRequestState = String(state.state).toUpperCase();
  if (pullRequestState === "MERGED") {
    return { kind: "merged", detail: `pull request merged: ${url}` };
  }
  if (pullRequestState === "CLOSED") {
    return { kind: "failed", detail: `pull request closed without merging: ${url}` };
  }
  if (
    String(state.mergeable).toUpperCase() === "CONFLICTING"
    || String(state.mergeStateStatus).toUpperCase() === "DIRTY"
  ) {
    return { kind: "failed", detail: `pull request is conflicting: ${url}` };
  }
  if (!state.autoMergeRequest) {
    return { kind: "failed", detail: `auto-merge is no longer enabled: ${url}` };
  }

  const checksResult = run(input.projectDir, [
    "pr",
    "checks",
    input.pullRequest,
    "--required",
    "--json",
    "name,state,bucket,workflow",
  ]);
  let checks: unknown[];
  try {
    const parsed = JSON.parse(checksResult.stdout);
    checks = Array.isArray(parsed) ? parsed : [];
  } catch {
    return { kind: "pending", detail: `could not inspect required checks yet: ${commandDetail(checksResult)}` };
  }

  const failedChecks = checks.flatMap((check) => {
    const record = asRecord(check);
    const state = String(record.state ?? "").toUpperCase();
    const bucket = String(record.bucket ?? "").toLowerCase();
    return bucket === "fail" || bucket === "cancel" || FAILED_CHECK_STATES.has(state)
      ? [`${checkName(record)} (${state || bucket.toUpperCase()})`]
      : [];
  });
  if (failedChecks.length > 0) {
    return { kind: "failed", detail: `required check(s) failed: ${failedChecks.join(", ")}` };
  }

  const pendingChecks = checks.flatMap((check) => {
    const record = asRecord(check);
    const state = String(record.state ?? "").toUpperCase();
    const bucket = String(record.bucket ?? "").toLowerCase();
    return bucket === "pending" || !["SUCCESS", "NEUTRAL", "SKIPPED"].includes(state)
      ? [checkName(record)]
      : [];
  });
  return pendingChecks.length > 0
    ? { kind: "pending", detail: `waiting for check(s): ${pendingChecks.join(", ")}` }
    : { kind: "pending", detail: "waiting for GitHub to complete auto-merge" };
}

const FAILED_CHECK_STATES = new Set([
  "ACTION_REQUIRED",
  "CANCELLED",
  "ERROR",
  "FAILURE",
  "STALE",
  "STARTUP_FAILURE",
  "TIMED_OUT",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? value as Record<string, unknown> : {};
}

function checkName(check: Record<string, unknown>): string {
  const name = check.name ?? check.context ?? check.workflowName;
  return typeof name === "string" && name.trim() ? name.trim() : "unnamed check";
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
