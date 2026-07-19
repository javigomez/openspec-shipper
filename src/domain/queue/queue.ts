export type TaskStatus = "pending" | "done" | "blocked";

export type QueueAction = "deliver";

export type DeliverPhase =
  | "prepare_worktree"
  | "implement"
  | "refresh_branch"
  | "push"
  | "waiting_for_merge"
  | "archive"
  | "publish_archive"
  | "waiting_for_archive_merge"
  | "cleanup_worktree";

export type QueueTask = {
  lineIndex: number;
  status: TaskStatus;
  action: QueueAction;
  change?: string;
  phase?: DeliverPhase;
  dependsOn: string[];
  archiveAfter: string[];
  sourceBranch?: string;
  sourceCommit?: string;
  sourceWorktree?: string;
  deliveryBranch?: string;
  deliveryWorktree?: string;
  adoptedAt?: string;
  publishedCommit?: string;
  pullRequestUrl?: string;
  archiveAttempts?: number;
  archiveBase?: string;
  archivePullRequestUrl?: string;
  metadata: Record<string, string>;
  rawCommand: string;
};

export type QueueParseResult = {
  lines: string[];
  tasks: QueueTask[];
  errors: string[];
};

const TASK_PATTERN = /^(\s*)-\s+\[( |x|X|!)\]\s+(.+?)\s*$/;
const COMMENT_PATTERN = /<!--(.*?)-->/;
const VISUAL_DECORATION_PATTERN = /\s+!\[[^\]]*]\([^)]+\)(?:\s*·\s*\[PR]\([^)]+\))?(?:\s*·\s*_\(\[log]\([^)]+\)\)_)?\s*$/;
const CHANGE_PREFIX_PATTERN = /^openspec\/changes\//;
const CHANGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DELIVER_PHASES: DeliverPhase[] = [
  "prepare_worktree",
  "implement",
  "refresh_branch",
  "push",
  "waiting_for_merge",
  "archive",
  "publish_archive",
  "waiting_for_archive_merge",
  "cleanup_worktree",
];
export const BLOCKED_TASK_RETRY_HINT = "  > Fixed? Change `[!]` to `[ ]` and run `openspec-shipper queue run` again.";
export const WAITING_FOR_MERGE_RETRY_HINT = "  > Merged PR? Change `[!]` to `[ ]` and run `openspec-shipper queue run` again.";
export const WAITING_FOR_ARCHIVE_MERGE_RETRY_HINT = "  > Merged archive PR? Change `[!]` to `[ ]` and run `openspec-shipper queue run` again.";

export function parseQueue(content: string): QueueParseResult {
  const lines = content.split(/\r?\n/);
  const tasks: QueueTask[] = [];
  const errors: string[] = [];

  lines.forEach((line, lineIndex) => {
    const match = line.match(TASK_PATTERN);
    if (!match) {
      return;
    }

    const marker = match[2] ?? " ";
    const metadata = parseTaskMetadata(match[3] ?? "");
    const rawCommand = stripTaskDecorations(match[3] ?? "");
    const parsed = parseTaskCommand(rawCommand);

    if (!parsed.ok) {
      errors.push(`Line ${lineIndex + 1}: ${parsed.error}`);
      return;
    }

    tasks.push({
      lineIndex,
      status: marker === "!" ? "blocked" : marker.toLowerCase() === "x" ? "done" : "pending",
      rawCommand,
      ...metadata,
      ...parsed.task,
    });
  });

  return { lines, tasks, errors };
}

type ParseTaskCommandResult =
  | { ok: true; task: Pick<QueueTask, "action" | "change"> }
  | { ok: false; error: string };

