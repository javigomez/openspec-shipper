import { appendFile } from "node:fs/promises";
import type { QueueTask } from "../../domain/queue/queue.js";
import {
  recoveryDecision,
  recoveryFailureFingerprint,
  type DeliveryFailure,
  type RecoveryPolicy,
} from "../../domain/recovery/recovery.js";

export type RecoveryInvocationResult = {
  exitCode: number | null;
  output: string;
  failureReason?: string;
};

export type AssistedRecoveryInput = {
  task: QueueTask;
  failure: DeliveryFailure;
  policy: RecoveryPolicy;
  attemptsForPhase: number;
  cwd: string;
  targetWorkspace: string;
  baseBranch: string;
  logPath: string;
  invoke: (prompt: string, cwd: string, logPath: string) => Promise<RecoveryInvocationResult>;
};

export type AssistedRecoveryResult =
  | { kind: "skipped"; reason: string }
  | { kind: "repaired"; fingerprint: string; output: string }
  | { kind: "failed"; fingerprint: string; reason: string; output: string };

export async function attemptAssistedRecovery(input: AssistedRecoveryInput): Promise<AssistedRecoveryResult> {
  const decision = recoveryDecision(input.failure, input.policy, input.attemptsForPhase);
  if (decision.kind === "block_immediately") {
    return { kind: "skipped", reason: decision.reason };
  }

  const fingerprint = recoveryFailureFingerprint(input.failure);
  const prompt = buildRecoveryPrompt(input);
  await appendFile(input.logPath, [
    "",
    "## Assisted recovery attempt",
    "",
    `Failure kind: ${input.failure.kind}`,
    `Failure reason: ${input.failure.reason}`,
    `Failure fingerprint: ${fingerprint}`,
    "",
  ].join("\n"));

  const result = await input.invoke(prompt, input.cwd, input.logPath).catch((error: unknown): RecoveryInvocationResult => ({
    exitCode: null,
    output: "",
    failureReason: error instanceof Error ? error.message : String(error),
  }));
  const reason = result.failureReason
    ?? (result.exitCode === 0 ? undefined : `recovery executor exited with code ${result.exitCode}`);
  await appendFile(input.logPath, [
    "",
    "## Assisted recovery result",
    "",
    reason ? `Failed: ${reason}` : "Recovery agent completed; the original phase will be reconciled and retried.",
    "",
  ].join("\n"));

  return reason
    ? { kind: "failed", fingerprint, reason, output: result.output }
    : { kind: "repaired", fingerprint, output: result.output };
}

export function buildRecoveryPrompt(input: Pick<AssistedRecoveryInput, "task" | "failure" | "cwd" | "targetWorkspace" | "baseBranch" | "logPath">): string {
  const changeName = input.task.change ?? "unknown-change";
  return [
    "You are the internal OpenSpec Shipper recovery agent.",
    `A ${input.failure.phase} operation for ${changeName} is about to be marked blocked.`,
    `Failure category: ${input.failure.kind}`,
    `Failure reason: ${input.failure.reason}`,
    `The complete run log is available at: ${input.logPath}`,
    `Repository root with full recovery authority: ${input.cwd}`,
    `Primary target workspace: ${input.targetWorkspace}`,
    `The integration boundary is origin/${input.baseBranch}.`,
    "You have full repository and Git access for this recovery attempt. Inspect the log, every worktree, branches, refs, locks, remotes, and GitHub state as needed.",
    "Repair the underlying condition instead of merely describing it. You may recreate the target worktree or its local delivery branch after preserving any unique commits, dirty changes, and untracked files.",
    "Do not merely propose instructions: perform the repair and run the narrowest useful checks.",
    "Do not discard user work. Before any destructive Git operation, prove that the affected state is reproducible or preserve it with a recoverable backup.",
    "Do not edit, reset, stash, switch, commit, or clean the human checkout unless that exact checkout is the declared target workspace.",
    "Do not edit the Shipper queue, merge pull requests, force-push, or rewrite remote history.",
    "Do not implement another OpenSpec change. You may inspect and repair repository-wide infrastructure that prevents the target change from progressing.",
    "Keep product-code edits focused on the target change and its delivery or integration workspace.",
    "The runner will retry the original phase and remains the authority on whether recovery succeeded.",
    "If repair is unsafe or requires a human decision, finish with exactly: OPENSPEC_SHIPPER_BLOCKED: <short reason>",
    "If repaired, explain the evidence and do not emit OPENSPEC_SHIPPER_BLOCKED.",
  ].join("\n");
}
