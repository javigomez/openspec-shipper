import { spawn, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { createWriteStream, existsSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { access, appendFile, mkdir, open, readFile, readdir, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { hostname } from "node:os";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  advanceDeliverTask,
  advanceDeliverTaskToPhase,
  deliverPhase,
  findBlockedTasks,
  findFirstRunnableTask,
  findWaitingTasks,
  markTask,
  markTaskChecking,
  markTaskRunning,
  parseQueue,
  removeRetryHintsForUnblockedTasks,
  taskSlug,
  type DeliverPhase,
  type QueueTask,
} from "../../domain/queue/queue.js";
import { reconcileDeliveryTask } from "../../domain/delivery/reconcile.js";
import { phaseDefinition } from "../../domain/delivery/phases/index.js";
import type { DeliveryEvidence } from "../../domain/delivery/phase.js";
import { shouldRefreshDeliveryBranch } from "../../domain/delivery/refresh-policy.js";
import type { ExecutorProviderId, ProviderCommand } from "../../domain/provider/provider.js";
import { filterLocalStateStatus } from "../../domain/config/local-state.js";
import {
  DEFAULT_QUEUE_PATH,
  DEFAULT_STATE_DIR,
  defaultShipperConfig,
  readShipperConfigSync,
} from "../../domain/config/shipper-config.js";
import { providerById } from "../../infrastructure/providers/registry.js";
import { openCodeCommandName, openCodeCommandPath, openCodeConfigDir } from "../../infrastructure/providers/opencode/provider.js";
import { codexPromptPath, codexWorkflowPath } from "../../infrastructure/providers/codex-cli/provider.js";
import {
  type ClaudeCliOptions,
  type ClaudeContractResult,
  claudePromptPath,
  claudeSettingsPath,
  claudeWorkflowPath,
  buildClaudeCliArgs,
  verifyClaudeCliContract,
} from "../../infrastructure/providers/claude-code/provider.js";
import { discoverProjectDirSync } from "../../infrastructure/filesystem/project-root.js";
import {
  resolveDeliverySource,
  sourceHasNewerChangeCommit,
  type DeliverySource,
} from "../../infrastructure/git/delivery-source.js";

export type RunnerMode = "next" | "run" | "status" | "dry-run" | "stop" | "stats";

export type RunnerConfig = {
  rootDir: string;
  projectDir: string;
  queuePath: string;
  stateDir: string;
  baseBranch?: string;
  providerId?: ExecutorProviderId;
  opencodeBin: string;
  opencodeModel?: string;
  codexBin?: string;
  codexModel?: string;
  codexReasoningEffort?: string;
  claudeBin?: string;
  claudeModel?: string;
  claudeEffort?: string;
  claudePermissionMode?: string;
  claudeMaxTurns?: number;
  claudeMaxBudgetUsd?: number;
  opencodePrintLogs?: boolean;
  opencodeLogLevel?: string;
  opencodeStats?: boolean;
  opencodeStatsIntervalMs: number;
  opencodeStatsTimeoutMs: number;
  opencodeStatsProject: string;
  opencodeStatsModels?: string;
  opencodeStatsDays?: string;
  loopDelayMs: number;
  busyDelayMs: number;
  taskTimeoutMs: number;
  heartbeatMs: number;
  maxBlockedTasks: number;
  activeExecutorAllowance?: number;
  executor?: Executor;
  processDetector?: ProcessDetector;
  gitRemoteDetector?: GitRemoteDetector;
  activeChangeDetector?: ActiveChangeDetector;
  archivedChangeDetector?: ArchivedChangeDetector;
  localClaimDetector?: LocalClaimDetector;
  localClaimPublishedDetector?: LocalClaimPublishedDetector;
  remoteBranchDetector?: RemoteBranchDetector;
  pullRequestDetector?: PullRequestDetector;
  mergedPullRequestDetector?: MergedPullRequestDetector;
  tasksCompleteDetector?: TasksCompleteDetector;
  worktreeDependenciesReadyDetector?: WorktreeDependenciesReadyDetector;
  reconcileWorktreeDependencies?: ReconcileWorktreeDependencies;
  claudeContractVerifier?: ClaudeContractVerifier;
  prepareWorkspace?: PrepareWorkspace;
  refreshDeliveryBranch?: RefreshDeliveryBranch;
  pushBranchAndOpenPullRequest?: PushBranchAndOpenPullRequest;
  cleanupWorkspace?: CleanupWorkspace;
  finalizeArchive?: FinalizeArchive;
  sourceResolver?: SourceResolver;
  prepareArchiveWorkspace?: PrepareArchiveWorkspace;
  repairNativeFailure?: RepairNativeFailure;
  sleep?: Sleep;
  now?: () => Date;
};

export type Executor = (
  command: string,
  args: string[],
  options: ExecutorOptions,
) => Promise<ExecutorResult>;

type ExecutorOptions = {
  cwd: string;
  logPath: string;
  timeoutMs: number;
  heartbeatMs: number;
  stdin?: string;
  env?: Record<string, string>;
  stats?: StatsOptions;
};

type StatsOptions = {
  command: string;
  cwd: string;
  intervalMs: number;
  timeoutMs: number;
  project: string;
  models?: string;
  days?: string;
};

export type ExecutorResult = {
  exitCode: number | null;
  output: string;
  failureReason?: string;
};

export type ProcessDetector = () => Promise<string[]>;
export type GitRemoteDetector = (projectDir: string) => Promise<string | undefined>;
export type ActiveChangeDetector = (projectDir: string, changeName: string) => Promise<boolean>;
export type ArchivedChangeDetector = (projectDir: string, changeName: string) => Promise<boolean>;
export type LocalClaimDetector = (projectDir: string, changeName: string) => Promise<boolean>;
export type LocalClaimPublishedDetector = (projectDir: string, changeName: string, branch: string) => Promise<boolean>;
export type RemoteBranchDetector = (projectDir: string, branch: string) => Promise<boolean>;
export type PullRequestDetector = (projectDir: string, branch: string) => Promise<string | undefined>;
export type MergedPullRequestDetector = (projectDir: string, branch: string) => Promise<string | undefined>;
export type TasksCompleteDetector = (projectDir: string, changeName: string) => Promise<boolean>;
type TaskCompletionStatus =
  | { kind: "complete"; tasksPath: string }
  | { kind: "incomplete"; tasksPath: string }
  | { kind: "missing" }
  | { kind: "no_checkboxes"; tasksPath: string };
export type WorktreeDependenciesReadyDetector = (projectDir: string, changeName: string) => Promise<boolean>;
export type ReconcileWorktreeDependencies = (projectDir: string, changeName: string) => Promise<string>;
export type ClaudeContractVerifier = (projectDir: string, claude: ClaudeCliOptions) => Promise<ClaudeContractResult>;
export type PrepareWorkspace = (input: PrepareWorkspaceInput) => Promise<string>;
export type RefreshDeliveryBranch = (projectDir: string, changeName: string, baseBranch: string) => Promise<string>;
export type SourceResolver = (projectDir: string, task: QueueTask, baseBranch: string) => DeliverySource;
export type PrepareWorkspaceInput = {
  projectDir: string;
  changeName: string;
  branch: string;
  worktreeDir: string;
  baseBranch: string;
  source: DeliverySource;
};
export type PushBranchAndOpenPullRequest = (input: PushBranchInput) => Promise<string>;
export type PushBranchInput = {
  projectDir: string;
  changeName: string;
  branch: string;
  worktreeDir: string;
  baseBranch: string;
};
export type CleanupWorkspace = (input: CleanupWorkspaceInput) => Promise<string>;
export type CleanupWorkspaceInput = {
  projectDir: string;
  changeName: string;
  branch: string;
  worktreeDir: string;
};
export type FinalizeArchiveInput = {
  projectDir: string;
  changeName: string;
  baseBranch: string;
};
export type FinalizeArchive = (input: FinalizeArchiveInput) => Promise<string>;
export type PrepareArchiveWorkspace = (projectDir: string, baseBranch: string) => Promise<string>;
export type RepairNativeFailure = (
  config: RunnerConfig,
  task: QueueTask,
  reason: string,
  logPath: string,
) => Promise<{ repaired: boolean; output: string }>;
export type Sleep = (ms: number) => Promise<void>;


const DEFAULT_LOOP_DELAY_MS = 5_000;
const DEFAULT_BUSY_DELAY_MS = 60_000;
const DEFAULT_TASK_TIMEOUT_MS = 90 * 60_000;
const DEFAULT_HEARTBEAT_MS = 60_000;
const LOCK_STALE_AFTER_MS = 10 * 60_000;
const requirementKeysCache = new Map<string, Set<string>>();
const reportedArchiveOrderings = new Set<string>();
const DEFAULT_STATS_INTERVAL_MS = 120_000;
const DEFAULT_STATS_TIMEOUT_MS = 10_000;
const DEFAULT_ACTIVE_EXECUTOR_ALLOWANCE = 2;
const MAX_CONSECUTIVE_IMPLEMENT_NO_PROGRESS_ATTEMPTS = 2;
const KILL_GRACE_MS = 10_000;
const SIGINT_DUPLICATE_GRACE_MS = 1_500;
const ROOT_DIR = fileURLToPath(new URL("../../..", import.meta.url));
let activeChildProcess: ReturnType<typeof spawn> | undefined;

export function defaultConfig(): RunnerConfig {
  const rootDir = ROOT_DIR;
  const projectDir = process.env.OPENSPEC_SHIPPER_PROJECT_DIR ?? process.env.PROJECT_DIR ?? discoverProjectDirSync();
  const shipperConfig = readShipperConfigSync(projectDir);
  const stateDir = process.env.OPENSPEC_SHIPPER_STATE_DIR ?? join(projectDir, DEFAULT_STATE_DIR);

  return {
    rootDir,
    projectDir,
    queuePath: process.env.OPENSPEC_SHIPPER_QUEUE_PATH ?? process.env.QUEUE_PATH ?? join(projectDir, DEFAULT_QUEUE_PATH),
    stateDir,
    baseBranch: shipperConfig?.baseBranch ?? "main",
    providerId: (process.env.OPENSPEC_SHIPPER_PROVIDER as ExecutorProviderId | undefined) ?? shipperConfig?.executor.provider ?? "opencode",
    opencodeBin: process.env.OPENSPEC_SHIPPER_OPENCODE_BIN ?? process.env.OPENCODE_BIN ?? shipperConfig?.executor.opencode.bin ?? "opencode",
    opencodeModel: optionalEnv("OPENSPEC_SHIPPER_OPENCODE_MODEL") ?? optionalEnv("OPENCODE_MODEL") ?? shipperConfig?.executor.opencode.model,
    codexBin: process.env.OPENSPEC_SHIPPER_CODEX_BIN ?? shipperConfig?.executor.codex.bin ?? "codex",
    codexModel: optionalEnv("OPENSPEC_SHIPPER_CODEX_MODEL") ?? shipperConfig?.executor.codex.model,
    codexReasoningEffort: optionalEnv("OPENSPEC_SHIPPER_CODEX_REASONING_EFFORT") ?? shipperConfig?.executor.codex.reasoningEffort,
    claudeBin: process.env.OPENSPEC_SHIPPER_CLAUDE_BIN ?? shipperConfig?.executor.claude.bin ?? "claude",
    claudeModel: optionalEnv("OPENSPEC_SHIPPER_CLAUDE_MODEL") ?? shipperConfig?.executor.claude.model,
    claudeEffort: optionalEnv("OPENSPEC_SHIPPER_CLAUDE_EFFORT") ?? shipperConfig?.executor.claude.effort,
    claudePermissionMode: optionalEnv("OPENSPEC_SHIPPER_CLAUDE_PERMISSION_MODE") ?? shipperConfig?.executor.claude.permissionMode,
    claudeMaxTurns: optionalPositiveNumber("OPENSPEC_SHIPPER_CLAUDE_MAX_TURNS") ?? shipperConfig?.executor.claude.maxTurns,
    claudeMaxBudgetUsd: optionalPositiveNumber("OPENSPEC_SHIPPER_CLAUDE_MAX_BUDGET_USD") ?? shipperConfig?.executor.claude.maxBudgetUsd,
    opencodePrintLogs: (process.env.OPENSPEC_SHIPPER_PRINT_LOGS ?? process.env.OPENCODE_PRINT_LOGS) === "1",
    opencodeLogLevel: optionalEnv("OPENSPEC_SHIPPER_LOG_LEVEL") ?? optionalEnv("OPENCODE_LOG_LEVEL"),
    opencodeStats: (process.env.OPENSPEC_SHIPPER_STATS ?? process.env.OPENCODE_STATS) === "1",
    opencodeStatsIntervalMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_STATS_INTERVAL_MS ?? process.env.OPENCODE_STATS_INTERVAL_MS, DEFAULT_STATS_INTERVAL_MS),
    opencodeStatsTimeoutMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_STATS_TIMEOUT_MS ?? process.env.OPENCODE_STATS_TIMEOUT_MS, DEFAULT_STATS_TIMEOUT_MS),
    opencodeStatsProject: process.env.OPENSPEC_SHIPPER_STATS_PROJECT ?? process.env.OPENCODE_STATS_PROJECT ?? "",
    opencodeStatsModels: optionalEnv("OPENSPEC_SHIPPER_STATS_MODELS") ?? optionalEnv("OPENCODE_STATS_MODELS"),
    opencodeStatsDays: optionalEnv("OPENSPEC_SHIPPER_STATS_DAYS") ?? optionalEnv("OPENCODE_STATS_DAYS"),
    loopDelayMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_LOOP_DELAY_MS, DEFAULT_LOOP_DELAY_MS),
    busyDelayMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_BUSY_DELAY_MS, DEFAULT_BUSY_DELAY_MS),
    taskTimeoutMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS),
    heartbeatMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS),
    maxBlockedTasks: parsePositiveInt(process.env.OPENSPEC_SHIPPER_MAX_BLOCKED_TASKS, 100),
    activeExecutorAllowance: parsePositiveInt(process.env.OPENSPEC_SHIPPER_ALLOW_ACTIVE_EXECUTOR, DEFAULT_ACTIVE_EXECUTOR_ALLOWANCE),
  };
}

export async function runQueue(mode: RunnerMode, config: RunnerConfig): Promise<number> {
  if (mode === "stop") {
    return await requestStop(config);
  }

  if (mode === "stats") {
    return printOpenCodeStats(config);
  }

  const queue = await reconcileQueue(config, await loadQueue(config.queuePath));

  if (queue.errors.length > 0) {
    console.error("Queue has invalid tasks:");
    for (const error of queue.errors) {
      console.error(`- ${error}`);
    }
    return 2;
  }

  const blockedTasks = findBlockedTasks(queue.tasks);
  const pendingTask = findFirstRunnableTask(queue.tasks);

  if (mode === "status") {
    printStatus(queue.tasks, config);
    if (await stopRequested(config)) {
      console.log(`Stop requested: ${stopPath(config)}`);
    }
    return blockedTasksExceedLimit(blockedTasks, config) ? 1 : 0;
  }

  if (blockedTasksExceedLimit(blockedTasks, config)) {
    printBlockedPause("Queue is paused", blockedTasks, config);
    return 1;
  } else if (blockedTasks.length > 0) {
    printBlockedSkip("Queue has blocked task(s), continuing within configured limit", blockedTasks, config);
  }

  if (!pendingTask) {
    const waitingTasks = findWaitingTasks(queue.tasks);
    if (waitingTasks.length > 0) {
      console.log(`Queue waiting: ${waitingTasks.length} pending task(s) waiting for dependencies.`);
      for (const task of waitingTasks) {
        console.log(`- ${task.rawCommand} ${waitingReason(task)}`);
      }
      return 0;
    }

    console.log("Queue idle: no pending tasks.");
    return 0;
  }

  if (mode === "dry-run") {
    console.log(`Next task: ${pendingTask.rawCommand}`);
    const preflight = await validateTaskPreflight(config, pendingTask);
    console.log(`Provider asset: ${preflight.commandPath}`);
    if (!preflight.ok) {
      console.log(`Preflight: ${preflight.reason}`);
      return 1;
    }

    if (isNativeTask(pendingTask)) {
      console.log(`Native: ${describeNativeTask(pendingTask)}`);
      console.log(`Cwd: ${config.projectDir}`);
    } else {
      const providerCommand = buildConfiguredProviderCommand(config, pendingTask);
      console.log(`Command: ${formatCommand(providerCommand.command, providerCommand.args)}`);
      console.log(`Cwd: ${providerCommand.cwd}`);
    }
    if (!isNativeTask(pendingTask) && config.opencodeStats) {
      console.log(`Stats: ${formatStatsPolling(config)}`);
    }

    console.log("Preflight: ok");
    return 0;
  }

  if (mode === "run") {
    return await runLoopWithLock(config);
  }

  return await runSingleTaskWithLock(config, queue.lines, pendingTask);
}