export function parseTaskCommand(command: string): ParseTaskCommandResult {
  const parts = command.trim().split(/\s+/).filter(Boolean);
  const action = parts[0];

  if (!action) {
    return { ok: false, error: "empty queue task" };
  }

  if (action === "deliver") {
    if (parts.length !== 2) {
      return { ok: false, error: `\`${action}\` tasks must be \`${action} <change-name>\`` };
    }

    const change = normalizeChangeName(parts[1] ?? "");
    if (!change) {
      return { ok: false, error: `\`${action}\` change must be a kebab-case OpenSpec change name` };
    }

    return { ok: true, task: { action: "deliver", change } };
  }

  return {
    ok: false,
    error: `unknown task action \`${action}\`; expected deliver <change-name>`,
  };
}

export function normalizeChangeName(value: string): string | undefined {
  const trimmed = value.trim().replace(/\/+$/, "").replace(CHANGE_PREFIX_PATTERN, "");
  return CHANGE_PATTERN.test(trimmed) ? trimmed : undefined;
}

export function findFirstPendingTask(tasks: QueueTask[]): QueueTask | undefined {
  return tasks.find((task) => task.status === "pending");
}

export function findFirstRunnableTask(tasks: QueueTask[]): QueueTask | undefined {
  return tasks.find((task) => task.status === "pending" && taskIsRunnable(task, tasks));
}

export function findWaitingTasks(tasks: QueueTask[]): QueueTask[] {
  return tasks.filter((task) => task.status === "pending" && !taskIsRunnable(task, tasks));
}

export function findBlockedTasks(tasks: QueueTask[]): QueueTask[] {
  return tasks.filter((task) => task.status === "blocked");
}

export function buildOpenCodeArgs(task: QueueTask): string[] {
  const commandName = openCodeCommandName(task);
  const args = ["run", "--command", commandName];

  if (task.change && commandAcceptsChangeArgument(task)) {
    args.push(task.change);
  }

  return args;
}

export function openCodeCommandName(task: QueueTask): string {
  const action = deliverPhase(task);

  switch (action) {
    case "implement":
      return "openspec-apply-worktree";
    case "archive":
      return "openspec-archive-merged";
    case "prepare_worktree":
    case "refresh_branch":
    case "push":
    case "publish_archive":
    case "cleanup_worktree":
    case "waiting_for_merge":
    case "waiting_for_archive_merge":
      throw new Error(`${action} is native OpenSpec Shipper runner logic and has no OpenCode command`);
  }
}

export function taskSlug(task: QueueTask): string {
  return `deliver-${deliverPhase(task)}-${task.change}`;
}

export function markTask(
  lines: string[],
  task: QueueTask,
  status: Exclude<TaskStatus, "pending">,
  details: { timestamp: string; logPath?: string; reason?: string; checkedAt?: string; startedAt?: string; pullRequestUrl?: string },
): string {
  const marker = status === "done" ? "x" : "!";
  const detailParts = [
    status === "blocked" ? `phase: ${deliverPhase(task)}` : undefined,
    ...persistentMetadataParts(task),
    status === "done" ? `done: ${details.timestamp}` : `blocked: ${details.timestamp}`,
    details.checkedAt ? `checked: ${details.checkedAt}` : undefined,
    details.startedAt ? `started: ${details.startedAt}` : undefined,
    details.reason ? `reason: ${sanitizeComment(details.reason)}` : undefined,
    details.logPath ? `log: ${details.logPath}` : undefined,
  ].filter(Boolean);

  const nextLines = [...lines];
  const nextLine = formatTaskLine(marker, task.rawCommand, detailParts, {
    status,
    phase: deliverPhase(task),
    logPath: details.logPath,
    pullRequestUrl: details.pullRequestUrl,
  });
  return replaceTaskLine(nextLines, task, nextLine, {
    retryHint: status === "blocked",
    retryHintText:
      deliverPhase(task) === "waiting_for_merge"
        ? WAITING_FOR_MERGE_RETRY_HINT
        : deliverPhase(task) === "waiting_for_archive_merge"
          ? WAITING_FOR_ARCHIVE_MERGE_RETRY_HINT
          : BLOCKED_TASK_RETRY_HINT,
  });
}

