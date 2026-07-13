export type TaskStatus = "pending" | "done" | "blocked";

export type QueueAction = "apply" | "ship" | "sync" | "archive" | "deliver";

export type DeliverPhase = "apply" | "ship" | "waiting_for_pr" | "waiting_for_merge" | "sync" | "archive";

export type QueueTask = {
  lineIndex: number;
  status: TaskStatus;
  action: QueueAction;
  change?: string;
  phase?: DeliverPhase;
  dependsOn: string[];
  rawCommand: string;
};

export type QueueParseResult = {
  lines: string[];
  tasks: QueueTask[];
  errors: string[];
};

const TASK_PATTERN = /^(\s*)-\s+\[( |x|X|!)\]\s+(.+?)\s*$/;
const COMMENT_PATTERN = /<!--(.*?)-->/;
const VISUAL_DECORATION_PATTERN = /\s+!\[[^\]]*]\([^)]+\)(?:\s*·\s*_\(\[log]\([^)]+\)\)_)?\s*$/;
const CHANGE_PREFIX_PATTERN = /^openspec\/changes\//;
const CHANGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const DELIVER_PHASES: DeliverPhase[] = ["apply", "ship", "waiting_for_pr", "waiting_for_merge", "sync", "archive"];
export const BLOCKED_TASK_RETRY_HINT = "  > Fixed? Change `[!]` to `[ ]` and run `openspec-shipper queue run` again.";

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

  if (action === "apply" || action === "deliver") {
    if (parts.length !== 2) {
      return { ok: false, error: `\`${action}\` tasks must be \`${action} <change-name>\`` };
    }

    const change = normalizeChangeName(parts[1] ?? "");
    if (!change) {
      return { ok: false, error: `\`${action}\` change must be a kebab-case OpenSpec change name` };
    }

    return { ok: true, task: { action, change } };
  }

  if (action === "ship" || action === "sync" || action === "archive") {
    if (parts.length !== 1) {
      return { ok: false, error: `\`${action}\` tasks do not accept arguments` };
    }

    return { ok: true, task: { action } };
  }

  return {
    ok: false,
    error: `unknown task action \`${action}\`; expected apply, ship, sync, or archive`,
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
  const action = task.action === "deliver" ? deliverPhase(task) : task.action;

  switch (action) {
    case "apply":
      return "openspec-apply-worktree";
    case "ship":
      return "openspec-ship-worktree";
    case "sync":
      return "openspec-main-sync";
    case "archive":
      return "openspec-archive-merged";
    case "waiting_for_pr":
      return "openspec-main-sync";
    case "waiting_for_merge":
      return "openspec-main-sync";
  }
}

export function taskSlug(task: QueueTask): string {
  if (task.action === "deliver") {
    return `deliver-${deliverPhase(task)}-${task.change}`;
  }

  return task.change ? `${task.action}-${task.change}` : task.action;
}

export function markTask(
  lines: string[],
  task: QueueTask,
  status: Exclude<TaskStatus, "pending">,
  details: { timestamp: string; logPath?: string; reason?: string; checkedAt?: string; startedAt?: string },
): string {
  const marker = status === "done" ? "x" : "!";
  const detailParts = [
    task.action === "deliver" && status === "blocked" ? `phase: ${deliverPhase(task)}` : undefined,
    task.dependsOn.length > 0 ? `depends_on: ${task.dependsOn.join(",")}` : undefined,
    status === "done" ? `done: ${details.timestamp}` : `blocked: ${details.timestamp}`,
    details.checkedAt ? `checked: ${details.checkedAt}` : undefined,
    details.startedAt ? `started: ${details.startedAt}` : undefined,
    details.reason ? `reason: ${sanitizeComment(details.reason)}` : undefined,
    details.logPath ? `log: ${details.logPath}` : undefined,
  ].filter(Boolean);

  const nextLines = [...lines];
  const nextLine = formatTaskLine(marker, task.rawCommand, detailParts, {
    status,
    phase: task.action === "deliver" ? deliverPhase(task) : undefined,
    logPath: details.logPath,
  });
  return replaceTaskLine(nextLines, task, nextLine, { retryHint: status === "blocked" });
}