async function runSingleTaskWithLock(
  config: RunnerConfig,
  lines: string[],
  task: QueueTask,
): Promise<number> {
  const lockPath = join(config.stateDir, "shipper.lock");
  const lock = await acquireLock(config, lockPath, task.rawCommand, "immediate");
  if (!lock.acquired) {
    return 1;
  }

  try {
    const checkedAt = await markTaskAsChecking(config, lines, task);

    const preflight = await blockOnFailedPreflight(config, lines, task);
    if (preflight.blocked) {
      return 1;
    }

    if (!isNativeTask(task)) {
      const processCheck = await checkActiveExecutor(config);
      if (processCheck.busy) {
        console.error(`Queue busy before spending tokens: ${processCheck.reason}`);
        return 1;
      }
    }

    return isNativeTask(task)
      ? await executeNativeTask(config, lines, task, { checkedAt })
      : await executeTask(config, lines, task, buildConfiguredProviderCommand(config, task), { checkedAt });
  } finally {
    await lock.release();
  }
}

async function runLoopWithLock(config: RunnerConfig): Promise<number> {
  const lockPath = join(config.stateDir, "shipper.lock");
  const lock = await acquireLock(config, lockPath, "queue:run", "graceful");
  if (!lock.acquired) {
    return 1;
  }

  const sleep = config.sleep ?? defaultSleep;
  let completedThisRun = 0;
  let busyState: { reason: string; firstSeenAt: number; checks: number } | undefined;

  try {
    console.log("Queue run started. Use `bun run queue:stop` to stop at the next safe checkpoint.");
    console.log("Press Ctrl-C only when you want to interrupt this runner immediately.");
    await clearStopRequest(config);

    while (true) {
      if (await stopRequested(config)) {
        console.log("Queue stop requested. Exiting before starting another task.");
        return 0;
      }

      const queue = await reconcileQueue(config, await loadQueue(config.queuePath));
      if (queue.errors.length > 0) {
        console.error("Queue has invalid tasks:");
        for (const error of queue.errors) {
          console.error(`- ${error}`);
        }
        return 2;
      }

      const blockedTasks = findBlockedTasks(queue.tasks);
      if (blockedTasksExceedLimit(blockedTasks, config)) {
        printBlockedPause("Queue paused", blockedTasks, config);
        return completedThisRun > 0 ? 0 : 1;
      } else if (blockedTasks.length > 0) {
        printBlockedSkip("Queue has blocked task(s), continuing within configured limit", blockedTasks, config);
      }

      const pendingTask = findFirstRunnableTask(queue.tasks);
      if (!pendingTask) {
        const waitingTasks = findWaitingTasks(queue.tasks);
        if (waitingTasks.length > 0) {
          console.log(`Queue waiting: ${waitingTasks.length} pending task(s) waiting for dependencies.`);
          for (const task of waitingTasks) {
            console.log(`- ${task.rawCommand} ${waitingReason(task)}`);
          }
          return 0;
        }

        console.log("Queue complete: no pending tasks.");
        return 0;
      }

      const checkedAt = await markTaskAsChecking(config, queue.lines, pendingTask);

      const preflight = await blockOnFailedPreflight(config, queue.lines, pendingTask);
      if (preflight.blocked) {
        const nextQueue = await loadQueue(config.queuePath);
        const nextBlockedTasks = findBlockedTasks(nextQueue.tasks);
        if (blockedTasksExceedLimit(nextBlockedTasks, config)) {
          printBlockedPause("Queue paused", nextBlockedTasks, config);
          return completedThisRun > 0 ? 0 : 1;
        }

        printBlockedSkip("Preflight blocked a task, continuing within configured limit", nextBlockedTasks, config);
        continue;
      }

      if (!isNativeTask(pendingTask)) {
        const processCheck = await checkActiveExecutor(config);
        if (processCheck.busy) {
          busyState = printBusyWait(processCheck.reason, busyState, config.busyDelayMs);
          if (await waitOrStop(config, sleep, config.busyDelayMs)) {
            console.log("Queue stop requested. Exiting while waiting for active executor process.");
            return 0;
          }
          continue;
        }
      }

      busyState = undefined;
      const exitCode = isNativeTask(pendingTask)
        ? await executeNativeTask(config, queue.lines, pendingTask, { checkedAt })
        : await executeTask(config, queue.lines, pendingTask, buildConfiguredProviderCommand(config, pendingTask), { checkedAt });
      if (exitCode !== 0) {
        const nextQueue = await loadQueue(config.queuePath);
        const nextBlockedTasks = findBlockedTasks(nextQueue.tasks);
        if (!blockedTasksExceedLimit(nextBlockedTasks, config)) {
          printBlockedSkip("Task blocked, continuing within configured limit", nextBlockedTasks, config);
          continue;
        }

        return exitCode;
      }

      completedThisRun += 1;
      console.log(`Completed ${completedThisRun} task(s) in this run.`);

      if (await stopRequested(config)) {
        console.log("Queue stop requested. Exiting after completed task.");
        return 0;
      }

      const nextQueue = await loadQueue(config.queuePath);
      if (
        blockedTasksExceedLimit(findBlockedTasks(nextQueue.tasks), config) ||
        !findFirstRunnableTask(nextQueue.tasks)
      ) {
        continue;
      }

      console.log(`Waiting ${formatDuration(config.loopDelayMs)} before the next task...`);
      if (await waitOrStop(config, sleep, config.loopDelayMs)) {
        console.log("Queue stop requested. Exiting before starting another task.");
        return 0;
      }
    }
  } finally {
    await lock.release();
  }
}

async function acquireLock(
  config: RunnerConfig,
  lockPath: string,
  task: string,
  interruptMode: "graceful" | "immediate",
): Promise<{ acquired: true; release: () => Promise<void> } | { acquired: false }> {
  await mkdir(config.stateDir, { recursive: true });
  const lockId = randomUUID();
  const startedAt = new Date().toISOString();
  const lock: ShipperLock = {
    version: 1,
    lockId,
    pid: process.pid,
    hostname: hostname(),
    startedAt,
    heartbeatAt: startedAt,
    task,
  };

  while (true) {
    try {
      const handle = await open(lockPath, "wx");
      try {
        await handle.writeFile(serializeLock(lock));
      } finally {
        await handle.close();
      }
      break;
    } catch (error) {
      if (!isNodeError(error, "EEXIST")) {
        throw error;
      }

      const stale = await recoverStaleLock(lockPath);
      if (!stale.recovered) {
        console.log(`Queue is already running: ${stale.reason} (${lockPath})`);
        return { acquired: false };
      }
      console.log(`Recovered stale queue lock: ${stale.reason} (${lockPath})`);
    }
  }

  let released = false;
  const lockHeartbeatMs = config.heartbeatMs > 0 ? config.heartbeatMs : DEFAULT_HEARTBEAT_MS;
  const lockHeartbeat = setInterval(() => {
    void refreshOwnedLock(lockPath, lock).catch(() => undefined);
  }, lockHeartbeatMs);
  lockHeartbeat.unref?.();
  let gracefulStopRequested = false;
  let forceInterruptAllowedAt = 0;
  const signalHandler = (signal: NodeJS.Signals) => {
    if (signal === "SIGINT" && interruptMode === "graceful" && !gracefulStopRequested) {
      gracefulStopRequested = true;
      forceInterruptAllowedAt = Date.now() + SIGINT_DUPLICATE_GRACE_MS;
      requestStopSync(config);
      console.error("\nStop requested. The queue will stop at the next safe checkpoint.");
      console.error("Press Ctrl-C again after a moment to interrupt immediately.");
      return;
    }

    if (signal === "SIGINT" && interruptMode === "graceful" && Date.now() < forceInterruptAllowedAt) {
      return;
    }

    terminateActiveChild("SIGTERM");

    if (!released) {
      removeOwnedLockSync(lockPath, lockId);
    }

    console.error(`\nReceived ${signal}; removed orchestrator lock and interrupted the runner.`);
    process.exit(signal === "SIGINT" ? 130 : 143);
  };

  process.on("SIGINT", signalHandler);
  process.on("SIGTERM", signalHandler);

  return {
    acquired: true,
    release: async () => {
      released = true;
      clearInterval(lockHeartbeat);
      process.removeListener("SIGINT", signalHandler);
      process.removeListener("SIGTERM", signalHandler);
      await removeOwnedLock(lockPath, lockId);
    },
  };
}

type ShipperLock = {
  version?: number;
  lockId?: string;
  pid?: number;
  hostname?: string;
  startedAt?: string;
  heartbeatAt?: string;
  task?: string;
};

async function recoverStaleLock(lockPath: string): Promise<{ recovered: boolean; reason: string }> {
  const snapshot = await readLockSnapshot(lockPath);
  if (!snapshot) {
    return { recovered: true, reason: "lock disappeared while checking it" };
  }

  const sameHost = !snapshot.lock.hostname || snapshot.lock.hostname === hostname();
  if (!sameHost) {
    return { recovered: false, reason: `lock belongs to ${snapshot.lock.hostname}` };
  }

  const processState = lockProcessState(snapshot.lock.pid);
  const heartbeatAt = Date.parse(snapshot.lock.heartbeatAt ?? snapshot.lock.startedAt ?? "");
  const heartbeatAge = Number.isFinite(heartbeatAt) ? Date.now() - heartbeatAt : Date.now() - snapshot.mtimeMs;
  let reason: string | undefined;
  if (processState === "dead") {
    reason = `PID ${snapshot.lock.pid} is no longer running`;
  } else if (processState !== "alive" && heartbeatAge > LOCK_STALE_AFTER_MS) {
    reason = `heartbeat is older than ${formatDuration(LOCK_STALE_AFTER_MS)}`;
  }

  if (!reason) {
    const detail = processState === "alive"
      ? `PID ${snapshot.lock.pid} is still running`
      : `heartbeat is ${formatDuration(Math.max(0, heartbeatAge))} old`;
    return { recovered: false, reason: detail };
  }

  const recoveryPath = `${lockPath}.stale-${process.pid}-${randomUUID()}`;
  try {
    await rename(lockPath, recoveryPath);
    await rm(recoveryPath, { force: true });
    return { recovered: true, reason };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return { recovered: true, reason: "another runner recovered the stale lock" };
    }
    throw error;
  }
}

async function refreshOwnedLock(lockPath: string, lock: ShipperLock): Promise<void> {
  const current = await readLockSnapshot(lockPath);
  if (!current || current.lock.lockId !== lock.lockId) {
    return;
  }
  lock.heartbeatAt = new Date().toISOString();
  const heartbeatPath = `${lockPath}.heartbeat-${lock.lockId}`;
  await writeFile(heartbeatPath, serializeLock(lock));
  const latest = await readLockSnapshot(lockPath);
  if (latest?.lock.lockId === lock.lockId) {
    await rename(heartbeatPath, lockPath);
  } else {
    await rm(heartbeatPath, { force: true });
  }
}

async function removeOwnedLock(lockPath: string, lockId: string): Promise<void> {
  const current = await readLockSnapshot(lockPath);
  if (current?.lock.lockId === lockId) {
    await rm(lockPath, { force: true });
  }
}

function removeOwnedLockSync(lockPath: string, lockId: string): void {
  try {
    const lock = JSON.parse(readFileSync(lockPath, "utf8")) as ShipperLock;
    if (lock.lockId === lockId) {
      rmSync(lockPath, { force: true });
    }
  } catch {
    // A missing or replaced lock no longer belongs to this runner.
  }
}

async function readLockSnapshot(lockPath: string): Promise<{ lock: ShipperLock; mtimeMs: number } | undefined> {
  try {
    const [raw, metadata] = await Promise.all([readFile(lockPath, "utf8"), stat(lockPath)]);
    return { lock: JSON.parse(raw) as ShipperLock, mtimeMs: metadata.mtimeMs };
  } catch (error) {
    if (isNodeError(error, "ENOENT")) {
      return undefined;
    }
    if (error instanceof SyntaxError) {
      const metadata = await stat(lockPath).catch(() => undefined);
      return metadata ? { lock: {}, mtimeMs: metadata.mtimeMs } : undefined;
    }
    throw error;
  }
}

function lockProcessState(pid: number | undefined): "alive" | "dead" | "unknown" {
  if (!Number.isSafeInteger(pid) || !pid || pid < 1) {
    return "unknown";
  }
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (isNodeError(error, "ESRCH")) {
      return "dead";
    }
    if (isNodeError(error, "EPERM")) {
      return "alive";
    }
    return "unknown";
  }
}

function serializeLock(lock: ShipperLock): string {
  return `${JSON.stringify(lock, null, 2)}\n`;
}

function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}

async function checkActiveExecutor(config: RunnerConfig): Promise<{ busy: false } | { busy: true; reason: string }> {
  const currentProvider = provider(config);
  const detector = config.processDetector ?? (() => detectActiveExecutorProcesses(currentProvider.activeProcessNames));
  const activeProcesses = await detector();
  const allowance = config.activeExecutorAllowance ?? DEFAULT_ACTIVE_EXECUTOR_ALLOWANCE;
  if (activeProcesses.length <= allowance) {
    return { busy: false };
  }

  return {
    busy: true,
    reason: `active ${currentProvider.displayName} process(es): ${activeProcesses.length} found, ${allowance} allowed\n${activeProcesses.map((process) => `- ${process}`).join("\n")}`,
  };
}

async function blockOnFailedPreflight(
  config: RunnerConfig,
  lines: string[],
  task: QueueTask,
): Promise<{ blocked: boolean }> {
  const preflight = await validateTaskPreflight(config, task);
  if (preflight.ok) {
    return { blocked: false };
  }

  await blockTask(config.queuePath, lines, task, config, preflight.reason);
  console.error(`Queue paused before spending tokens: ${preflight.reason}`);
  return { blocked: true };
}

async function validateTaskPreflight(
  config: RunnerConfig,
  task: QueueTask,
): Promise<{ ok: true; commandPath: string } | { ok: false; commandPath: string; reason: string }> {
  const phase = deliverPhase(task);
  const currentProvider = provider(config);
  const commandName =
    currentProvider.id === "opencode" && !isNativePhase(phase) ? openCodeCommandName(phase) : "";
  const commandPath =
    isNativePhase(phase)
      ? `(native ${phase} phase)`
      : currentProvider.id === "opencode"
      ? openCodeCommandPath(config.projectDir, phase)
      : currentProvider.id === "codex-cli"
      ? codexPromptPath(config.projectDir, phase)
      : claudePromptPath(config.projectDir, phase);

  if (phase === "prepare_worktree") {
    const prepareBlocker = await validatePrepareCanCreateWorktree(config, task);
    return prepareBlocker ? { ok: false, commandPath, reason: prepareBlocker } : { ok: true, commandPath };
  }

  if (phase === "push") {
    const pushBlocker = await validateNativePush(config, task);
    return pushBlocker ? { ok: false, commandPath, reason: pushBlocker } : { ok: true, commandPath };
  }

  if (phase === "implement" && task.change) {
    const status = await detectTaskCompletionStatus(config.projectDir, task.change);
    if (status.kind === "no_checkboxes") {
      return {
        ok: false,
        commandPath,
        reason: "tasks.md has no task checkboxes; OpenSpec Shipper cannot track completion. Use markdown checkboxes such as - [ ] and - [x].",
      };
    }
  }

  if (["refresh_branch", "publish_archive", "waiting_for_archive_merge", "cleanup_worktree"].includes(phase)) {
    return { ok: true, commandPath };
  }

  if (phase === "archive" && readShipperConfigSync(config.projectDir)?.safety.enableArchive === false) {
    return {
      ok: false,
      commandPath,
      reason: "OpenSpec Shipper archive safety is disabled in .openspec-shipper/config.json.",
    };
  }

  if (currentProvider.id === "codex-cli") {
    const workflowPath = codexWorkflowPath(config.projectDir);
    if (!(await fileExists(workflowPath))) {
      return {
        ok: false,
        commandPath: workflowPath,
        reason: `Codex workflow file not found at ${workflowPath}. Run openspec-shipper init --provider codex-cli.`,
      };
    }

    if (!(await fileExists(commandPath))) {
      return {
        ok: false,
        commandPath,
        reason: `Codex prompt file not found at ${commandPath}. Run openspec-shipper init --provider codex-cli.`,
      };
    }

    return { ok: true, commandPath };
  }

  if (currentProvider.id === "claude-code") {
    const requiredAssets = [claudeWorkflowPath(config.projectDir), claudeSettingsPath(config.projectDir), commandPath];
    for (const path of requiredAssets) {
      if (!(await fileExists(path))) {
        return {
          ok: false,
          commandPath,
          reason: `Claude Code provider asset not found at ${path}. Run openspec-shipper init --provider claude-code.`,
        };
      }
    }
    const verifier = config.claudeContractVerifier
      ?? ((projectDir: string, claude: ClaudeCliOptions) => verifyClaudeCliContract({ projectDir, claude }));
    const contract = await verifier(config.projectDir, configuredClaudeOptions(config)).catch((cause: unknown) => ({
      ok: false,
      cached: false,
      message: cause instanceof Error ? cause.message : String(cause),
    }));
    if (!contract.ok) {
      return {
        ok: false,
        commandPath,
        reason: `CLI contract check failed: ${contract.message}`,
      };
    }
    return { ok: true, commandPath };
  }

  if (commandName.startsWith("/")) {
    return {
      ok: false,
      commandPath,
      reason: `OpenCode command names must not start with slash: ${commandName}`,
    };
  }

  if (!(await fileExists(commandPath))) {
    return {
      ok: false,
      commandPath,
      reason: `OpenCode command file not found at ${commandPath}. Check OPENSPEC_SHIPPER_PROJECT_DIR and command name.`,
    };
  }

  return { ok: true, commandPath };
}