export function markTaskChecking(
  lines: string[],
  task: QueueTask,
  details: { timestamp: string },
): string {
  const phase = deliverPhase(task);
  const detailParts = [
    phase ? `phase: ${phase}` : undefined,
    ...persistentMetadataParts(task),
    `checking: ${details.timestamp}`,
  ].filter(Boolean);

  const nextLine = formatTaskLine(" ", task.rawCommand, detailParts, {
    status: "checking",
    phase,
  });
  return replaceTaskLine(lines, task, nextLine);
}

export function markTaskRunning(
  lines: string[],
  task: QueueTask,
  details: { timestamp: string; logPath?: string },
): string {
  const phase = deliverPhase(task);
  const detailParts = [
    phase ? `phase: ${phase}` : undefined,
    ...persistentMetadataParts(task),
    `running: ${details.timestamp}`,
    details.logPath ? `log: ${details.logPath}` : undefined,
  ].filter(Boolean);

  const nextLine = formatTaskLine(" ", task.rawCommand, detailParts, {
    status: "running",
    phase,
    logPath: details.logPath,
  });
  return replaceTaskLine(lines, task, nextLine);
}

export function rewritePendingTask(lines: string[], task: QueueTask): string {
  const phase = deliverPhase(task);
  const detailParts = [
    phase !== "prepare_worktree" ? `phase: ${phase}` : undefined,
    ...persistentMetadataParts(task),
  ].filter(Boolean);
  const nextLine = formatTaskLine(" ", task.rawCommand, detailParts, {
    status: "pending",
    phase,
  });
  return replaceTaskLine(lines, task, nextLine);
}

export function advanceDeliverTask(
  lines: string[],
  task: QueueTask,
  details: { timestamp: string; logPath?: string; checkedAt?: string; startedAt?: string },
): string {
  const phase = deliverPhase(task);
  if (phase === "cleanup_worktree") {
    return markTask(lines, task, "done", details);
  }

  const nextPhase = phase === "push" ? "waiting_for_merge" : DELIVER_PHASES[DELIVER_PHASES.indexOf(phase) + 1]!;
  const detailParts = [
    ...persistentMetadataParts(task),
    `phase: ${nextPhase}`,
    `advanced: ${details.timestamp}`,
    details.checkedAt ? `checked: ${details.checkedAt}` : undefined,
    details.startedAt ? `started: ${details.startedAt}` : undefined,
    details.logPath ? `log: ${details.logPath}` : undefined,
  ].filter(Boolean);
  const nextLine = formatTaskLine(" ", task.rawCommand, detailParts, {
    status: "pending",
    phase: nextPhase,
    logPath: details.logPath,
  });
  return replaceTaskLine(lines, task, nextLine);
}

export function advanceDeliverTaskToPhase(
  lines: string[],
  task: QueueTask,
  phase: DeliverPhase,
  details: { timestamp: string; logPath?: string; checkedAt?: string; startedAt?: string },
): string {
  const detailParts = [
    ...persistentMetadataParts(task),
    `phase: ${phase}`,
    `advanced: ${details.timestamp}`,
    details.checkedAt ? `checked: ${details.checkedAt}` : undefined,
    details.startedAt ? `started: ${details.startedAt}` : undefined,
    details.logPath ? `log: ${details.logPath}` : undefined,
  ].filter(Boolean);
  const nextLine = formatTaskLine(" ", task.rawCommand, detailParts, {
    status: "pending",
    phase,
    logPath: details.logPath,
  });
  return replaceTaskLine(lines, task, nextLine);
}

export function removeRetryHintsForUnblockedTasks(content: string): string {
  const lines = content.split(/\r?\n/);
  let changed = false;
  const nextLines: string[] = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const task = line.match(TASK_PATTERN);
    const nextLine = lines[index + 1];
    if (
      task &&
      task[2] !== "!" &&
      (nextLine === BLOCKED_TASK_RETRY_HINT ||
        nextLine === WAITING_FOR_MERGE_RETRY_HINT ||
        nextLine === WAITING_FOR_ARCHIVE_MERGE_RETRY_HINT)
    ) {
      nextLines.push(line);
      index += 1;
      changed = true;
      continue;
    }

    nextLines.push(line);
  }

  return changed ? ensureTrailingNewline(nextLines.join("\n")) : content;
}