export function markTaskChecking(
  lines: string[],
  task: QueueTask,
  details: { timestamp: string },
): string {
  const phase = task.action === "deliver" ? deliverPhase(task) : undefined;
  const detailParts = [
    phase ? `phase: ${phase}` : undefined,
    task.dependsOn.length > 0 ? `depends_on: ${task.dependsOn.join(",")}` : undefined,
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
  const phase = task.action === "deliver" ? deliverPhase(task) : undefined;
  const detailParts = [
    phase ? `phase: ${phase}` : undefined,
    task.dependsOn.length > 0 ? `depends_on: ${task.dependsOn.join(",")}` : undefined,
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

export function advanceDeliverTask(
  lines: string[],
  task: QueueTask,
  details: { timestamp: string; logPath?: string; checkedAt?: string; startedAt?: string },
): string {
  if (task.action !== "deliver") {
    return markTask(lines, task, "done", details);
  }

  const phase = deliverPhase(task);
  if (phase === "archive") {
    return markTask(lines, task, "done", details);
  }

  const nextPhase = DELIVER_PHASES[DELIVER_PHASES.indexOf(phase) + 1]!;
  const detailParts = [
    task.dependsOn.length > 0 ? `depends_on: ${task.dependsOn.join(",")}` : undefined,
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
  if (task.action !== "deliver") {
    return markTask(lines, task, "done", details);
  }

  const detailParts = [
    task.dependsOn.length > 0 ? `depends_on: ${task.dependsOn.join(",")}` : undefined,
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
    if (task && task[2] !== "!" && nextLine === BLOCKED_TASK_RETRY_HINT) {
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
  return task.phase ?? "apply";
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

function parseTaskMetadata(value: string): Pick<QueueTask, "phase" | "dependsOn"> {
  const match = value.match(COMMENT_PATTERN);
  const metadata: Pick<QueueTask, "phase" | "dependsOn"> = { dependsOn: [] };
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

    if (key === "phase" && isDeliverPhase(rawValue)) {
      metadata.phase = rawValue;
    }

    if (key === "depends_on") {
      metadata.dependsOn = rawValue
        .split(",")
        .map((dependency) => normalizeChangeName(dependency))
        .filter((dependency): dependency is string => Boolean(dependency));
    }
  }

  return metadata;
}

function dependenciesAreDone(task: QueueTask, tasks: QueueTask[]): boolean {
  return task.dependsOn.every((dependency) =>
    tasks.some((candidate) => candidate.change === dependency && candidate.status === "done"),
  );
}

function taskIsRunnable(task: QueueTask, tasks: QueueTask[]): boolean {
  if (!dependenciesAreDone(task, tasks)) {
    return false;
  }

  return task.action !== "deliver" || !["waiting_for_pr", "waiting_for_merge"].includes(deliverPhase(task));
}

export function commandAcceptsChangeArgument(task: QueueTask): boolean {
  if (task.action === "apply") {
    return true;
  }

  if (task.action !== "deliver") {
    return false;
  }

  return !["sync", "waiting_for_pr", "waiting_for_merge"].includes(deliverPhase(task));
}

function isDeliverPhase(value: string): value is DeliverPhase {
  return DELIVER_PHASES.includes(value as DeliverPhase);
}

function formatTaskLine(
  marker: " " | "x" | "!",
  rawCommand: string,
  detailParts: Array<string | undefined>,
  visual: { status: Exclude<TaskStatus, "pending"> | "pending" | "checking" | "running"; phase?: DeliverPhase; logPath?: string },
): string {
  const metadata = detailParts.length > 0 ? ` <!-- ${detailParts.join("; ")} -->` : "";
  return `- [${marker}] ${rawCommand}${metadata}${formatVisualDecoration(visual)}`;
}

function replaceTaskLine(
  lines: string[],
  task: QueueTask,
  nextLine: string,
  options: { retryHint?: boolean } = {},
): string {
  const nextLines = [...lines];
  nextLines[task.lineIndex] = nextLine;

  if (nextLines[task.lineIndex + 1] === BLOCKED_TASK_RETRY_HINT) {
    nextLines.splice(task.lineIndex + 1, 1);
  }

  if (options.retryHint) {
    nextLines.splice(task.lineIndex + 1, 0, BLOCKED_TASK_RETRY_HINT);
  }

  return ensureTrailingNewline(nextLines.join("\n"));
}

function formatVisualDecoration(visual: {
  status: Exclude<TaskStatus, "pending"> | "pending" | "checking" | "running";
  phase?: DeliverPhase;
  logPath?: string;
}): string {
  const badge = badgeForVisual(visual);
  const log = visual.logPath ? ` · _([log](${visual.logPath}))_` : "";
  return ` ${badge}${log}`;
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
  if (phase === "waiting_for_pr") {
    return "![waiting_for_pr waiting](https://img.shields.io/badge/waiting_for_pr-waiting-orange)";
  }

  if (phase === "waiting_for_merge") {
    return "![waiting_for_merge waiting](https://img.shields.io/badge/waiting_for_merge-waiting-orange)";
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