async function gitRemoteOrigin(config: RunnerConfig): Promise<string | undefined> {
  const detector = config.gitRemoteDetector ?? detectGitRemoteOrigin;
  return await detector(config.projectDir);
}

async function validatePrepareCanCreateWorktree(config: RunnerConfig, task: QueueTask): Promise<string | undefined> {
  const phase = task.action === "deliver" ? deliverPhase(task) : task.action;
  if (phase !== "prepare_worktree" || !task.change) {
    return undefined;
  }

  const localClaimDetector = config.localClaimDetector ?? changeHasExistingLocalClaim;
  if (await localClaimDetector(config.projectDir, task.change)) {
    return undefined;
  }

  try {
    const resolver = config.sourceResolver ?? resolveDeliverySource;
    resolver(config.projectDir, task, configuredBaseBranch(config));
    return undefined;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

async function validateNativePush(config: RunnerConfig, task: QueueTask): Promise<string | undefined> {
  if (!task.change) {
    return "Push requires a change name.";
  }

  if (!config.pushBranchAndOpenPullRequest) {
    if (!(await gitRemoteOrigin(config))) {
      return "Git remote origin is not configured; cannot push branch or open PR.";
    }

    const ghVersion = commandResult("gh", ["--version"], config.projectDir);
    if (!ghVersion.ok) {
      return `GitHub CLI is required to open pull requests: ${ghVersion.reason}. Run gh auth login, then openspec-shipper doctor.`;
    }

    const ghAuth = commandResult("gh", ["auth", "status"], config.projectDir);
    if (!ghAuth.ok) {
      return `GitHub CLI is not authenticated: ${ghAuth.reason}. Run gh auth login, then openspec-shipper doctor.`;
    }

    const gitIdentity = checkGitIdentity(config.projectDir);
    if (!gitIdentity.ok) {
      return gitIdentity.reason;
    }
  }

  const worktreeDir = task.deliveryWorktree
    ? join(config.projectDir, task.deliveryWorktree)
    : join(config.projectDir, "worktrees", task.change);
  if (!config.pushBranchAndOpenPullRequest && !(await pathExists(worktreeDir))) {
    return `Prepared worktree missing for ${task.change}; cannot push or open a PR.`;
  }

  const tasksCompleteDetector = config.tasksCompleteDetector ?? detectTasksComplete;
  const worktreeDependenciesReadyDetector = config.worktreeDependenciesReadyDetector ?? detectWorktreeDependenciesReady;
  if (!config.tasksCompleteDetector) {
    const status = await detectTaskCompletionStatus(config.projectDir, task.change);
    if (status.kind === "no_checkboxes") {
      return `tasks.md has no task checkboxes; OpenSpec Shipper cannot track completion. Use markdown checkboxes such as - [ ] and - [x].`;
    }
  }
  if (!(await tasksCompleteDetector(config.projectDir, task.change))) {
    return `Implementation tasks are not complete for ${task.change}; cannot push or open a PR.`;
  }
  if (!(await worktreeDependenciesReadyDetector(config.projectDir, task.change))) {
    return `Worktree dependencies are not installed for ${task.change}; return the task to prepare_worktree.`;
  }
  const branch = task.deliveryBranch ?? detectChangeBranch(config.projectDir, task.change);
  const canonicalSpecDiff = spawnSync(
    "git",
    ["-C", worktreeDir, "diff", "--name-only", `origin/${configuredBaseBranch(config)}...HEAD`, "--", "openspec/specs"],
    { encoding: "utf8" },
  );
  if (canonicalSpecDiff.status === 0 && canonicalSpecDiff.stdout.trim()) {
    return `Implementation branch ${branch} modifies canonical openspec/specs. Canonical specs may only be written by the archive phase.`;
  }
  if (!(readShipperConfigSync(config.projectDir) ?? defaultShipperConfig()).checks.openspec.trim()) {
    return "checks.openspec is not configured in .openspec-shipper/config.json; cannot validate OpenSpec before push.";
  }

  return undefined;
}

function configuredBaseBranch(config: RunnerConfig): string {
  return config.baseBranch ?? "main";
}

async function executeTask(
  config: RunnerConfig,
  lines: string[],
  task: QueueTask,
  providerCommand: ProviderCommand,
  activity: { checkedAt?: string } = {},
): Promise<number> {
  if (deliverPhase(task) === "archive") {
    const preparer = config.prepareArchiveWorkspace ?? prepareArchiveIntegrationWorkspace;
    await preparer(config.projectDir, configuredBaseBranch(config));
  }
  const startedAt = (config.now?.() ?? new Date()).toISOString();
  const logPath = await createRunLogPath(config, task, startedAt);
  const executor = config.executor ?? spawnExecutor;

  console.log(`[${startedAt}] running: ${task.rawCommand}`);
  console.log(`Command: ${formatCommand(providerCommand.command, providerCommand.args)}`);
  console.log(`Cwd: ${providerCommand.cwd}`);
  console.log(`Env PWD: ${providerCommand.cwd}`);
  console.log(`Log: ${toMarkdownPath(relative(config.projectDir, logPath))}`);

  const relativeLogPath = toMarkdownPath(relative(dirname(config.queuePath), logPath));
  const implementProgressBefore = await captureImplementProgress(config, task);
  const runningContent = markTaskRunning(lines, task, {
    timestamp: startedAt,
    logPath: relativeLogPath,
  });
  await writeFile(config.queuePath, runningContent);

  const result = await executor(providerCommand.command, providerCommand.args, {
    cwd: providerCommand.cwd,
    logPath,
    timeoutMs: config.taskTimeoutMs,
    heartbeatMs: config.heartbeatMs,
    stdin: providerCommand.stdin,
    env: providerCommand.env,
    stats: buildStatsOptions(config),
  }).catch((error: unknown): ExecutorResult => ({
    exitCode: null,
    output: "",
    failureReason: error instanceof Error ? error.message : String(error),
  }));

  const failureSignal = provider(config).detectFailureSignal(result.output);
  if (result.exitCode === 0 && !failureSignal) {
    if (task.action === "deliver" && deliverPhase(task) === "implement" && task.change) {
      const implementProgressAfter = await captureImplementProgress(config, task);
      if (
        implementProgressBefore &&
        implementProgressAfter &&
        !hasObservableImplementProgress(implementProgressBefore, implementProgressAfter)
      ) {
        const attempts = Number(task.metadata.implement_no_progress_attempts ?? "0") + 1;
        const reason = "Implement completed without observable progress: no commits, task updates, or worktree changes were produced.";
        await appendFile(logPath, `\n## Implement progress check failed\n\n${reason}\n`);
        if (attempts < MAX_CONSECUTIVE_IMPLEMENT_NO_PROGRESS_ATTEMPTS) {
          const retryTask: QueueTask = {
            ...task,
            metadata: { ...task.metadata, implement_no_progress_attempts: String(attempts) },
          };
          const retryContent = advanceDeliverTaskToPhase(lines, retryTask, "implement", {
            timestamp: (config.now?.() ?? new Date()).toISOString(),
            logPath: relativeLogPath,
            checkedAt: activity.checkedAt,
            startedAt,
          });
          await writeFile(config.queuePath, retryContent);
          console.warn(`[${new Date().toISOString()}] no observable implement progress; retrying once before blocking: ${task.rawCommand}`);
          return 0;
        }
        const nextContent = markTask(lines, task, "blocked", {
          timestamp: (config.now?.() ?? new Date()).toISOString(),
          reason,
          logPath: relativeLogPath,
          checkedAt: activity.checkedAt,
          startedAt,
        });
        await writeFile(config.queuePath, nextContent);
        console.error(`[${new Date().toISOString()}] blocked: ${reason}`);
        return 1;
      }

      try {
        const reconciler = config.reconcileWorktreeDependencies ?? reconcileWorktreeDependencies;
        const dependencyOutput = await reconciler(config.projectDir, task.change);
        await appendFile(logPath, `\n## Native dependency reconciliation\n\n${dependencyOutput}`);
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const logOutput = error instanceof NativeTaskError ? error.logOutput : `${reason}\n`;
        await appendFile(logPath, `\n## Native dependency reconciliation failed\n\n${logOutput}`);
        const nextContent = markTask(lines, task, "blocked", {
          timestamp: (config.now?.() ?? new Date()).toISOString(),
          reason,
          logPath: relativeLogPath,
          checkedAt: activity.checkedAt,
          startedAt,
        });
        await writeFile(config.queuePath, nextContent);
        console.error(`[${new Date().toISOString()}] blocked: ${reason}`);
        return 1;
      }
    }

    const completedTask = task.metadata.implement_no_progress_attempts
      ? {
          ...task,
          metadata: Object.fromEntries(
            Object.entries(task.metadata).filter(([key]) => key !== "implement_no_progress_attempts"),
          ),
        }
      : task;
    const nextContent = advanceDeliverTask(lines, completedTask, {
      timestamp: (config.now?.() ?? new Date()).toISOString(),
      logPath: relativeLogPath,
      checkedAt: activity.checkedAt,
      startedAt,
    });
    await writeFile(config.queuePath, nextContent);
    console.log(`[${new Date().toISOString()}] completed: ${task.rawCommand}`);
    return 0;
  }

  if (task.action === "deliver" && deliverPhase(task) === "implement" && task.change) {
    const readinessDetector = config.worktreeDependenciesReadyDetector ?? detectWorktreeDependenciesReady;
    if (!(await readinessDetector(config.projectDir, task.change))) {
      try {
        const reconciler = config.reconcileWorktreeDependencies ?? reconcileWorktreeDependencies;
        const dependencyOutput = await reconciler(config.projectDir, task.change);
        await appendFile(logPath, `\n## Native dependency recovery\n\n${dependencyOutput}`);
        const retryContent = advanceDeliverTaskToPhase(lines, task, "implement", {
          timestamp: (config.now?.() ?? new Date()).toISOString(),
          logPath: relativeLogPath,
          checkedAt: activity.checkedAt,
          startedAt,
        });
        await writeFile(config.queuePath, retryContent);
        console.log(`[${new Date().toISOString()}] dependencies refreshed; implement will retry: ${task.rawCommand}`);
        return 0;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        const logOutput = error instanceof NativeTaskError ? error.logOutput : `${reason}\n`;
        await appendFile(logPath, `\n## Native dependency recovery failed\n\n${logOutput}`);
        const blockedContent = markTask(lines, task, "blocked", {
          timestamp: (config.now?.() ?? new Date()).toISOString(),
          reason,
          logPath: relativeLogPath,
          checkedAt: activity.checkedAt,
          startedAt,
        });
        await writeFile(config.queuePath, blockedContent);
        console.error(`[${new Date().toISOString()}] blocked: ${reason}`);
        return 1;
      }
    }
  }

  const reason =
    failureSignal ?? result.failureReason ?? (result.exitCode === null ? result.output : `command exited with code ${result.exitCode}`);
  const nextContent = markTask(lines, task, "blocked", {
    timestamp: (config.now?.() ?? new Date()).toISOString(),
    reason,
    logPath: relativeLogPath,
    checkedAt: activity.checkedAt,
    startedAt,
  });
  await writeFile(config.queuePath, nextContent);
  console.error(`[${new Date().toISOString()}] blocked: ${reason}`);
  return 1;
}

type ImplementProgressSnapshot = {
  head: string;
  tasksFingerprint: string;
  worktreeFingerprint: string;
};

async function captureImplementProgress(
  config: RunnerConfig,
  task: QueueTask,
): Promise<ImplementProgressSnapshot | undefined> {
  if (task.action !== "deliver" || deliverPhase(task) !== "implement" || !task.change) {
    return undefined;
  }

  const worktreeDir = join(config.projectDir, "worktrees", task.change);
  if (!(await pathExists(worktreeDir))) {
    return undefined;
  }

  const head = spawnSync("git", ["-C", worktreeDir, "rev-parse", "HEAD"], {
    env: childEnvForCwd(worktreeDir),
    encoding: "utf8",
  });
  const diff = spawnSync("git", ["-C", worktreeDir, "diff", "--binary", "HEAD"], {
    env: childEnvForCwd(worktreeDir),
  });
  const untracked = spawnSync("git", ["-C", worktreeDir, "ls-files", "--others", "--exclude-standard", "-z"], {
    env: childEnvForCwd(worktreeDir),
  });
  if (head.status !== 0 || diff.status !== 0 || untracked.status !== 0) {
    return undefined;
  }

  const tasksPath = await firstExistingPath([
    join(worktreeDir, "openspec", "changes", task.change, "tasks.md"),
    join(config.projectDir, "openspec", "changes", task.change, "tasks.md"),
  ]);
  const tasksContent = tasksPath ? await readFile(tasksPath).catch(() => Buffer.alloc(0)) : Buffer.alloc(0);
  const worktreeHash = createHash("sha256").update(diff.stdout ?? Buffer.alloc(0));
  const untrackedPaths = (untracked.stdout ?? Buffer.alloc(0)).toString().split("\0").filter(Boolean).sort();
  for (const relativePath of untrackedPaths) {
    worktreeHash.update(relativePath);
    worktreeHash.update(await readFile(join(worktreeDir, relativePath)).catch(() => Buffer.alloc(0)));
  }

  return {
    head: head.stdout.trim(),
    tasksFingerprint: createHash("sha256").update(tasksContent).digest("hex"),
    worktreeFingerprint: worktreeHash.digest("hex"),
  };
}

function hasObservableImplementProgress(
  before: ImplementProgressSnapshot,
  after: ImplementProgressSnapshot,
): boolean {
  return (
    before.head !== after.head ||
    before.tasksFingerprint !== after.tasksFingerprint ||
    before.worktreeFingerprint !== after.worktreeFingerprint
  );
}

async function reconcileQueue(
  config: RunnerConfig,
  queue: Awaited<ReturnType<typeof loadQueue>>,
): Promise<Awaited<ReturnType<typeof loadQueue>>> {
  const originalContent = queue.lines.join("\n");
  let content = removeRetryHintsForUnblockedTasks(originalContent);
  let changed = content !== originalContent;
  let cursor = 0;

  while (true) {
    const currentQueue = parseQueue(content);
    const currentTask = currentQueue.tasks.find((candidate) => {
      return (
        candidate.lineIndex >= cursor &&
        candidate.status === "pending" &&
        candidate.action === "deliver" &&
        Boolean(candidate.change)
      );
    });
    if (!currentTask) {
      break;
    }
    cursor = currentTask.lineIndex + 1;

    if (sourceHasNewerChangeCommit(config.projectDir, currentTask)) {
      console.warn(
        `Planning source ${currentTask.sourceBranch} has newer commits for ${currentTask.change}; delivery remains pinned to ${currentTask.sourceCommit?.slice(0, 8)}.`,
      );
    }

    const evidence = await collectDeliveryEvidence(config, currentTask);
    const decision = reconcileDeliveryTask(currentTask, evidence);
    if (decision.kind === "transition" && decision.phase !== deliverPhase(currentTask)) {
      const timestamp = (config.now?.() ?? new Date()).toISOString();
      const interventionUrl = decision.phase === "waiting_for_archive_merge"
        ? evidence.archivePullRequestUrl
        : evidence.pullRequestUrl;
      content = shipResultRequiresHuman(decision.phase)
        ? markTask(currentQueue.lines, {
            ...currentTask,
            phase: decision.phase,
            pullRequestUrl: decision.phase === "waiting_for_merge" ? interventionUrl : currentTask.pullRequestUrl,
            archivePullRequestUrl: decision.phase === "waiting_for_archive_merge" ? interventionUrl : currentTask.archivePullRequestUrl,
          }, "blocked", {
            timestamp,
            reason: humanInterventionReason(decision.phase, interventionUrl),
            pullRequestUrl: interventionUrl,
          })
        : advanceDeliverTaskToPhase(currentQueue.lines, currentTask, decision.phase, {
            timestamp,
          });
      changed = true;
    } else if (decision.kind === "blocked") {
      content = markTask(currentQueue.lines, currentTask, "blocked", {
        timestamp: (config.now?.() ?? new Date()).toISOString(),
        reason: decision.reason,
      });
      changed = true;
    } else if (decision.kind === "done") {
      content = markTask(currentQueue.lines, { ...currentTask, phase: decision.phase }, "done", {
        timestamp: (config.now?.() ?? new Date()).toISOString(),
      });
      changed = true;
    }
  }

  if (!changed) {
    return await applyInferredArchiveDependencies(config, queue);
  }

  await writeFile(config.queuePath, content);
  return await applyInferredArchiveDependencies(config, await loadQueue(config.queuePath));
}

async function applyInferredArchiveDependencies(
  config: RunnerConfig,
  queue: Awaited<ReturnType<typeof loadQueue>>,
): Promise<Awaited<ReturnType<typeof loadQueue>>> {
  const requirements = new Map<string, Set<string>>();
  for (const task of queue.tasks) {
    if (!task.change) {
      continue;
    }
    requirements.set(task.change, await requirementKeysForTask(config, task));
  }

  const tasks: QueueTask[] = [];
  for (let index = 0; index < queue.tasks.length; index += 1) {
    const task = queue.tasks[index]!;
    if (!task.change || task.status === "done" || task.archiveAfterDeclared) {
      tasks.push({ ...task, inferredArchiveAfter: [], inferredArchiveReasons: {} });
      continue;
    }
    const own = requirements.get(task.change) ?? new Set<string>();
    if (own.size === 0) {
      tasks.push({ ...task, inferredArchiveAfter: [], inferredArchiveReasons: {} });
      continue;
    }
    const inferred = new Set<string>();
    const inferredReasons: Record<string, string[]> = {};
    for (const previous of queue.tasks.slice(0, index)) {
      if (
        !previous.change ||
        previous.status === "done" ||
        deliverPhase(previous) === "cleanup_worktree" ||
        task.dependsOn.includes(previous.change)
      ) {
        continue;
      }
      const previousRequirements = requirements.get(previous.change) ?? new Set<string>();
      const shared = [...own].filter((key) => previousRequirements.has(key));
      if (shared.length > 0) {
        inferred.add(previous.change);
        inferredReasons[previous.change] = shared.map(displayRequirementKey);
      }
    }
    const inferredArchiveAfter = [...inferred];
    if (inferredArchiveAfter.length > 0) {
      await reportInferredArchiveOrdering(config, task.change, inferredArchiveAfter, inferredReasons);
    }
    tasks.push({ ...task, inferredArchiveAfter, inferredArchiveReasons: inferredReasons });
  }
  return { ...queue, tasks };
}

async function requirementKeysForTask(config: RunnerConfig, task: QueueTask): Promise<Set<string>> {
  const changeName = task.change!;
  const worktreeSpecs = join(config.projectDir, "worktrees", changeName, "openspec", "changes", changeName, "specs");
  if (await pathExists(worktreeSpecs)) {
    const worktreeDir = join(config.projectDir, "worktrees", changeName);
    const cacheKey = cleanWorktreeRequirementCacheKey(worktreeDir, worktreeSpecs, changeName);
    if (cacheKey && requirementKeysCache.has(cacheKey)) {
      return new Set(requirementKeysCache.get(cacheKey));
    }
    const keys = await requirementKeysFromDirectory(worktreeSpecs);
    if (cacheKey) {
      requirementKeysCache.set(cacheKey, new Set(keys));
    }
    return keys;
  }

  try {
    const commit = task.sourceCommit
      ?? (config.sourceResolver ?? resolveDeliverySource)(config.projectDir, task, configuredBaseBranch(config)).commit;
    const cacheKey = `${config.projectDir}\0${changeName}\0${commit}`;
    const cached = requirementKeysCache.get(cacheKey);
    if (cached) {
      return new Set(cached);
    }
    const keys = requirementKeysFromGit(config.projectDir, commit, `openspec/changes/${changeName}/specs`);
    requirementKeysCache.set(cacheKey, new Set(keys));
    return keys;
  } catch {
    return new Set();
  }
}

function cleanWorktreeRequirementCacheKey(worktreeDir: string, specsDir: string, changeName: string): string | undefined {
  const head = spawnSync("git", ["-C", worktreeDir, "rev-parse", "HEAD"], { encoding: "utf8" });
  const status = spawnSync("git", ["-C", worktreeDir, "status", "--porcelain", "--", relative(worktreeDir, specsDir)], { encoding: "utf8" });
  if (head.status !== 0 || status.status !== 0 || status.stdout.trim()) {
    return undefined;
  }
  return `${worktreeDir}\0${changeName}\0${head.stdout.trim()}`;
}

async function reportInferredArchiveOrdering(
  config: RunnerConfig,
  changeName: string,
  dependencies: string[],
  reasons: Record<string, string[]>,
): Promise<void> {
  const details = dependencies.map((dependency) => {
    const requirements = reasons[dependency] ?? [];
    return `${dependency} (${requirements.map((requirement) => `requirement \"${requirement}\"`).join(", ")})`;
  }).join("; ");
  const message = `Inferred archive ordering: ${changeName} waits for ${details}.`;
  const reportKey = `${config.projectDir}\0${message}`;
  if (reportedArchiveOrderings.has(reportKey)) {
    return;
  }
  reportedArchiveOrderings.add(reportKey);
  console.warn(message);
  const runsDir = join(config.stateDir, "runs");
  await mkdir(runsDir, { recursive: true });
  const timestamp = (config.now?.() ?? new Date()).toISOString();
  await appendFile(join(runsDir, "archive-ordering.log"), `[${timestamp}] ${message}\n`);
}

function displayRequirementKey(key: string): string {
  const requirement = key.slice(key.indexOf(":") + 1).trim();
  return requirement ? `${requirement[0]?.toUpperCase()}${requirement.slice(1)}` : key;
}

async function requirementKeysFromDirectory(specsDir: string): Promise<Set<string>> {
  const keys = new Set<string>();
  const visit = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        await visit(path);
      } else if (entry.name === "spec.md") {
        addRequirementKeys(keys, relative(specsDir, path), await readFile(path, "utf8"));
      }
    }
  };
  await visit(specsDir);
  return keys;
}

