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

export function buildRecoveryPrompt(input: Pick<AssistedRecoveryInput, "task" | "failure" | "cwd" | "baseBranch" | "logPath">): string {
  const changeName = input.task.change ?? "unknown-change";
  return [
    "You are the internal OpenSpec Shipper recovery agent.",
    `A ${input.failure.phase} operation for ${changeName} is about to be marked blocked.`,
    `Failure category: ${input.failure.kind}`,
    `Failure reason: ${input.failure.reason}`,
    `The complete run log is available at: ${input.logPath}`,
    `Work only inside the authorized workspace: ${input.cwd}`,
    `The integration boundary is origin/${input.baseBranch}.`,
    "Inspect the log and repository state, then repair the underlying condition when it is safe and within the current task scope.",
    "Do not merely propose instructions: perform the repair and run the narrowest useful checks.",
    "Do not edit, reset, stash, switch, commit, or clean the human checkout.",
    "Do not edit the Shipper queue, merge pull requests, force-push, or rewrite remote history.",
    "Do not work on another OpenSpec change.",
    "Only modify the authorized delivery or integration workspace and its branch.",
    "The runner will retry the original phase and remains the authority on whether recovery succeeded.",
    "If repair is unsafe or requires a human decision, finish with exactly: OPENSPEC_SHIPPER_BLOCKED: <short reason>",
    "If repaired, explain the evidence and do not emit OPENSPEC_SHIPPER_BLOCKED.",
  ].join("\n");
}