export function deliverPhase(task: QueueTask): DeliverPhase {
  return task.phase ?? "prepare_worktree";
}

export function detectFailureSignal(output: string): string | undefined {
  const patterns: Array<[RegExp, string]> = [
    [/UnknownError/i, "OpenCode returned UnknownError"],
    [/Unexpected server error/i, "OpenCode returned an unexpected server error"],
    [/AI_APICallError/i, "OpenCode stream failed with AI_APICallError"],
    [/not a recognized command or skill/i, "OpenCode did not recognize the command"],
    [/command not found:\s*openspec/i, "OpenSpec CLI was not available"],
    [/auto-rejecting/i, "OpenCode auto-rejected a permission request"],
    [/permission requested/i, "OpenCode requested permission in non-interactive mode"],
    [/\bArchive blocked\b/i, "OpenSpec archive worker reported a blocker"],
    [/\bnot archive-ready\b/i, "OpenSpec archive worker reported a blocker"],
    [/\b(worker reported a blocker|task is blocked|cannot continue without)\b/i, "Worker reported a blocker"],
  ];

  return patterns.find(([pattern]) => pattern.test(output))?.[1];
}

function stripTaskDecorations(value: string): string {
  return value.replace(COMMENT_PATTERN, "").replace(VISUAL_DECORATION_PATTERN, "").trim();
}

type ParsedTaskMetadata = Pick<
  QueueTask,
  | "phase"
  | "dependsOn"
  | "archiveAfter"
  | "sourceBranch"
  | "sourceCommit"
  | "sourceWorktree"
  | "deliveryBranch"
  | "deliveryWorktree"
  | "adoptedAt"
  | "publishedCommit"
  | "pullRequestUrl"
  | "archiveAttempts"
  | "archiveBase"
  | "archivePullRequestUrl"
  | "metadata"
>;

function parseTaskMetadata(value: string): ParsedTaskMetadata {
  const match = value.match(COMMENT_PATTERN);
  const metadata: ParsedTaskMetadata = { dependsOn: [], archiveAfter: [], metadata: {} };
  if (!match) {
    return metadata;
  }

  for (const part of (match[1] ?? "").split(";")) {
    const [rawKey, ...rawValueParts] = part.split(":");
    const key = rawKey?.trim();
    const rawValue = rawValueParts.join(":").trim();
    if (!key || !rawValue) {
      continue;
    }

    metadata.metadata[key] = rawValue;
    const phase = normalizeDeliverPhase(rawValue);
    if (key === "phase" && phase) {
      metadata.phase = phase;
    }

    if (key === "depends_on") {
      metadata.dependsOn = rawValue
        .split(",")
        .map((dependency) => normalizeChangeName(dependency))
        .filter((dependency): dependency is string => Boolean(dependency));
    }

    if (key === "archive_after") {
      metadata.archiveAfter = rawValue
        .split(",")
        .map((dependency) => normalizeChangeName(dependency))
        .filter((dependency): dependency is string => Boolean(dependency));
    }

    if (key === "source_branch") metadata.sourceBranch = rawValue;
    if (key === "source_commit") metadata.sourceCommit = rawValue;
    if (key === "source_worktree") metadata.sourceWorktree = rawValue;
    if (key === "delivery_branch") metadata.deliveryBranch = rawValue;
    if (key === "delivery_worktree") metadata.deliveryWorktree = rawValue;
    if (key === "adopted") metadata.adoptedAt = rawValue;
    if (key === "published_commit") metadata.publishedCommit = rawValue;
    if (key === "pr_url") metadata.pullRequestUrl = rawValue;
    if (key === "archive_base") metadata.archiveBase = rawValue;
    if (key === "archive_pr_url") metadata.archivePullRequestUrl = rawValue;
    if (key === "archive_attempts" && /^\d+$/.test(rawValue)) metadata.archiveAttempts = Number(rawValue);
  }

  return metadata;
}