function requirementKeysFromGit(projectDir: string, commit: string, specsPath: string): Set<string> {
  const keys = new Set<string>();
  const files = spawnSync("git", ["-C", projectDir, "ls-tree", "-r", "--name-only", commit, "--", specsPath], { encoding: "utf8" });
  if (files.status !== 0) {
    return keys;
  }
  for (const path of files.stdout.split(/\r?\n/).filter((candidate) => candidate.endsWith("/spec.md"))) {
    const content = spawnSync("git", ["-C", projectDir, "show", `${commit}:${path}`], { encoding: "utf8" });
    if (content.status === 0) {
      addRequirementKeys(keys, path.slice(specsPath.length + 1), content.stdout);
    }
  }
  return keys;
}

function addRequirementKeys(keys: Set<string>, specPath: string, content: string): void {
  for (const match of content.matchAll(/^### Requirement:\s*(.+?)\s*$/gim)) {
    const requirement = match[1]?.trim().toLowerCase();
    if (requirement) {
      keys.add(`${specPath}:${requirement}`);
    }
  }
}

function shipResultRequiresHuman(phase: DeliverPhase): boolean {
  return phase === "waiting_for_merge" || phase === "waiting_for_archive_merge";
}

function humanInterventionReason(phase: DeliverPhase, pullRequestUrl?: string): string {
  if (phase === "waiting_for_merge") {
    return pullRequestUrl
      ? `PR is ready and waits for a human to merge it: ${pullRequestUrl}`
      : "PR is ready and waits for a human to merge it";
  }

  if (phase === "waiting_for_archive_merge") {
    return pullRequestUrl
      ? `Archive PR is ready and waits for a human to merge it: ${pullRequestUrl}`
      : "Archive PR is ready and waits for a human to merge it";
  }

  return "Human intervention required";
}

async function collectDeliveryEvidence(config: RunnerConfig, task: QueueTask): Promise<DeliveryEvidence> {
  const changeName = task.change;
  if (!changeName) {
    throw new Error("Cannot collect delivery evidence for a task without a change name");
  }

  const branch = task.deliveryBranch ?? detectChangeBranch(config.projectDir, changeName);
  const activeChangeDetector = config.activeChangeDetector ?? detectActiveChange;
  const archivedChangeDetector = config.archivedChangeDetector ?? detectArchivedChange;
  const localClaimDetector = config.localClaimDetector ?? changeHasExistingLocalClaim;
  const localClaimPublishedDetector = config.localClaimPublishedDetector ?? detectLocalClaimPublished;
  const remoteBranchDetector = config.remoteBranchDetector ?? detectRemoteBranch;
  const pullRequestDetector = config.pullRequestDetector ?? detectOpenPullRequest;
  const mergedPullRequestDetector = config.mergedPullRequestDetector ?? detectMergedPullRequest;
  const tasksCompleteDetector = config.tasksCompleteDetector ?? detectTasksComplete;
  const worktreeDependenciesReadyDetector = config.worktreeDependenciesReadyDetector ?? detectWorktreeDependenciesReady;
  const declaredPhase = deliverPhase(task);

  const [detectedActiveChange, hasArchivedChange, hasLocalClaim, localClaimPublished, tasksComplete, worktreeDependenciesReady] = await Promise.all([
    activeChangeDetector(config.projectDir, changeName),
    archivedChangeDetector(config.projectDir, changeName),
    localClaimDetector(config.projectDir, changeName),
    localClaimPublishedDetector(config.projectDir, changeName, branch),
    tasksCompleteDetector(config.projectDir, changeName),
    worktreeDependenciesReadyDetector(config.projectDir, changeName),
  ]);
  let hasResolvableSource = false;
  if (!hasLocalClaim && phasePrecedesForEvidence(declaredPhase, "implement")) {
    try {
      (config.sourceResolver ?? resolveDeliverySource)(config.projectDir, task, configuredBaseBranch(config));
      hasResolvableSource = true;
    } catch {
      hasResolvableSource = false;
    }
  }
  const hasActiveChange = detectedActiveChange || hasResolvableSource;

  const shouldCheckRemoteBranch =
    phasePrecedesForEvidence(declaredPhase, "waiting_for_merge") ||
    (declaredPhase === "push" && hasLocalClaim && tasksComplete && localClaimPublished);
  const hasRemoteBranch = shouldCheckRemoteBranch ? await remoteBranchDetector(config.projectDir, branch) : false;

  const shouldCheckOpenPullRequest =
    phasePrecedesForEvidence(declaredPhase, "waiting_for_merge") ||
    (declaredPhase === "push" && hasRemoteBranch);
  const shouldCheckMergedPullRequest = phasePrecedesForEvidence(declaredPhase, "archive");
  const [openPullRequest, mergedPullRequest] = await Promise.all([
    shouldCheckOpenPullRequest ? pullRequestDetector(config.projectDir, branch) : Promise.resolve(undefined),
    shouldCheckMergedPullRequest ? mergedPullRequestDetector(config.projectDir, branch) : Promise.resolve(undefined),
  ]);
  const refreshRequired = openPullRequest
    ? await deliveryBranchRefreshRequired(config, branch, configuredBaseBranch(config))
    : declaredPhase === "refresh_branch" && !localClaimPublished;
  const shouldCheckArchivePullRequest = Boolean(task.archivePullRequestUrl)
    || !phasePrecedesForEvidence(declaredPhase, "publish_archive")
    || Boolean(mergedPullRequest);
  const archivePullRequest = shouldCheckArchivePullRequest
    ? await detectArchivePullRequestState(config.projectDir, task)
    : undefined;

  return {
    changeName,
    declaredPhase,
    hasActiveChange,
    hasArchivedChange,
    cleanupComplete: hasArchivedChange && !hasLocalClaim,
    hasLocalClaim,
    worktreeDependenciesReady,
    localClaimPublished,
    hasRemoteBranch,
    hasOpenPullRequest: Boolean(openPullRequest),
    pullRequestUrl: openPullRequest,
    hasMergedPullRequest: Boolean(mergedPullRequest),
    tasksComplete,
    refreshRequired,
    archivePublished: hasArchivedChange,
    hasOpenArchivePullRequest: archivePullRequest?.state === "OPEN",
    hasMergedArchivePullRequest: archivePullRequest?.state === "MERGED",
    archivePullRequestUrl: archivePullRequest?.url,
  };
}

async function detectArchivePullRequestState(
  projectDir: string,
  task: QueueTask,
): Promise<{ state: "OPEN" | "MERGED"; url: string } | undefined> {
  const args = task.archivePullRequestUrl
    ? ["pr", "view", task.archivePullRequestUrl, "--json", "state,url"]
    : ["pr", "list", "--state", "all", "--json", "headRefName,state,url", "--limit", "100"];
  const result = spawnSync("gh", args, {
    cwd: projectDir,
    env: childEnvForCwd(projectDir),
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) {
    return undefined;
  }
  try {
    const parsed = JSON.parse(result.stdout) as
      | { state?: unknown; url?: unknown }
      | Array<{ headRefName?: unknown; state?: unknown; url?: unknown }>;
    const candidate = Array.isArray(parsed)
      ? parsed.find((entry) =>
          typeof entry.headRefName === "string" && entry.headRefName.startsWith(`openspec-shipper/archive-${task.change}-`),
        )
      : parsed;
    const state = String(candidate?.state ?? "").toUpperCase();
    const url = candidate?.url;
    return (state === "OPEN" || state === "MERGED") && typeof url === "string"
      ? { state, url }
      : undefined;
  } catch {
    return undefined;
  }
}

async function deliveryBranchRefreshRequired(config: RunnerConfig, branch: string, baseBranch: string): Promise<boolean> {
  const policy = (readShipperConfigSync(config.projectDir) ?? defaultShipperConfig()).delivery.refreshPolicy;
  if (policy === "never") {
    return false;
  }

  const result = spawnSync("gh", ["pr", "view", branch, "--json", "mergeStateStatus"], {
    cwd: config.projectDir,
    env: childEnvForCwd(config.projectDir),
    encoding: "utf8",
    timeout: 15_000,
  });
  if (result.status !== 0) {
    return false;
  }
  let mergeStateStatus = "";
  try {
    mergeStateStatus = String((JSON.parse(result.stdout) as { mergeStateStatus?: unknown }).mergeStateStatus ?? "").toUpperCase();
  } catch {
    return false;
  }

  const needsProtectionCheck = policy === "auto" && mergeStateStatus === "BEHIND";
  return shouldRefreshDeliveryBranch(
    policy,
    mergeStateStatus,
    needsProtectionCheck && branchProtectionRequiresCurrentBase(config.projectDir, baseBranch),
  );
}

function branchProtectionRequiresCurrentBase(projectDir: string, baseBranch: string): boolean {
  const repo = spawnSync("gh", ["repo", "view", "--json", "nameWithOwner", "--jq", ".nameWithOwner"], {
    cwd: projectDir,
    env: childEnvForCwd(projectDir),
    encoding: "utf8",
    timeout: 10_000,
  });
  const nameWithOwner = repo.status === 0 ? repo.stdout.trim() : "";
  if (!nameWithOwner) {
    return false;
  }
  const protection = spawnSync("gh", ["api", `repos/${nameWithOwner}/branches/${baseBranch}/protection`, "--jq", ".required_status_checks.strict"], {
    cwd: projectDir,
    env: childEnvForCwd(projectDir),
    encoding: "utf8",
    timeout: 10_000,
  });
  return protection.status === 0 && protection.stdout.trim() === "true";
}

function phasePrecedesForEvidence(left: DeliverPhase, right: DeliverPhase): boolean {
  return deliveryPhaseRank(left) < deliveryPhaseRank(right);
}

function deliveryPhaseRank(phase: DeliverPhase): number {
  switch (phase) {
    case "prepare_worktree":
      return 0;
    case "implement":
      return 1;
    case "refresh_branch":
      return 2;
    case "push":
      return 3;
    case "waiting_for_merge":
      return 4;
    case "archive":
      return 5;
    case "publish_archive":
      return 6;
    case "waiting_for_archive_merge":
      return 7;
    case "cleanup_worktree":
      return 8;
  }
}

async function loadQueue(queuePath: string) {
  const content = await readFile(queuePath, "utf8");
  return parseQueue(content);
}

async function markTaskAsChecking(config: RunnerConfig, lines: string[], task: QueueTask): Promise<string> {
  const timestamp = (config.now?.() ?? new Date()).toISOString();
  await writeFile(config.queuePath, markTaskChecking(lines, task, { timestamp }));
  return timestamp;
}

async function blockTask(
  queuePath: string,
  lines: string[],
  task: QueueTask,
  config: RunnerConfig,
  reason: string,
) {
  const timestamp = (config.now?.() ?? new Date()).toISOString();
  const nextContent = markTask(lines, task, "blocked", { timestamp, reason });
  await writeFile(queuePath, nextContent);
}

function isNativeTask(task: QueueTask): boolean {
  const phase = task.action === "deliver" ? deliverPhase(task) : task.action;
  return isNativePhase(phase);
}

function isNativePhase(phase: DeliverPhase): boolean {
  return ["prepare_worktree", "refresh_branch", "push", "publish_archive", "cleanup_worktree"].includes(phase);
}

function describeNativeTask(task: QueueTask): string {
  const phase = task.action === "deliver" ? deliverPhase(task) : task.action;
  if (phase === "prepare_worktree" && task.change) {
    return `prepare worktree for ${task.change}`;
  }
  if (phase === "refresh_branch" && task.change) {
    return `refresh delivery branch for ${task.change}`;
  }
  if (phase === "push" && task.change) {
    return `push ${task.change} and open a pull request`;
  }
  if (phase === "publish_archive" && task.change) {
    return `publish archive for ${task.change}`;
  }
  if (phase === "cleanup_worktree" && task.change) {
    return `cleanup worktree for ${task.change}`;
  }

  return `${phase} phase`;
}

async function executeNativeTask(
  config: RunnerConfig,
  lines: string[],
  task: QueueTask,
  activity: { checkedAt?: string } = {},
): Promise<number> {
  let effectiveTask = task;
  const startedAt = (config.now?.() ?? new Date()).toISOString();
  const logPath = await createRunLogPath(config, task, startedAt);
  const relativeLogPath = toMarkdownPath(relative(dirname(config.queuePath), logPath));

  console.log(`[${startedAt}] running: ${task.rawCommand}`);
  console.log(`Native: ${describeNativeTask(task)}`);
  console.log(`Cwd: ${config.projectDir}`);
  console.log(`Log: ${toMarkdownPath(relative(config.projectDir, logPath))}`);

  const runningContent = markTaskRunning(lines, effectiveTask, {
    timestamp: startedAt,
    logPath: relativeLogPath,
  });
  await writeFile(config.queuePath, runningContent);

  try {
    if (deliverPhase(effectiveTask) === "prepare_worktree") {
      const resolver = config.sourceResolver ?? resolveDeliverySource;
      const source = resolver(config.projectDir, effectiveTask, configuredBaseBranch(config));
      effectiveTask = {
        ...effectiveTask,
        sourceBranch: source.branch,
        sourceCommit: source.commit,
        sourceWorktree: source.worktree,
        deliveryBranch: effectiveTask.deliveryBranch ?? `feat/${effectiveTask.change}`,
        deliveryWorktree: effectiveTask.deliveryWorktree ?? `worktrees/${effectiveTask.change}`,
        adoptedAt: effectiveTask.adoptedAt ?? startedAt,
      };
      await writeFile(config.queuePath, markTaskRunning(lines, effectiveTask, {
        timestamp: startedAt,
        logPath: relativeLogPath,
      }));
    }

    const output = await runNativeTask(config, effectiveTask);
    await writeFile(logPath, output);
    const timestamp = (config.now?.() ?? new Date()).toISOString();
    const phase = deliverPhase(effectiveTask);
    const publicationUrl = phase === "publish_archive" ? extractPullRequestUrl(output) : undefined;
    const nextContent =
      effectiveTask.action === "deliver" && phase === "push"
        ? markTask(lines, { ...effectiveTask, phase: "waiting_for_merge", pullRequestUrl: extractPullRequestUrl(output) }, "blocked", {
            timestamp,
            reason: humanInterventionReason("waiting_for_merge", extractPullRequestUrl(output)),
            pullRequestUrl: extractPullRequestUrl(output),
            logPath: relativeLogPath,
            checkedAt: activity.checkedAt,
            startedAt,
          })
        : effectiveTask.action === "deliver" && phase === "publish_archive" && publicationUrl
          ? markTask(lines, { ...effectiveTask, phase: "waiting_for_archive_merge", archivePullRequestUrl: publicationUrl }, "blocked", {
              timestamp,
              reason: `Archive PR is ready and waits for a human to merge it: ${publicationUrl}`,
              pullRequestUrl: publicationUrl,
              logPath: relativeLogPath,
              checkedAt: activity.checkedAt,
              startedAt,
            })
          : effectiveTask.action === "deliver" && phase === "publish_archive"
            ? advanceDeliverTaskToPhase(lines, effectiveTask, "cleanup_worktree", {
                timestamp,
                logPath: relativeLogPath,
                checkedAt: activity.checkedAt,
                startedAt,
              })
        : advanceDeliverTask(lines, effectiveTask, {
            timestamp,
            logPath: relativeLogPath,
            checkedAt: activity.checkedAt,
            startedAt,
          });
    await writeFile(config.queuePath, nextContent);
    console.log(`[${new Date().toISOString()}] completed: ${task.rawCommand}`);
    return 0;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    const logOutput = error instanceof NativeTaskError ? error.logOutput : `${reason}\n`;
    await writeFile(logPath, logOutput);
    if (error instanceof ArchivePublishRaceError && deliverPhase(effectiveTask) === "publish_archive") {
      const attempts = (effectiveTask.archiveAttempts ?? 0) + 1;
      const maxAttempts = (readShipperConfigSync(config.projectDir) ?? defaultShipperConfig()).archive.maxAttempts;
      if (attempts < maxAttempts) {
        const retryTask = {
          ...effectiveTask,
          phase: "archive" as const,
          archiveAttempts: attempts,
          archiveBase: error.actualBase,
        };
        await writeFile(config.queuePath, advanceDeliverTaskToPhase(lines, retryTask, "archive", {
          timestamp: (config.now?.() ?? new Date()).toISOString(),
          logPath: relativeLogPath,
          checkedAt: activity.checkedAt,
          startedAt,
        }));
        console.log(`[${new Date().toISOString()}] archive publication raced with origin; recalculating (${attempts}/${maxAttempts})`);
        return 0;
      }
    }
    const repairAttempts = Number(effectiveTask.metadata.repair_attempts ?? "0");
    if (!(error instanceof NativeTaskError) && repairAttempts < 2) {
      const repairer = config.repairNativeFailure ?? repairNativeFailure;
      const repair = await repairer(config, effectiveTask, reason, logPath).catch((repairError: unknown) => ({
        repaired: false,
        output: repairError instanceof Error ? repairError.message : String(repairError),
      }));
      await appendFile(logPath, `\n## Native repair attempt\n\n${repair.output}\n`);
      if (repair.repaired) {
        const retryTask = {
          ...effectiveTask,
          metadata: { ...effectiveTask.metadata, repair_attempts: String(repairAttempts + 1) },
        };
        await writeFile(config.queuePath, advanceDeliverTaskToPhase(lines, retryTask, deliverPhase(retryTask), {
          timestamp: (config.now?.() ?? new Date()).toISOString(),
          logPath: relativeLogPath,
          checkedAt: activity.checkedAt,
          startedAt,
        }));
        console.log(`[${new Date().toISOString()}] native repair completed; ${task.rawCommand} will be reconciled and retried`);
        return 0;
      }
    }
    const nextContent = markTask(lines, effectiveTask, "blocked", {
      timestamp: (config.now?.() ?? new Date()).toISOString(),
      reason,
      logPath: relativeLogPath,
      checkedAt: activity.checkedAt,
      startedAt,
    });
    await writeFile(config.queuePath, nextContent);
    console.error(`[${new Date().toISOString()}] blocked: ${reason}`);
    return 1;
  }
}

async function runNativeTask(config: RunnerConfig, task: QueueTask): Promise<string> {
  const phase = task.action === "deliver" ? deliverPhase(task) : task.action;
  if (phase === "refresh_branch" && task.change) {
    const refresher = config.refreshDeliveryBranch ?? refreshDeliveryBranch;
    return await refresher(config.projectDir, task.change, configuredBaseBranch(config));
  }

  if (phase === "publish_archive" && task.change) {
    const archiveFinalizer = config.finalizeArchive ?? finalizeArchive;
    return await archiveFinalizer({
      projectDir: config.projectDir,
      changeName: task.change,
      baseBranch: configuredBaseBranch(config),
    });
  }

  if (phase === "push" && task.change) {
    const pusher = config.pushBranchAndOpenPullRequest ?? pushBranchAndOpenPullRequest;
    const branch = detectChangeBranch(config.projectDir, task.change);
    const worktreeDir = join(config.projectDir, "worktrees", task.change);
    return await pusher({
      projectDir: config.projectDir,
      changeName: task.change,
      branch,
      worktreeDir,
      baseBranch: configuredBaseBranch(config),
    });
  }

  if (phase === "cleanup_worktree" && task.change) {
    const cleaner = config.cleanupWorkspace ?? cleanupWorkspace;
    const branch = detectChangeBranch(config.projectDir, task.change);
    const worktreeDir = join(config.projectDir, "worktrees", task.change);
    return await cleaner({
      projectDir: config.projectDir,
      changeName: task.change,
      branch,
      worktreeDir,
    });
  }

  if (phase !== "prepare_worktree" || !task.change) {
    throw new Error(`Native runner does not support ${phase}`);
  }

  const preparer = config.prepareWorkspace ?? prepareWorkspace;
  const branch = task.deliveryBranch ?? detectChangeBranch(config.projectDir, task.change);
  const worktreeDir = task.deliveryWorktree
    ? join(config.projectDir, task.deliveryWorktree)
    : join(config.projectDir, "worktrees", task.change);
  const source = (config.sourceResolver ?? resolveDeliverySource)(config.projectDir, task, configuredBaseBranch(config));
  return await preparer({
    projectDir: config.projectDir,
    changeName: task.change,
    branch,
    worktreeDir,
    baseBranch: configuredBaseBranch(config),
    source,
  });
}

async function repairNativeFailure(
  config: RunnerConfig,
  task: QueueTask,
  reason: string,
  logPath: string,
): Promise<{ repaired: boolean; output: string }> {
  const phase = deliverPhase(task);
  const changeName = task.change ?? "unknown-change";
  const deliveryWorktree = task.deliveryWorktree
    ? join(config.projectDir, task.deliveryWorktree)
    : join(config.projectDir, "worktrees", changeName);
  const cwd = ["refresh_branch", "push", "cleanup_worktree"].includes(phase) && existsSync(deliveryWorktree)
    ? deliveryWorktree
    : ["publish_archive"].includes(phase) && existsSync(archiveIntegrationWorkspace(config.projectDir))
      ? archiveIntegrationWorkspace(config.projectDir)
      : config.projectDir;
  const prompt = [
    "You are the internal OpenSpec Shipper repair agent.",
    `A native ${phase} operation for ${changeName} failed: ${reason}`,
    `Inspect the repository and repair the underlying Git or GitHub condition when it is safe and deterministic.`,
    `The integration boundary is origin/${configuredBaseBranch(config)}.`,
    "Do not edit, reset, stash, switch, commit, or clean the human checkout.",
    "Only modify the current delivery/integration workspace and its branch.",
    "Never force-push an implementation branch and never rewrite remote history.",
    "Use git and gh directly. If a merge conflict needs semantic judgment, resolve it, run relevant checks, and commit the resolution.",
    "If repair is unsafe or requires a human decision, finish with exactly: OPENSPEC_SHIPPER_BLOCKED: <short reason>",
    "If repaired, explain the evidence that the native operation can now be retried.",
  ].join("\n");
  const currentProvider = provider(config);
  let command: string;
  let args: string[];
  let stdin: string | undefined;
  if (currentProvider.id === "codex-cli") {
    command = config.codexBin ?? "codex";
    args = ["exec", "-C", cwd, "--sandbox", "workspace-write", "-c", 'approval_policy="never"'];
    if (config.codexModel) args.push("--model", config.codexModel);
    if (config.codexReasoningEffort) args.push("-c", `model_reasoning_effort="${config.codexReasoningEffort}"`);
    args.push(prompt);
  } else if (currentProvider.id === "claude-code") {
    command = config.claudeBin ?? "claude";
    args = buildClaudeCliArgs(config.projectDir, configuredClaudeOptions(config));
    stdin = prompt;
  } else {
    command = config.opencodeBin;
    args = ["run"];
    if (config.opencodePrintLogs) args.push("--print-logs");
    if (config.opencodeLogLevel) args.push("--log-level", config.opencodeLogLevel);
    if (config.opencodeModel) args.push("--model", config.opencodeModel);
    args.push(prompt);
  }

  const executor = config.executor ?? spawnExecutor;
  const result = await executor(command, args, {
    cwd,
    logPath,
    timeoutMs: config.taskTimeoutMs,
    heartbeatMs: config.heartbeatMs,
    stdin,
    env: currentProvider.id === "opencode" ? { OPENCODE_CONFIG_DIR: openCodeConfigDir(config.projectDir) } : undefined,
  });
  const failure = currentProvider.detectFailureSignal(result.output) ?? result.failureReason;
  return {
    repaired: result.exitCode === 0 && !failure,
    output: failure ?? result.output ?? `repair exited with code ${result.exitCode}`,
  };
}

async function createRunLogPath(config: RunnerConfig, task: QueueTask, timestamp: string) {
  const runsDir = join(config.stateDir, "runs");
  await mkdir(runsDir, { recursive: true });
  return join(runsDir, `${timestamp.replace(/[:.]/g, "-")}-${taskSlug(task)}.log`);
}

async function requestStop(config: RunnerConfig): Promise<number> {
  await mkdir(config.stateDir, { recursive: true });
  await writeFile(stopPath(config), stopRequestContent());
  console.log(`Stop requested: ${stopPath(config)}`);
  console.log("A running queue:run will exit before starting another executor task.");
  return 0;
}

function printOpenCodeStats(config: RunnerConfig): number {
  const stats = buildStatsOptions({ ...config, opencodeStats: true });
  if (!stats) {
    return 1;
  }

  console.log(`Stats command: ${formatCommand(stats.command, buildStatsArgs(stats))}`);
  console.log(`Cwd: ${stats.cwd}`);

  const result = readOpenCodeStats(stats);
  if (result.ok) {
    console.log(result.message);
    return 0;
  }

  console.error(`OpenCode stats unavailable: ${result.message}`);
  return 1;
}

function requestStopSync(config: RunnerConfig) {
  writeFileSync(stopPath(config), stopRequestContent());
}

function stopRequestContent(): string {
  return JSON.stringify(
    {
      requestedAt: new Date().toISOString(),
      message: "Stop queue:run at the next safe checkpoint.",
    },
    null,
    2,
  );
}

async function clearStopRequest(config: RunnerConfig) {
  await unlink(stopPath(config)).catch((error: unknown) => {
    if (isNotFoundError(error)) {
      return;
    }

    throw error;
  });
}

async function waitOrStop(config: RunnerConfig, sleep: Sleep, ms: number): Promise<boolean> {
  const stepMs = 1_000;
  let remainingMs = ms;

  while (remainingMs > 0) {
    await sleep(Math.min(stepMs, remainingMs));
    if (await stopRequested(config)) {
      return true;
    }
    remainingMs -= stepMs;
  }

  return false;
}

async function stopRequested(config: RunnerConfig): Promise<boolean> {
  return await fileExists(stopPath(config));
}

function stopPath(config: RunnerConfig): string {
  return join(config.stateDir, "stop");
}

function terminateActiveChild(signal: NodeJS.Signals) {
  if (activeChildProcess) {
    terminateChild(activeChildProcess, signal);
  }
}

function terminateChild(child: ReturnType<typeof spawn>, signal: NodeJS.Signals) {
  if (!child.pid) {
    return;
  }

  try {
    process.kill(-child.pid, signal);
  } catch {
    child.kill(signal);
  }
}

function buildConfiguredProviderCommand(config: RunnerConfig, task: QueueTask): ProviderCommand {
  const phase = task.action === "deliver" ? deliverPhase(task) : task.action;
  const executionDir = phase === "archive" ? archiveIntegrationWorkspace(config.projectDir) : config.projectDir;
  return provider(config).buildCommand({
    phase,
    task,
    projectDir: executionDir,
    assetsDir: config.projectDir,
    config: {
      executor: {
        provider: config.providerId ?? "opencode",
        opencode: {
          bin: config.opencodeBin,
          model: config.opencodeModel,
        },
        codex: {
          bin: config.codexBin ?? "codex",
          model: config.codexModel,
          reasoningEffort: config.codexReasoningEffort,
        },
        claude: configuredClaudeOptions(config),
      },
      opencodePrintLogs: config.opencodePrintLogs,
      opencodeLogLevel: config.opencodeLogLevel,
    },
  });
}

function configuredClaudeOptions(config: RunnerConfig): ClaudeCliOptions {
  return {
    bin: config.claudeBin ?? "claude",
    model: config.claudeModel,
    effort: config.claudeEffort,
    permissionMode: config.claudePermissionMode,
    maxTurns: config.claudeMaxTurns,
    maxBudgetUsd: config.claudeMaxBudgetUsd,
  };
}

function provider(config: RunnerConfig) {
  return providerById(config.providerId ?? "opencode");
}

export async function spawnExecutor(
  command: string,
  args: string[],
  options: ExecutorOptions,
): Promise<ExecutorResult> {
  await mkdir(dirname(options.logPath), { recursive: true });

  return await new Promise((resolve, reject) => {
    let settled = false;
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: { ...childEnvForCwd(options.cwd), ...(options.env ?? {}) },
      detached: true,
      stdio: [options.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    if (options.stdin !== undefined) {
      child.stdin?.end(options.stdin);
    }
    activeChildProcess = child;
    const log = createWriteStream(options.logPath, { flags: "a" });
    let output = "";
    let failureReason: string | undefined;
    let forceKillTimeout: Timer | undefined;
    let heartbeat: Timer | undefined;
    const startedAt = Date.now();
    let lastChildOutputAt = startedAt;
    let lastStatsAt = 0;
    let lastStatsError: string | undefined;
    const clearTimers = () => {
      clearTimeout(timeout);
      if (forceKillTimeout) {
        clearTimeout(forceKillTimeout);
      }
      if (heartbeat) {
        clearInterval(heartbeat);
      }
    };
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }

      const message = `\nOpenSpec Shipper task timed out after ${formatDuration(options.timeoutMs)}; terminating executor.\n`;
      failureReason = message.trim();
      process.stderr.write(message);
      log.write(message);
      terminateChild(child, "SIGTERM");
      forceKillTimeout = setTimeout(() => {
        if (!settled) {
          terminateChild(child, "SIGKILL");
        }
      }, KILL_GRACE_MS);
    }, options.timeoutMs);

    if (options.heartbeatMs > 0) {
      heartbeat = setInterval(() => {
        if (settled) {
          return;
        }

        const now = Date.now();
        const message = `\n[${new Date().toISOString()}] still running: ${formatDuration(
          now - startedAt,
        )} elapsed, ${formatDuration(now - lastChildOutputAt)} since last executor output. Log: ${
          options.logPath
        }${formatStatsSnapshot(options.stats, now, {
          lastStatsAt,
          lastStatsError,
          update: (next) => {
            lastStatsAt = next.lastStatsAt;
            lastStatsError = next.lastStatsError;
          },
        })}\n`;
        process.stderr.write(message);
        log.write(message);
      }, options.heartbeatMs);
    }

    const capture = (chunk: Buffer, stream: NodeJS.WriteStream) => {
      const text = chunk.toString();
      lastChildOutputAt = Date.now();
      output = capOutput(`${output}${text}`);
      stream.write(text);
      log.write(text);
    };

    child.stdout!.on("data", (chunk: Buffer) => capture(chunk, process.stdout));
    child.stderr!.on("data", (chunk: Buffer) => capture(chunk, process.stderr));
    child.on("error", (error) => {
      settled = true;
      clearTimers();
      log.end();
      if (activeChildProcess === child) {
        activeChildProcess = undefined;
      }
      reject(error);
    });
    child.on("close", (exitCode) => {
      settled = true;
      clearTimers();
      log.end();
      if (activeChildProcess === child) {
        activeChildProcess = undefined;
      }
      resolve({ exitCode, output, failureReason });
    });
  });
}

export async function detectActiveOpenCodeProcesses(): Promise<string[]> {
  return await detectActiveExecutorProcesses(["opencode"]);
}

export async function detectActiveExecutorProcesses(processNames: string[]): Promise<string[]> {
  const active: string[] = [];
  for (const processName of processNames) {
    const result = spawnSync("pgrep", ["-x", processName], { encoding: "utf8" });
    if (result.status === 1) {
      continue;
    }

    if (result.status !== 0) {
      active.push(`pgrep ${processName} failed with code ${result.status ?? "unknown"}`);
      continue;
    }

    active.push(
      ...result.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean)
        .map(describeProcess),
    );
  }

  return active;
}

export async function detectGitRemoteOrigin(projectDir: string): Promise<string | undefined> {
  const result = spawnSync("git", ["-C", projectDir, "remote", "get-url", "origin"], { encoding: "utf8" });
  if (result.status !== 0) {
    return undefined;
  }

  return result.stdout.trim() || undefined;
}

export async function detectGitStatus(projectDir: string): Promise<string[]> {
  const result = spawnSync("git", ["-C", projectDir, "status", "--short", "--untracked-files=all"], { encoding: "utf8" });
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export async function refreshDeliveryBranch(projectDir: string, changeName: string, baseBranch = "main"): Promise<string> {
  const worktreeDir = join(projectDir, "worktrees", changeName);
  if (!(await pathExists(worktreeDir))) {
    throw new Error(`Delivery worktree missing for ${changeName}; return the task to prepare_worktree.`);
  }

  const fetch = spawnSync("git", ["-C", projectDir, "fetch", "--quiet", "origin", baseBranch], {
    env: childEnvForCwd(projectDir),
    encoding: "utf8",
  });
  if (fetch.status !== 0) {
    throw new Error(`Cannot fetch origin/${baseBranch} before refreshing ${changeName}: ${formatGitError(fetch)}`);
  }

  const messages: string[] = [];
  const dirty = filterLocalStateStatus(await detectGitStatus(worktreeDir));
  if (dirty.length > 0) {
    const identity = checkGitIdentity(worktreeDir);
    if (!identity.ok) {
      throw new Error(identity.reason);
    }
    runGit(worktreeDir, ["add", "-A"]);
    const branch = runGit(worktreeDir, ["branch", "--show-current"]).trim();
    runGit(worktreeDir, ["commit", "-m", `${commitTypeFromBranch(branch)}: complete ${changeName}`]);
    messages.push(`Committed implementation changes before refresh: ${formatDirtyStatus(dirty)}.`);
  }

  const baseRef = `origin/${baseBranch}`;
  const alreadyCurrent = spawnSync("git", ["-C", worktreeDir, "merge-base", "--is-ancestor", baseRef, "HEAD"], {
    env: childEnvForCwd(worktreeDir),
    encoding: "utf8",
  });
  if (alreadyCurrent.status === 0) {
    messages.push(`Delivery branch for ${changeName} already contains ${baseRef}.`);
    return `${messages.join("\n")}\n`;
  }

  const mergeTree = spawnSync("git", ["-C", worktreeDir, "merge-tree", "--write-tree", "--quiet", "HEAD", baseRef], {
    env: childEnvForCwd(worktreeDir),
    encoding: "utf8",
  });
  if (mergeTree.status === 1) {
    throw new Error(`Delivery branch ${changeName} conflicts with ${baseRef}; intelligent repair is required before it can be pushed.`);
  }
  if (mergeTree.status !== 0) {
    throw new Error(`Cannot inspect the merge between ${changeName} and ${baseRef}: ${formatGitError(mergeTree)}`);
  }

  const merge = spawnSync("git", ["-C", worktreeDir, "merge", "--no-edit", baseRef], {
    env: childEnvForCwd(worktreeDir),
    encoding: "utf8",
  });
  if (merge.status !== 0) {
    spawnSync("git", ["-C", worktreeDir, "merge", "--abort"], {
      env: childEnvForCwd(worktreeDir),
      encoding: "utf8",
    });
    throw new Error(`Delivery branch ${changeName} conflicts with ${baseRef}; intelligent repair is required: ${formatGitError(merge)}`);
  }

  messages.push(merge.stdout.trim() || `Merged ${baseRef} into the delivery branch for ${changeName}.`);
  return `${messages.join("\n")}\n`;
}

export function archiveIntegrationWorkspace(projectDir: string): string {
  return join(projectDir, ".openspec-shipper", "workspaces", "integration");
}

export async function prepareArchiveIntegrationWorkspace(projectDir: string, baseBranch = "main"): Promise<string> {
  const workspace = archiveIntegrationWorkspace(projectDir);
  const baseRef = `origin/${baseBranch}`;
  const fetch = spawnSync("git", ["-C", projectDir, "fetch", "--quiet", "origin", baseBranch], {
    env: childEnvForCwd(projectDir),
    encoding: "utf8",
  });
  if (fetch.status !== 0) {
    throw new Error(`Cannot fetch ${baseRef} before archive: ${formatGitError(fetch)}`);
  }

  if (await pathExists(workspace)) {
    runGit(workspace, ["reset", "--hard", baseRef]);
    runGit(workspace, ["clean", "-fd"]);
    return `Reset archive integration workspace to ${baseRef}.\n`;
  }

  await mkdir(dirname(workspace), { recursive: true });
  runGit(projectDir, ["worktree", "prune"]);
  runGit(projectDir, ["worktree", "add", "--detach", workspace, baseRef]);
  return `Created archive integration workspace from ${baseRef}.\n`;
}

export async function prepareWorkspace(input: PrepareWorkspaceInput): Promise<string> {
  const messages = [
    `Preparing ${input.changeName}`,
    `Project: ${input.projectDir}`,
    `Base branch: ${input.baseBranch}`,
    `Branch: ${input.branch}`,
    `Worktree: ${input.worktreeDir}`,
    `Planning snapshot: ${input.source.commit}`,
  ];

  const baseRef = `origin/${input.baseBranch}`;

  const worktreeAlreadyExists = await pathExists(input.worktreeDir);
  if (worktreeAlreadyExists) {
    messages.push("Worktree already exists; leaving it in place.");
  } else {
    const fetch = spawnSync("git", ["-C", input.projectDir, "fetch", "--quiet", "origin", input.baseBranch], {
      env: childEnvForCwd(input.projectDir),
      encoding: "utf8",
    });
    if (fetch.status !== 0) {
      throw new Error(`Cannot fetch origin/${input.baseBranch} before preparing ${input.changeName}: ${formatGitError(fetch)}`);
    }
    await mkdir(dirname(input.worktreeDir), { recursive: true });
    if (localBranchExists(input.projectDir, input.branch)) {
      messages.push(runGit(input.projectDir, ["worktree", "add", input.worktreeDir, input.branch]).trim());
      messages.push("Linked existing implementation branch to a worktree.");
    } else {
      messages.push(runGit(input.projectDir, ["worktree", "add", "-b", input.branch, input.worktreeDir, baseRef]).trim());
      messages.push("Created implementation branch and worktree.");
    }
  }

  const changePath = `openspec/changes/${input.changeName}`;
  const changeExists = await pathExists(join(input.worktreeDir, changePath));
  const currentSource = spawnSync("git", ["-C", input.worktreeDir, "diff", "--quiet", "HEAD", input.source.commit, "--", changePath], {
    env: childEnvForCwd(input.worktreeDir),
    encoding: "utf8",
  });
  if ((!worktreeAlreadyExists || !changeExists) && currentSource.status !== 0) {
    runGit(input.worktreeDir, ["restore", "--source", input.source.commit, "--staged", "--worktree", "--", changePath]);
    const staged = runGit(input.worktreeDir, ["diff", "--cached", "--name-only", "--", changePath]).trim();
    if (staged) {
      runGit(input.worktreeDir, ["commit", "-m", `chore: adopt OpenSpec change ${input.changeName}`]);
      messages.push(`Adopted ${changePath} from planning snapshot ${input.source.commit}.`);
    }
  }

  if (!(await pathExists(join(input.worktreeDir, changePath)))) {
    throw new Error(`Planning snapshot ${input.source.commit} did not produce ${changePath} in the delivery worktree.`);
  }

  if (!worktreeAlreadyExists) {
    const refreshed = await refreshDeliveryBranch(input.projectDir, input.changeName, input.baseBranch);
    messages.push(refreshed.trim());
  }

  const config = readShipperConfigSync(input.projectDir) ?? defaultShipperConfig();
  const installCommand = config.checks.install.trim();
  const dependenciesReady = await worktreeDependencyInputsReady(input.worktreeDir);
  if (config.worktree.install && installCommand && (!worktreeAlreadyExists || !dependenciesReady)) {
    messages.push(`Installing worktree dependencies with: ${installCommand}`);
    messages.push(runWorktreeInstall(input.worktreeDir, installCommand, config.worktree.installTimeoutMs).trim());
  } else if (!config.worktree.install) {
    messages.push("Worktree dependency installation is disabled by config.");
  } else if (!installCommand) {
    messages.push("No worktree dependency install command is configured.");
  } else {
    messages.push("Worktree dependencies already exist; skipping installation.");
  }

  return `${messages.filter(Boolean).join("\n")}\n`;
}

export async function detectWorktreeDependenciesReady(projectDir: string, changeName: string): Promise<boolean> {
  const config = readShipperConfigSync(projectDir) ?? defaultShipperConfig();
  if (!config.worktree.install || !config.checks.install.trim()) {
    return true;
  }

  return await worktreeDependencyInputsReady(join(projectDir, "worktrees", changeName));
}

export async function reconcileWorktreeDependencies(projectDir: string, changeName: string): Promise<string> {
  const config = readShipperConfigSync(projectDir) ?? defaultShipperConfig();
  if (!config.worktree.install) {
    return "Worktree dependency installation is disabled by config.\n";
  }
  const updateCommand = config.checks.updateDependencies.trim() || config.checks.install.trim();
  if (!updateCommand) {
    return "No worktree dependency update command is configured.\n";
  }

  const worktreeDir = join(projectDir, "worktrees", changeName);
  if (await worktreeDependencyInputsReady(worktreeDir)) {
    return "Dependency manifests and lockfiles are already reflected in node_modules.\n";
  }

  return `${runWorktreeInstall(worktreeDir, updateCommand, config.worktree.installTimeoutMs)}\n`;
}

const DEPENDENCY_INPUT_FILES = [
  "package.json",
  "package-lock.json",
  "npm-shrinkwrap.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
];

async function worktreeDependencyInputsReady(worktreeDir: string): Promise<boolean> {
  const dependencyDir = await stat(join(worktreeDir, "node_modules")).catch(() => undefined);
  if (!dependencyDir?.isDirectory()) {
    return false;
  }

  const inputStats = await Promise.all(
    DEPENDENCY_INPUT_FILES.map((file) => stat(join(worktreeDir, file)).catch(() => undefined)),
  );
  const newestInputMtime = Math.max(0, ...inputStats.filter(Boolean).map((entry) => entry!.mtimeMs));
  return dependencyDir.mtimeMs >= newestInputMtime;
}

async function pushBranchAndOpenPullRequest(input: PushBranchInput): Promise<string> {
  const config = readShipperConfigSync(input.projectDir) ?? defaultShipperConfig();
  if (config?.safety.enablePush === false) {
    throw new Error("OpenSpec Shipper push safety is disabled in .openspec-shipper/config.json.");
  }

  if (!(await pathExists(input.worktreeDir))) {
    throw new Error(`Prepared worktree missing for ${input.changeName}.`);
  }

  const messages = [
    `Pushing ${input.changeName}`,
    `Project: ${input.projectDir}`,
    `Base branch: ${input.baseBranch}`,
    `Branch: ${input.branch}`,
    `Worktree: ${input.worktreeDir}`,
  ];

  const gitIdentity = checkGitIdentity(input.worktreeDir);
  if (!gitIdentity.ok) {
    throw new Error(gitIdentity.reason);
  }

  ensureChangeArtifacts(input.worktreeDir, input.changeName);
  const taskCompletionStatus = await detectTaskCompletionStatus(input.projectDir, input.changeName);
  if (taskCompletionStatus.kind === "no_checkboxes") {
    throw new Error("tasks.md has no task checkboxes; OpenSpec Shipper cannot track completion. Use markdown checkboxes such as - [ ] and - [x].");
  }
  if (taskCompletionStatus.kind !== "complete") {
    throw new Error(`Implementation tasks are not complete for ${input.changeName}.`);
  }

  const openspecCommand = config.checks.openspec.trim();
  if (!openspecCommand) {
    throw new Error("checks.openspec is not configured in .openspec-shipper/config.json; cannot validate OpenSpec before push.");
  }
  // prepare_worktree installs dependencies so validation uses this worktree's lockfile, not the parent checkout.
  messages.push(runShell(input.worktreeDir, `${openspecCommand} validate ${shellQuote(input.changeName)}`, "OpenSpec validation").trim());

  const effectiveBranch = runGit(input.worktreeDir, ["branch", "--show-current"]).trim();
  if (!effectiveBranch) {
    throw new Error(`Worktree ${input.worktreeDir} is detached; cannot push a pull request branch.`);
  }

  const dirty = filterLocalStateStatus(await detectGitStatus(input.worktreeDir));
  if (dirty.length > 0) {
    messages.push(`Committing dirty worktree paths: ${formatDirtyStatus(dirty)}.`);
    runGit(input.worktreeDir, ["add", "-A"]);
    runGit(input.worktreeDir, ["commit", "-m", `${commitTypeFromBranch(effectiveBranch)}: complete ${input.changeName}`]);
  }

  messages.push(runGit(input.worktreeDir, ["push", "-u", "origin", effectiveBranch]).trim() || `Pushed ${effectiveBranch}.`);

  const existingPr = await detectOpenPullRequest(input.projectDir, effectiveBranch);
  if (existingPr) {
    messages.push(`Pull request already exists: ${existingPr}`);
    return `${messages.filter(Boolean).join("\n")}\n`;
  }

  const title = runGit(input.worktreeDir, ["log", "-1", "--pretty=%s"]).trim() || `${commitTypeFromBranch(effectiveBranch)}: ${input.changeName}`;
  const body = [
    `OpenSpec change: ${input.changeName}`,
    "",
    "Created by OpenSpec Shipper after the implementation branch was pushed.",
    `Archive will run on ${input.baseBranch} after this PR is merged.`,
  ].join("\n");
  const created = runGh(input.worktreeDir, [
    "pr",
    "create",
    "--base",
    input.baseBranch,
    "--head",
    effectiveBranch,
    "--title",
    title,
    "--body",
    body,
  ]).trim();
  messages.push(created || `Created pull request for ${effectiveBranch}.`);

  const openedPr = await detectOpenPullRequest(input.projectDir, effectiveBranch);
  if (!openedPr && !/^https:\/\/github\.com\//m.test(created)) {
    throw new Error(`gh pr create completed but no open pull request was found for ${effectiveBranch}.`);
  }

  return `${messages.filter(Boolean).join("\n")}\n`;
}

async function finalizeArchive(input: FinalizeArchiveInput): Promise<string> {
  const config = readShipperConfigSync(input.projectDir);
  if (config?.safety.enableArchive === false) {
    throw new Error("OpenSpec Shipper archive safety is disabled in .openspec-shipper/config.json.");
  }

  const workspace = archiveIntegrationWorkspace(input.projectDir);
  if (!(await pathExists(workspace))) {
    throw new Error("Archive integration workspace is missing; return the task to archive.");
  }

  if (!(await detectArchivedChangeOnDisk(workspace, input.changeName))) {
    throw new Error(`OpenSpec change ${input.changeName} was not archived by the archive agent.`);
  }

  const messages = [
    `Finalizing archive for ${input.changeName}`,
    `Workspace: ${workspace}`,
    `Base branch: ${input.baseBranch}`,
  ];

  const dirty = filterLocalStateStatus(await detectGitStatus(workspace));
  let archiveBase: string;
  let archiveCommit: string;
  if (dirty.length > 0) {
    const unexpected = dirty.filter((entry) => !isAllowedArchiveStatus(entry));
    if (unexpected.length > 0) {
      throw new Error(`Archive produced non-OpenSpec changes; refusing to commit: ${formatDirtyStatus(unexpected)}.`);
    }

    const gitIdentity = checkGitIdentity(workspace);
    if (!gitIdentity.ok) {
      throw new Error(gitIdentity.reason);
    }

    const stagePaths = ["openspec/changes", "openspec/specs"].filter((path) => fileExistsSync(join(workspace, path)));
    if (stagePaths.length === 0) {
      throw new Error("Archive produced OpenSpec changes but no stageable OpenSpec paths were found.");
    }

    runGit(workspace, ["add", "-A", ...stagePaths]);
    const staged = await gitStatusFromArgs(workspace, ["diff", "--cached", "--name-only"]);
    if (staged.length === 0) {
      throw new Error("Archive produced no staged OpenSpec changes after staging archive/spec paths.");
    }

    messages.push(`Committing archive paths: ${formatDirtyStatus(dirty)}.`);
    archiveBase = runGit(workspace, ["rev-parse", "HEAD"]).trim();
    runGit(workspace, ["commit", "-m", `chore: archive ${input.changeName}`]);
    archiveCommit = runGit(workspace, ["rev-parse", "HEAD"]).trim();
  } else {
    archiveCommit = runGit(workspace, ["rev-parse", "HEAD"]).trim();
    const parent = spawnSync("git", ["-C", workspace, "rev-parse", "HEAD^"], { encoding: "utf8" });
    archiveBase = parent.status === 0 ? parent.stdout.trim() : "";
    if (!archiveBase) {
      messages.push("Archive is already present in the base snapshot.");
      return `${messages.join("\n")}\n`;
    }
    messages.push(`Resuming publication of archive commit ${archiveCommit.slice(0, 8)}.`);
  }

  const fetch = spawnSync("git", ["-C", workspace, "fetch", "--quiet", "origin", input.baseBranch], {
    env: childEnvForCwd(workspace),
    encoding: "utf8",
  });
  if (fetch.status !== 0) {
    throw new Error(`Archive committed locally but origin fetch failed before push: ${formatGitError(fetch)}`);
  }

  const remoteHead = runGit(workspace, ["rev-parse", `origin/${input.baseBranch}`]).trim();
  if (remoteHead !== archiveBase) {
    throw new ArchivePublishRaceError(archiveBase, remoteHead);
  }

  if ((config ?? defaultShipperConfig()).archive.publishMode === "pull-request") {
    const branch = `openspec-shipper/archive-${input.changeName}-${archiveCommit.slice(0, 8)}`;
    runGit(workspace, ["push", "-u", "origin", `HEAD:refs/heads/${branch}`]);
    const existing = detectOpenPullRequest(input.projectDir, branch);
    const existingUrl = await existing;
    if (existingUrl) {
      messages.push(`Archive pull request: ${existingUrl}`);
      return `${messages.join("\n")}\n`;
    }
    const created = runGh(workspace, [
      "pr", "create", "--base", input.baseBranch, "--head", branch,
      "--title", `chore: archive ${input.changeName}`,
      "--body", `OpenSpec archive reconciliation for ${input.changeName}.`,
    ]).trim();
    const url = extractPullRequestUrl(created);
    if (!url) {
      throw new Error("gh pr create completed without returning an archive pull request URL.");
    }
    messages.push(`Archive pull request: ${url}`);
    return `${messages.join("\n")}\n`;
  }

  const push = spawnSync("git", ["-C", workspace, "push", "origin", `HEAD:refs/heads/${input.baseBranch}`, `--force-with-lease=refs/heads/${input.baseBranch}:${archiveBase}`], {
    env: childEnvForCwd(workspace),
    encoding: "utf8",
  });
  if (push.status !== 0) {
    throw new ArchivePublishRaceError(archiveBase, remoteHead, formatGitError(push));
  }

  messages.push(push.stdout.trim() || `Pushed archive commit to origin/${input.baseBranch}.`);
  return `${messages.filter(Boolean).join("\n")}\n`;
}

class ArchivePublishRaceError extends Error {
  constructor(readonly expectedBase: string, readonly actualBase: string, detail?: string) {
    super(
      `origin changed while publishing the archive (expected ${expectedBase.slice(0, 8)}, found ${actualBase.slice(0, 8)}). The archive must be recalculated${detail ? `: ${detail}` : "."}`,
    );
  }
}

function isAllowedArchiveStatus(entry: string): boolean {
  const path = statusPath(entry);
  return path.startsWith("openspec/changes/") || path.startsWith("openspec/specs/");
}

function statusPath(entry: string): string {
  const renamed = entry.match(/^R\s+(.+?)\s+->\s+(.+)$/);
  if (renamed?.[2]) {
    return renamed[2].trim();
  }

  return entry.slice(3).trim();
}

async function gitStatusFromArgs(projectDir: string, args: string[]): Promise<string[]> {
  const result = spawnSync("git", ["-C", projectDir, ...args], {
    env: childEnvForCwd(projectDir),
    encoding: "utf8",
  });
  if (result.status !== 0) {
    return [];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);
}

export async function cleanupWorkspace(input: CleanupWorkspaceInput): Promise<string> {
  const baseBranch = readShipperConfigSync(input.projectDir)?.baseBranch ?? "main";
  const origin = spawnSync("git", ["-C", input.projectDir, "remote", "get-url", "origin"], { encoding: "utf8" });
  if (origin.status === 0) {
    const fetch = spawnSync("git", ["-C", input.projectDir, "fetch", "--quiet", "origin", baseBranch], {
      env: childEnvForCwd(input.projectDir),
      encoding: "utf8",
    });
    if (fetch.status !== 0) {
      throw new Error(`Cannot refresh origin/${baseBranch} before cleanup: ${formatGitError(fetch)}`);
    }
  }
  const archived = await detectArchivedChange(input.projectDir, input.changeName);
  if (!archived) {
    throw new Error(`OpenSpec change ${input.changeName} is not archived yet; cleanup is unsafe.`);
  }

  const messages = [
    `Cleaning ${input.changeName}`,
    `Project: ${input.projectDir}`,
    `Branch: ${input.branch}`,
    `Worktree: ${input.worktreeDir}`,
  ];

  if (await pathExists(input.worktreeDir)) {
    const dirty = filterLocalStateStatus(await detectGitStatus(input.worktreeDir));
    if (dirty.length > 0) {
      throw new Error(`Worktree ${input.worktreeDir} has uncommitted changes: ${formatDirtyStatus(dirty)}.`);
    }

    messages.push(runGit(input.projectDir, ["worktree", "remove", input.worktreeDir]).trim() || "Removed worktree.");
  } else {
    messages.push("Worktree already removed.");
  }

  if (localBranchExists(input.projectDir, input.branch)) {
    messages.push(await deleteLocalBranchAfterCleanup(input, archived));
  } else {
    messages.push("Local branch already removed.");
  }

  return `${messages.filter(Boolean).join("\n")}\n`;
}

async function deleteLocalBranchAfterCleanup(input: CleanupWorkspaceInput, archived: boolean): Promise<string> {
  try {
    return runGit(input.projectDir, ["branch", "-d", input.branch]).trim() || `Deleted local branch ${input.branch}.`;
  } catch (error) {
    const softDeleteError = error instanceof Error ? error.message : String(error);
    const mergedPullRequestUrl = await detectMergedPullRequest(input.projectDir, input.branch);
    const positiveEvidence = mergedPullRequestUrl
      ? `merged PR ${mergedPullRequestUrl}`
      : archived
        ? `archived OpenSpec change ${input.changeName}`
        : undefined;

    if (!positiveEvidence) {
      throw new Error(`git branch -d ${input.branch} failed and cleanup has no positive merge/archive evidence: ${softDeleteError}`);
    }

    const forcedDelete = runGit(input.projectDir, ["branch", "-D", input.branch]).trim() || `Force-deleted local branch ${input.branch}.`;
    return [
      `git branch -d ${input.branch} was rejected: ${softDeleteError}`,
      `Positive cleanup evidence found (${positiveEvidence}); force-deleting the local branch.`,
      forcedDelete,
    ].join("\n");
  }
}

export function ensureChangeArtifacts(worktreeDir: string, changeName: string): void {
  const changeDir = join(worktreeDir, "openspec", "changes", changeName);
  for (const relativePath of ["proposal.md", "tasks.md"]) {
    const path = join(changeDir, relativePath);
    if (!fileExistsSync(path)) {
      throw new Error(`Required change artifact is missing: ${relative(projectRootFromWorktree(worktreeDir), path)}.`);
    }
  }

  if (!containsDeltaSpec(join(changeDir, "specs"))) {
    throw new Error(`No OpenSpec delta spec found for ${changeName}.`);
  }
}

function containsDeltaSpec(directory: string): boolean {
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isFile() && entry.name === "spec.md") {
        return true;
      }
      if (entry.isDirectory() && containsDeltaSpec(join(directory, entry.name))) {
        return true;
      }
    }
  } catch {
    return false;
  }
  return false;
}