function dependenciesAreDone(task: QueueTask, tasks: QueueTask[]): boolean {
  return task.dependsOn.every((dependency) =>
    tasks.some((candidate) => candidate.change === dependency && candidate.status === "done"),
  );
}

function archiveDependenciesAreDone(task: QueueTask, tasks: QueueTask[]): boolean {
  if (!phaseRequiresArchiveOrder(deliverPhase(task))) {
    return true;
  }

  return task.archiveAfter.every((dependency) =>
    tasks.some((candidate) =>
      candidate.change === dependency &&
      (candidate.status === "done" || ["cleanup_worktree"].includes(deliverPhase(candidate)))
    ),
  );
}

function taskIsRunnable(task: QueueTask, tasks: QueueTask[]): boolean {
  if (!dependenciesAreDone(task, tasks) || !archiveDependenciesAreDone(task, tasks)) {
    return false;
  }

  return !["waiting_for_merge", "waiting_for_archive_merge"].includes(deliverPhase(task));
}

export function commandAcceptsChangeArgument(task: QueueTask): boolean {
  return !["prepare_worktree", "refresh_branch", "waiting_for_merge", "publish_archive", "waiting_for_archive_merge"].includes(deliverPhase(task));
}

function phaseRequiresArchiveOrder(phase: DeliverPhase): boolean {
  return ["archive", "publish_archive", "waiting_for_archive_merge", "cleanup_worktree"].includes(phase);
}

const TRANSIENT_METADATA_KEYS = new Set([
  "phase",
  "checking",
  "running",
  "advanced",
  "blocked",
  "done",
  "checked",
  "started",
  "reason",
  "log",
]);

function persistentMetadataParts(task: QueueTask): string[] {
  const known = new Set([
    "depends_on",
    "archive_after",
    "source_branch",
    "source_commit",
    "source_worktree",
    "delivery_branch",
    "delivery_worktree",
    "adopted",
    "published_commit",
    "pr_url",
    "archive_attempts",
    "archive_base",
    "archive_pr_url",
  ]);
  const parts = [
    task.dependsOn.length > 0 ? `depends_on: ${task.dependsOn.join(",")}` : undefined,
    task.archiveAfter.length > 0 ? `archive_after: ${task.archiveAfter.join(",")}` : undefined,
    task.sourceBranch ? `source_branch: ${task.sourceBranch}` : undefined,
    task.sourceCommit ? `source_commit: ${task.sourceCommit}` : undefined,
    task.sourceWorktree ? `source_worktree: ${task.sourceWorktree}` : undefined,
    task.deliveryBranch ? `delivery_branch: ${task.deliveryBranch}` : undefined,
    task.deliveryWorktree ? `delivery_worktree: ${task.deliveryWorktree}` : undefined,
    task.adoptedAt ? `adopted: ${task.adoptedAt}` : undefined,
    task.publishedCommit ? `published_commit: ${task.publishedCommit}` : undefined,
    task.pullRequestUrl ? `pr_url: ${task.pullRequestUrl}` : undefined,
    task.archiveAttempts !== undefined ? `archive_attempts: ${task.archiveAttempts}` : undefined,
    task.archiveBase ? `archive_base: ${task.archiveBase}` : undefined,
    task.archivePullRequestUrl ? `archive_pr_url: ${task.archivePullRequestUrl}` : undefined,
    ...Object.entries(task.metadata)
      .filter(([key]) => !known.has(key) && !TRANSIENT_METADATA_KEYS.has(key))
      .map(([key, value]) => `${key}: ${value}`),
  ].filter((part): part is string => Boolean(part));
  return parts;
}