function projectRootFromWorktree(worktreeDir: string): string {
  return dirname(dirname(worktreeDir));
}

function fileExistsSync(path: string): boolean {
  return existsSync(path);
}

function runShell(cwd: string, command: string, label: string): string {
  const result = spawnSync(command, {
    cwd,
    env: childEnvForCwd(cwd),
    encoding: "utf8",
    shell: true,
    timeout: 120_000,
  });
  if (result.status !== 0) {
    throw new Error(`${label} failed: ${formatGitError(result)}`);
  }

  return result.stdout || result.stderr || `${label} passed.`;
}

class NativeTaskError extends Error {
  constructor(message: string, readonly logOutput: string) {
    super(message);
    this.name = "NativeTaskError";
  }
}

function runWorktreeInstall(cwd: string, command: string, timeoutMs: number): string {
  const result = spawnSync(command, {
    cwd,
    env: childEnvForCwd(cwd),
    encoding: "utf8",
    shell: true,
    timeout: timeoutMs,
  });
  const output = [
    `$ ${command}`,
    result.stdout?.trimEnd(),
    result.stderr?.trimEnd(),
  ].filter(Boolean).join("\n");

  if (result.error || result.status !== 0) {
    const detail = result.error?.message ?? firstNonEmptyLine(result.stderr || result.stdout) ?? `exited with code ${result.status}`;
    throw new NativeTaskError(
      `Dependency install failed in worktree; see log. ${detail}`,
      `${output || detail}\n`,
    );
  }

  const dependencyDir = join(cwd, "node_modules");
  if (existsSync(dependencyDir)) {
    const now = new Date();
    utimesSync(dependencyDir, now, now);
  }

  return output || "Worktree dependency installation passed.";
}

function runGh(cwd: string, args: string[]): string {
  const result = spawnSync("gh", args, {
    cwd,
    env: childEnvForCwd(cwd),
    encoding: "utf8",
    timeout: 30_000,
  });
  if (result.status !== 0) {
    throw new Error(`gh ${args.join(" ")} failed: ${formatGitError(result)}`);
  }

  return result.stdout;
}

function commitTypeFromBranch(branch: string): string {
  const type = branch.split("/")[0] ?? "chore";
  return /^(feat|fix|docs|refactor|test|chore|ci|build|perf)$/.test(type) ? type : "chore";
}

function localBranchExists(projectDir: string, branch: string): boolean {
  const result = spawnSync("git", ["-C", projectDir, "show-ref", "--verify", `refs/heads/${branch}`], {
    encoding: "utf8",
  });
  return result.status === 0;
}

function runGit(projectDir: string, args: string[]): string {
  const result = spawnSync("git", ["-C", projectDir, ...args], {
    env: childEnvForCwd(projectDir),
    encoding: "utf8",
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    const detail = firstNonEmptyLine(result.stderr || result.stdout) ?? `git ${args.join(" ")} exited with code ${result.status}`;
    throw new Error(detail);
  }

  return result.stdout;
}

function formatGitError(result: ReturnType<typeof spawnSync>): string {
  if (result.error) {
    return result.error.message;
  }

  return firstNonEmptyLine(`${result.stderr ?? ""}\n${result.stdout ?? ""}`) ?? `git exited with code ${result.status ?? "unknown"}`;
}

function commandResult(command: string, args: string[], cwd: string): { ok: true } | { ok: false; reason: string } {
  const result = spawnSync(command, args, {
    cwd,
    env: childEnvForCwd(cwd),
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error) {
    return { ok: false, reason: result.error.message };
  }

  if (result.status !== 0) {
    return { ok: false, reason: formatGitError(result) };
  }

  return { ok: true };
}

function checkGitIdentity(cwd: string): { ok: true } | { ok: false; reason: string } {
  const name = commandOutput("git", ["config", "--get", "user.name"], cwd);
  const email = commandOutput("git", ["config", "--get", "user.email"], cwd);
  const missing = [
    name.ok ? undefined : "user.name",
    email.ok ? undefined : "user.email",
  ].filter(Boolean);

  return missing.length === 0
    ? { ok: true }
    : {
        ok: false,
        reason: `Git identity is not configured (${missing.join(", ")}). Run git config user.name "Your Name" and git config user.email "you@example.com", then openspec-shipper doctor.`,
      };
}

function commandOutput(command: string, args: string[], cwd: string): { ok: true; output: string } | { ok: false; reason: string } {
  const result = spawnSync(command, args, {
    cwd,
    env: childEnvForCwd(cwd),
    encoding: "utf8",
    timeout: 10_000,
  });
  if (result.error) {
    return { ok: false, reason: result.error.message };
  }

  if (result.status !== 0 || !result.stdout.trim()) {
    return { ok: false, reason: formatGitError(result) };
  }

  return { ok: true, output: result.stdout.trim() };
}

async function changeHasExistingLocalClaim(projectDir: string, changeName: string): Promise<boolean> {
  if (await pathExists(join(projectDir, "worktrees", changeName))) {
    return true;
  }

  const branches = spawnSync("git", ["-C", projectDir, "for-each-ref", "--format=%(refname:short)", "refs/heads"], {
    encoding: "utf8",
  });
  if (branches.status !== 0) {
    return false;
  }

  return branches.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .some((line) => line === `feat/${changeName}`);
}

async function detectLocalClaimPublished(projectDir: string, changeName: string, branch: string): Promise<boolean> {
  const localHead = resolveLocalClaimHead(projectDir, changeName, branch);
  if (!localHead) {
    return false;
  }

  const remoteRef = `refs/remotes/origin/${branch}`;
  const containsLocalHead = spawnSync("git", ["-C", projectDir, "merge-base", "--is-ancestor", localHead, remoteRef], {
    encoding: "utf8",
  });
  if (containsLocalHead.status === 0) {
    return true;
  }

  const remoteRefResult = spawnSync("git", ["-C", projectDir, "ls-remote", "--heads", "origin", branch], {
    encoding: "utf8",
    timeout: 10_000,
  });
  if (remoteRefResult.status !== 0) {
    return false;
  }

  const [remoteHead] = remoteRefResult.stdout.trim().split(/\s+/);
  return Boolean(remoteHead) && remoteHead === localHead;
}

function resolveLocalClaimHead(projectDir: string, changeName: string, branch: string): string | undefined {
  const worktreeHead = spawnSync("git", ["-C", join(projectDir, "worktrees", changeName), "rev-parse", "HEAD"], {
    encoding: "utf8",
  });
  if (worktreeHead.status === 0) {
    return worktreeHead.stdout.trim();
  }

  const branchHead = spawnSync("git", ["-C", projectDir, "rev-parse", "--verify", branch], {
    encoding: "utf8",
  });
  return branchHead.status === 0 ? branchHead.stdout.trim() : undefined;
}

async function detectRemoteBranch(projectDir: string, branch: string): Promise<boolean> {
  const localRef = spawnSync("git", ["-C", projectDir, "show-ref", "--verify", `refs/remotes/origin/${branch}`], {
    encoding: "utf8",
  });
  if (localRef.status === 0) {
    return true;
  }

  const remoteRef = spawnSync("git", ["-C", projectDir, "ls-remote", "--heads", "origin", branch], {
    encoding: "utf8",
    timeout: 10_000,
  });
  return remoteRef.status === 0 && remoteRef.stdout.trim().length > 0;
}

async function detectActiveChange(projectDir: string, changeName: string): Promise<boolean> {
  const baseBranch = readShipperConfigSync(projectDir)?.baseBranch ?? "main";
  return gitTreePathExists(projectDir, `origin/${baseBranch}`, `openspec/changes/${changeName}`);
}

async function detectArchivedChange(projectDir: string, changeName: string): Promise<boolean> {
  const gitDir = spawnSync("git", ["-C", projectDir, "rev-parse", "--git-dir"], { encoding: "utf8" });
  if (gitDir.status === 0) {
    const baseBranch = readShipperConfigSync(projectDir)?.baseBranch ?? "main";
    const remoteBase = spawnSync("git", ["-C", projectDir, "rev-parse", "--verify", `origin/${baseBranch}`], { encoding: "utf8" });
    if (remoteBase.status === 0) {
      const entries = gitTreeEntries(projectDir, `origin/${baseBranch}`, "openspec/changes/archive");
      return entries.some((entry) => entry.endsWith(`-${changeName}`));
    }
  }

  return await detectArchivedChangeOnDisk(projectDir, changeName);
}

async function detectArchivedChangeOnDisk(projectDir: string, changeName: string): Promise<boolean> {
  const archiveDir = join(projectDir, "openspec", "changes", "archive");
  const entries = await readdir(archiveDir, { withFileTypes: true }).catch(() => []);
  const matches = entries
    .filter((entry) => entry.isDirectory() && entry.name.endsWith(`-${changeName}`))
    .map((entry) => join(archiveDir, entry.name));
  if (matches.length !== 1) {
    return false;
  }

  const [archivePath] = matches;
  return Boolean(
    archivePath &&
      (await pathExists(join(archivePath, "proposal.md"))) &&
      (await pathExists(join(archivePath, "tasks.md"))),
  );
}

async function detectTasksComplete(projectDir: string, changeName: string): Promise<boolean> {
  return (await detectTaskCompletionStatus(projectDir, changeName)).kind === "complete";
}

async function detectTaskCompletionStatus(projectDir: string, changeName: string): Promise<TaskCompletionStatus> {
  const tasksPath =
    (await firstExistingPath([
      join(projectDir, "worktrees", changeName, "openspec", "changes", changeName, "tasks.md"),
    ])) ?? "";
  if (!tasksPath) {
    return { kind: "missing" };
  }

  const content = await readFile(tasksPath, "utf8").catch(() => "");
  const taskCheckboxes = parseTaskCheckboxes(content);
  if (taskCheckboxes.length === 0) {
    return { kind: "no_checkboxes", tasksPath };
  }

  return taskCheckboxes.every((checked) => checked)
    ? { kind: "complete", tasksPath }
    : { kind: "incomplete", tasksPath };
}

function gitTreePathExists(projectDir: string, ref: string, path: string): boolean {
  const result = spawnSync("git", ["-C", projectDir, "cat-file", "-e", `${ref}:${path}`], { encoding: "utf8" });
  return result.status === 0;
}

function gitTreeEntries(projectDir: string, ref: string, path: string): string[] {
  const result = spawnSync("git", ["-C", projectDir, "ls-tree", "--name-only", `${ref}:${path}`], { encoding: "utf8" });
  return result.status === 0
    ? result.stdout.split(/\r?\n/).map((entry) => entry.trim()).filter(Boolean)
    : [];
}

function parseTaskCheckboxes(content: string): boolean[] {
  const checkboxPattern = /^[ \t]*(?:[-*+]|\d+[.)])[ \t]+\[([ xX])\]/gm;
  return [...content.matchAll(checkboxPattern)].map((match) => match[1]?.toLowerCase() === "x");
}

async function firstExistingPath(paths: string[]): Promise<string | undefined> {
  for (const path of paths) {
    if (await pathExists(path)) {
      return path;
    }
  }

  return undefined;
}

function formatDirtyStatus(status: string[]): string {
  const maxEntries = 6;
  const shown = status.slice(0, maxEntries).join(", ");
  const remaining = status.length - maxEntries;
  return remaining > 0 ? `${shown}, and ${remaining} more` : shown;
}

export function detectChangeBranch(projectDir: string, changeName: string): string {
  const worktreeBranch = spawnSync("git", ["-C", join(projectDir, "worktrees", changeName), "branch", "--show-current"], {
    encoding: "utf8",
  });
  const branchFromWorktree = worktreeBranch.status === 0 ? worktreeBranch.stdout.trim() : "";
  if (branchFromWorktree) {
    return branchFromWorktree;
  }

  const branches = spawnSync("git", ["-C", projectDir, "for-each-ref", "--format=%(refname:short)", "refs/heads"], {
    encoding: "utf8",
  });
  if (branches.status === 0) {
    const branch = branches.stdout
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line.endsWith(`/${changeName}`));
    if (branch) {
      return branch;
    }
  }

  return `feat/${changeName}`;
}