function normalizeDeliverPhase(value: string): DeliverPhase | undefined {
  return DELIVER_PHASES.includes(value as DeliverPhase) ? (value as DeliverPhase) : undefined;
}

function formatTaskLine(
  marker: " " | "x" | "!",
  rawCommand: string,
  detailParts: Array<string | undefined>,
  visual: { status: Exclude<TaskStatus, "pending"> | "pending" | "checking" | "running"; phase?: DeliverPhase; logPath?: string; pullRequestUrl?: string },
): string {
  const metadata = detailParts.length > 0 ? ` <!-- ${detailParts.join("; ")} -->` : "";
  return `- [${marker}] ${rawCommand}${metadata}${formatVisualDecoration(visual)}`;
}

function replaceTaskLine(
  lines: string[],
  task: QueueTask,
  nextLine: string,
  options: { retryHint?: boolean; retryHintText?: string } = {},
): string {
  const nextLines = [...lines];
  nextLines[task.lineIndex] = nextLine;

  if (
    nextLines[task.lineIndex + 1] === BLOCKED_TASK_RETRY_HINT ||
    nextLines[task.lineIndex + 1] === WAITING_FOR_MERGE_RETRY_HINT ||
    nextLines[task.lineIndex + 1] === WAITING_FOR_ARCHIVE_MERGE_RETRY_HINT
  ) {
    nextLines.splice(task.lineIndex + 1, 1);
  }

  if (options.retryHint) {
    nextLines.splice(task.lineIndex + 1, 0, options.retryHintText ?? BLOCKED_TASK_RETRY_HINT);
  }

  return ensureTrailingNewline(nextLines.join("\n"));
}

function formatVisualDecoration(visual: {
  status: Exclude<TaskStatus, "pending"> | "pending" | "checking" | "running";
  phase?: DeliverPhase;
  logPath?: string;
  pullRequestUrl?: string;
}): string {
  const badge = badgeForVisual(visual);
  const pr = visual.pullRequestUrl ? ` · [PR](${visual.pullRequestUrl})` : "";
  const log = visual.logPath ? ` · _([log](${visual.logPath}))_` : "";
  return ` ${badge}${pr}${log}`;
}

function badgeForVisual(visual: {
  status: Exclude<TaskStatus, "pending"> | "pending" | "checking" | "running";
  phase?: DeliverPhase;
}): string {
  if (visual.status === "done") {
    const phase = visual.phase ?? "task";
    return `![${phase} done](https://img.shields.io/badge/${phase}-done-brightgreen)`;
  }

  if (visual.status === "blocked") {
    const phase = visual.phase ?? "task";
    return `![${phase} blocked](https://img.shields.io/badge/${phase}-blocked-red)`;
  }

  if (visual.status === "running") {
    const phase = visual.phase ?? "task";
    return `![${phase} running](https://img.shields.io/badge/${phase}-running-yellow)`;
  }

  if (visual.status === "checking") {
    const phase = visual.phase ?? "task";
    return `![${phase} checking](https://img.shields.io/badge/${phase}-checking-yellow)`;
  }

  const phase = visual.phase ?? "pending";
  if (phase === "waiting_for_merge") {
    return "![waiting_for_merge waiting](https://img.shields.io/badge/waiting_for_merge-waiting-orange)";
  }

  if (phase === "waiting_for_archive_merge") {
    return "![waiting_for_archive_merge waiting](https://img.shields.io/badge/waiting_for_archive_merge-waiting-orange)";
  }

  if (phase === "pending") {
    return "![pending](https://img.shields.io/badge/pending-ready-lightgrey)";
  }

  return `![${phase} ready](https://img.shields.io/badge/${phase}-ready-blue)`;
}

function sanitizeComment(value: string): string {
  return value.replace(/--/g, "-").replace(/\s+/g, " ").trim().slice(0, 180);
}

function ensureTrailingNewline(value: string): string {
  return value.endsWith("\n") ? value : `${value}\n`;
}