export async function detectOpenPullRequest(projectDir: string, branch: string): Promise<string | undefined> {
  const result = spawnSync("gh", ["pr", "list", "--head", branch, "--state", "open", "--json", "url", "--limit", "1"], {
    cwd: projectDir,
    env: childEnvForCwd(projectDir),
    encoding: "utf8",
  });
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

function extractPullRequestUrl(output: string): string | undefined {
  const match = output.match(/https:\/\/github\.com\/[^\s)]+\/pull\/\d+/);
  return match?.[0];
}

export async function detectMergedPullRequest(projectDir: string, branch: string): Promise<string | undefined> {
  const result = spawnSync(
    "gh",
    ["pr", "list", "--head", branch, "--state", "merged", "--json", "url", "--limit", "1"],
    {
      cwd: projectDir,
      env: childEnvForCwd(projectDir),
      encoding: "utf8",
    },
  );
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

function describeProcess(pid: string): string {
  const result = spawnSync("ps", ["-p", pid, "-o", "pid=,etime=,command="], { encoding: "utf8" });
  if (result.status !== 0) {
    return pid;
  }

  return result.stdout.trim().replace(/\s+/g, " ") || pid;
}

function printStatus(tasks: QueueTask[], config: RunnerConfig) {
  const counts = {
    pending: tasks.filter((task) => task.status === "pending").length,
    done: tasks.filter((task) => task.status === "done").length,
    blocked: tasks.filter((task) => task.status === "blocked").length,
  };

  console.log(`Queue status: ${counts.pending} pending, ${counts.done} done, ${counts.blocked} blocked`);

  const blocked = findBlockedTasks(tasks);
  if (blocked.length > 0) {
    if (blockedTasksExceedLimit(blocked, config)) {
      printBlockedPause("Paused by", blocked, config);
      return;
    } else {
      printBlockedSkip("Skipped blocked task(s)", blocked, config);
    }
  }

  const next = findFirstRunnableTask(tasks);
  if (next) {
    console.log(`Next runnable: ${next.rawCommand}`);
    return;
  }

  const waiting = findWaitingTasks(tasks);
  if (waiting.length > 0) {
    console.log(`Waiting for dependencies: ${waiting.length}`);
    for (const task of waiting) {
      console.log(`- ${task.rawCommand} ${waitingReason(task)}`);
    }
  }
}

function waitingReason(task: QueueTask): string {
  if (task.action === "deliver" && task.phase === "waiting_for_merge") {
    return "waits for its PR to merge";
  }

  if (["archive", "publish_archive", "waiting_for_archive_merge", "cleanup_worktree"].includes(deliverPhase(task))) {
    if (task.archiveAfter.length > 0) {
      return `waits to archive after ${task.archiveAfter.join(", ")} (declared in queue.md)`;
    }
    if (task.inferredArchiveAfter.length > 0) {
      return task.inferredArchiveAfter.map((dependency) => {
        const requirements = task.inferredArchiveReasons[dependency] ?? [];
        const reason = requirements.length > 0
          ? `both modify ${requirements.map((requirement) => `requirement \"${requirement}\"`).join(", ")}`
          : "shared OpenSpec requirements";
        return `waits for ${dependency} (inferred: ${reason})`;
      }).join("; ");
    }
  }

  return `waits for ${task.dependsOn.join(", ")}`;
}

function blockedTasksExceedLimit(blockedTasks: QueueTask[], config: RunnerConfig): boolean {
  return blockedTasks.length > config.maxBlockedTasks;
}

function printBlockedPause(prefix: string, blockedTasks: QueueTask[], config: RunnerConfig) {
  console.log(`${prefix}: ${blockedTasks.length} blocked task(s) found; limit is ${config.maxBlockedTasks}.`);
  for (const task of blockedTasks) {
    console.log(`- ${task.rawCommand}`);
  }
}

function printBlockedSkip(prefix: string, blockedTasks: QueueTask[], config: RunnerConfig) {
  console.log(`${prefix}: ${blockedTasks.length}/${config.maxBlockedTasks} blocked task(s).`);
  for (const task of blockedTasks) {
    console.log(`- ${task.rawCommand}`);
  }
}

function capOutput(value: string): string {
  const maxLength = 2_000_000;
  return value.length > maxLength ? value.slice(value.length - maxLength) : value;
}

function shellQuote(value: string): string {
  return /^[a-zA-Z0-9_./:=@-]+$/.test(value) ? value : JSON.stringify(value);
}

function formatCommand(command: string, args: string[]): string {
  return [command, ...args].map(shellQuote).join(" ");
}

function toMarkdownPath(path: string): string {
  return path.split("\\").join("/");
}

function buildStatsOptions(config: RunnerConfig): StatsOptions | undefined {
  if (!config.opencodeStats) {
    return undefined;
  }

  return {
    command: config.opencodeBin,
    cwd: config.projectDir,
    intervalMs: config.opencodeStatsIntervalMs,
    timeoutMs: config.opencodeStatsTimeoutMs,
    project: config.opencodeStatsProject,
    models: config.opencodeStatsModels,
    days: config.opencodeStatsDays,
  };
}

function formatStatsPolling(config: RunnerConfig): string {
  const stats = buildStatsOptions(config);
  if (!stats) {
    return "disabled";
  }

  return `every ${formatDuration(stats.intervalMs)} via ${formatCommand(stats.command, buildStatsArgs(stats))}`;
}

function formatStatsSnapshot(
  stats: StatsOptions | undefined,
  now: number,
  state: {
    lastStatsAt: number;
    lastStatsError: string | undefined;
    update: (next: { lastStatsAt: number; lastStatsError: string | undefined }) => void;
  },
): string {
  if (!stats || stats.intervalMs <= 0 || now - state.lastStatsAt < stats.intervalMs) {
    return "";
  }

  const previousStatsError = state.lastStatsError;
  const result = readOpenCodeStats(stats);
  state.update({
    lastStatsAt: now,
    lastStatsError: result.ok ? undefined : result.message,
  });

  if (result.ok) {
    return `\nOpenCode stats:\n${indentBlock(result.message)}`;
  }

  if (result.message === previousStatsError) {
    return "";
  }

  return `\nOpenCode stats unavailable: ${result.message}`;
}

function readOpenCodeStats(stats: StatsOptions): { ok: true; message: string } | { ok: false; message: string } {
  const result = spawnSync(stats.command, buildStatsArgs(stats), {
    cwd: stats.cwd,
    env: childEnvForCwd(stats.cwd),
    encoding: "utf8",
    timeout: stats.timeoutMs,
  });

  if (result.error) {
    return { ok: false, message: result.error.message };
  }

  if (result.status !== 0) {
    return { ok: false, message: firstNonEmptyLine(result.stderr || result.stdout) ?? `exited with code ${result.status}` };
  }

  return { ok: true, message: trimStatsOutput(result.stdout) || "(no stats output)" };
}

function buildStatsArgs(stats: StatsOptions): string[] {
  const args = ["stats", "--project", stats.project];
  if (stats.models) {
    args.push("--models", stats.models);
  }
  if (stats.days) {
    args.push("--days", stats.days);
  }
  return args;
}

function trimStatsOutput(output: string): string {
  return output.trimEnd();
}

function firstNonEmptyLine(output: string): string | undefined {
  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);
}

function indentBlock(value: string): string {
  return value
    .split(/\r?\n/)
    .map((line) => `  ${line}`)
    .join("\n");
}

function printBusyWait(
  reason: string,
  previous: { reason: string; firstSeenAt: number; checks: number } | undefined,
  busyDelayMs: number,
) {
  const now = Date.now();
  const state =
    previous && previous.reason === reason
      ? { ...previous, checks: previous.checks + 1 }
      : { reason, firstSeenAt: now, checks: 1 };

  if (state.checks === 1) {
    console.log(`Queue busy before spending tokens:\n${reason}`);
    console.log("The queue will not start another executor worker while this process is active.");
    console.log("Stop stale processes, or set OPENSPEC_SHIPPER_ALLOW_ACTIVE_EXECUTOR to a higher number.");
  } else {
    console.log(
      `Still busy after ${formatDuration(now - state.firstSeenAt)} (${state.checks} checks): same executor process(es).`,
    );
  }

  console.log(`Next check in ${formatDuration(busyDelayMs)}.`);
  return state;
}

function childEnvForCwd(cwd: string): NodeJS.ProcessEnv {
  const pathKey = process.platform === "win32" ? "Path" : "PATH";
  const currentPath = process.env[pathKey] ?? "";
  const projectBin = join(cwd, "node_modules", ".bin");

  return {
    ...process.env,
    [pathKey]: currentPath
      ? `${projectBin}${delimiter}${currentPath}`
      : projectBin,
    INIT_CWD: cwd,
    PWD: cwd,
  };
}

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parsePositiveInt(value: string | undefined, fallback: number): number {
  if (!value) {
    return fallback;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function optionalPositiveNumber(name: string): number | undefined {
  const value = optionalEnv(name);
  if (!value) {
    return undefined;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
}

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing required environment variable ${name}. Add it to .env or export it before running.`);
  }

  return value;
}

function optionalEnv(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

function formatDuration(ms: number): string {
  if (ms < 1000) {
    return `${ms}ms`;
  }

  const seconds = Math.round(ms / 1000);
  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return remainder === 0 ? `${minutes}m` : `${minutes}m ${remainder}s`;
}

function isNotFoundError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await readFile(path);
    return true;
  } catch {
    return false;
  }
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}
