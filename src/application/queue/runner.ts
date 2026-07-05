import { spawn, spawnSync } from "node:child_process";
import { createWriteStream, rmSync, writeFileSync } from "node:fs";
import { mkdir, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { delimiter, dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import {
  advanceDeliverTask,
  deliverPhase,
  findBlockedTasks,
  findFirstRunnableTask,
  findWaitingTasks,
  markTask,
  parseQueue,
  taskSlug,
  type QueueTask,
} from "../../domain/queue/queue.js";
import type { ExecutorProviderId, ProviderCommand } from "../../domain/provider/provider.js";
import { DEFAULT_QUEUE_PATH, DEFAULT_STATE_DIR } from "../../domain/config/shipper-config.js";
import { providerById } from "../../infrastructure/providers/registry.js";
import { openCodeCommandName } from "../../infrastructure/providers/opencode/provider.js";

export type RunnerMode = "next" | "run" | "status" | "dry-run" | "stop" | "stats";

export type RunnerConfig = {
  rootDir: string;
  projectDir: string;
  queuePath: string;
  stateDir: string;
  providerId?: ExecutorProviderId;
  opencodeBin: string;
  opencodeModel?: string;
  codexBin?: string;
  codexModel?: string;
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
  executor?: Executor;
  processDetector?: ProcessDetector;
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
};

export type ProcessDetector = () => Promise<string[]>;
export type Sleep = (ms: number) => Promise<void>;

const DEFAULT_LOOP_DELAY_MS = 120_000;
const DEFAULT_BUSY_DELAY_MS = 60_000;
const DEFAULT_TASK_TIMEOUT_MS = 90 * 60_000;
const DEFAULT_HEARTBEAT_MS = 60_000;
const DEFAULT_STATS_INTERVAL_MS = 120_000;
const DEFAULT_STATS_TIMEOUT_MS = 10_000;
const KILL_GRACE_MS = 10_000;
const SIGINT_DUPLICATE_GRACE_MS = 1_500;
const ROOT_DIR = fileURLToPath(new URL("../../..", import.meta.url));
let activeChildProcess: ReturnType<typeof spawn> | undefined;

export function defaultConfig(): RunnerConfig {
  const rootDir = ROOT_DIR;
  const projectDir = process.env.OPENSPEC_SHIPPER_PROJECT_DIR ?? process.env.PROJECT_DIR ?? process.cwd();
  const stateDir = process.env.OPENSPEC_SHIPPER_STATE_DIR ?? join(projectDir, DEFAULT_STATE_DIR);

  return {
    rootDir,
    projectDir,
    queuePath: process.env.OPENSPEC_SHIPPER_QUEUE_PATH ?? process.env.QUEUE_PATH ?? join(projectDir, DEFAULT_QUEUE_PATH),
    stateDir,
    providerId: (process.env.OPENSPEC_SHIPPER_PROVIDER as ExecutorProviderId | undefined) ?? "opencode",
    opencodeBin: process.env.OPENSPEC_SHIPPER_OPENCODE_BIN ?? process.env.OPENCODE_BIN ?? "opencode",
    opencodeModel: optionalEnv("OPENSPEC_SHIPPER_OPENCODE_MODEL") ?? optionalEnv("OPENCODE_MODEL"),
    codexBin: process.env.OPENSPEC_SHIPPER_CODEX_BIN ?? "codex",
    codexModel: optionalEnv("OPENSPEC_SHIPPER_CODEX_MODEL"),
    opencodePrintLogs: (process.env.OPENSPEC_SHIPPER_PRINT_LOGS ?? process.env.OPENCODE_PRINT_LOGS) === "1",
    opencodeLogLevel: optionalEnv("OPENSPEC_SHIPPER_LOG_LEVEL") ?? optionalEnv("OPENCODE_LOG_LEVEL"),
    opencodeStats: (process.env.OPENSPEC_SHIPPER_STATS ?? process.env.OPENCODE_STATS) === "1",
    opencodeStatsIntervalMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_STATS_INTERVAL_MS ?? process.env.OPENCODE_STATS_INTERVAL_MS, DEFAULT_STATS_INTERVAL_MS),
    opencodeStatsTimeoutMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_STATS_TIMEOUT_MS ?? process.env.OPENCODE_STATS_TIMEOUT_MS, DEFAULT_STATS_TIMEOUT_MS),
    opencodeStatsProject: process.env.OPENSPEC_SHIPPER_STATS_PROJECT ?? process.env.OPENCODE_STATS_PROJECT ?? "",
    opencodeStatsModels: optionalEnv("OPENSPEC_SHIPPER_STATS_MODELS") ?? optionalEnv("OPENCODE_STATS_MODELS"),
    opencodeStatsDays: optionalEnv("OPENSPEC_SHIPPER_STATS_DAYS") ?? optionalEnv("OPENCODE_STATS_DAYS"),
    loopDelayMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_LOOP_DELAY_MS ?? process.env.ORCHESTER_LOOP_DELAY_MS, DEFAULT_LOOP_DELAY_MS),
    busyDelayMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_BUSY_DELAY_MS ?? process.env.ORCHESTER_BUSY_DELAY_MS, DEFAULT_BUSY_DELAY_MS),
    taskTimeoutMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_TASK_TIMEOUT_MS ?? process.env.ORCHESTER_TASK_TIMEOUT_MS, DEFAULT_TASK_TIMEOUT_MS),
    heartbeatMs: parsePositiveInt(process.env.OPENSPEC_SHIPPER_HEARTBEAT_MS ?? process.env.ORCHESTER_HEARTBEAT_MS, DEFAULT_HEARTBEAT_MS),
    maxBlockedTasks: parsePositiveInt(process.env.OPENSPEC_SHIPPER_MAX_BLOCKED_TASKS ?? process.env.ORCHESTER_MAX_BLOCKED_TASKS, 0),
  };
}

export async function runQueue(mode: RunnerMode, config: RunnerConfig): Promise<number> {
  if (mode === "stop") {
    return await requestStop(config);
  }

  if (mode === "stats") {
    return printOpenCodeStats(config);
  }

  const queue = await loadQueue(config.queuePath);

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

  const providerCommand = buildConfiguredProviderCommand(config, pendingTask);

  if (mode === "dry-run") {
    console.log(`Next task: ${pendingTask.rawCommand}`);
    console.log(`Command: ${formatCommand(providerCommand.command, providerCommand.args)}`);
    console.log(`Cwd: ${providerCommand.cwd}`);
    if (config.opencodeStats) {
      console.log(`Stats: ${formatStatsPolling(config)}`);
    }
    const preflight = await validateTaskPreflight(config, pendingTask);
    console.log(`Command file: ${preflight.commandPath}`);
    if (!preflight.ok) {
      console.log(`Preflight: ${preflight.reason}`);
      return 1;
    }

    console.log("Preflight: ok");
    return 0;
  }

  if (mode === "run") {
    return await runLoopWithLock(config);
  }

  return await runSingleTaskWithLock(config, queue.lines, pendingTask, providerCommand);
}

async function runSingleTaskWithLock(
  config: RunnerConfig,
  lines: string[],
  task: QueueTask,
  providerCommand: ProviderCommand,
): Promise<number> {
  const lockPath = join(config.stateDir, "shipper.lock");
  const lock = await acquireLock(config, lockPath, task.rawCommand, "immediate");
  if (!lock.acquired) {
    return 1;
  }

  try {
    const preflight = await blockOnFailedPreflight(config, lines, task);
    if (preflight.blocked) {
      return 1;
    }

    const processCheck = await checkActiveOpenCode(config);
    if (processCheck.busy) {
      console.error(`Queue busy before spending tokens: ${processCheck.reason}`);
      return 1;
    }

    return await executeTask(config, lines, task, providerCommand);
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

      const queue = await loadQueue(config.queuePath);
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

      const processCheck = await checkActiveOpenCode(config);
      if (processCheck.busy) {
        busyState = printBusyWait(processCheck.reason, busyState, config.busyDelayMs);
        if (await waitOrStop(config, sleep, config.busyDelayMs)) {
          console.log("Queue stop requested. Exiting while waiting for active OpenCode process.");
          return 0;
        }
        continue;
      }

      busyState = undefined;
      const exitCode = await executeTask(config, queue.lines, pendingTask, buildConfiguredProviderCommand(config, pendingTask));
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
  if (await fileExists(lockPath)) {
    console.log(`Queue is already running: lock exists at ${lockPath}`);
    return { acquired: false };
  }

  await mkdir(config.stateDir, { recursive: true });
  await writeFile(
    lockPath,
    JSON.stringify(
      {
        pid: process.pid,
        startedAt: config.now?.().toISOString() ?? new Date().toISOString(),
        task,
      },
      null,
      2,
    ),
  );

  let released = false;
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
      rmSync(lockPath, { force: true });
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
      process.removeListener("SIGINT", signalHandler);
      process.removeListener("SIGTERM", signalHandler);
      await rm(lockPath, { force: true });
    },
  };
}

async function checkActiveOpenCode(config: RunnerConfig): Promise<{ busy: false } | { busy: true; reason: string }> {
  const detector = config.processDetector ?? detectActiveOpenCodeProcesses;
  const activeProcesses = await detector();
  if (activeProcesses.length === 0) {
    return { busy: false };
  }

  return { busy: true, reason: `active opencode process(es):\n${activeProcesses.map((process) => `- ${process}`).join("\n")}` };
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
  const commandName = openCodeCommandName(task.action === "deliver" ? deliverPhase(task) : task.action);
  if (provider(config).id !== "opencode") {
    return { ok: true, commandPath: "(provider does not use OpenCode command files)" };
  }
  const commandPath = join(config.projectDir, ".opencode", "commands", `${commandName}.md`);

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

async function executeTask(
  config: RunnerConfig,
  lines: string[],
  task: QueueTask,
  providerCommand: ProviderCommand,
): Promise<number> {
  const timestamp = (config.now?.() ?? new Date()).toISOString();
  const logPath = await createRunLogPath(config, task, timestamp);
  const executor = config.executor ?? spawnExecutor;

  console.log(`[${timestamp}] running: ${task.rawCommand}`);
  console.log(`Command: ${formatCommand(providerCommand.command, providerCommand.args)}`);
  console.log(`Cwd: ${providerCommand.cwd}`);
  console.log(`Env PWD: ${providerCommand.cwd}`);
  console.log(`Log: ${relative(config.rootDir, logPath)}`);

  const result = await executor(providerCommand.command, providerCommand.args, {
    cwd: providerCommand.cwd,
    logPath,
    timeoutMs: config.taskTimeoutMs,
    heartbeatMs: config.heartbeatMs,
    stats: buildStatsOptions(config),
  }).catch((error: unknown) => ({
    exitCode: null,
    output: error instanceof Error ? error.message : String(error),
  }));

  const failureSignal = provider(config).detectFailureSignal(result.output);
  if (result.exitCode === 0 && !failureSignal) {
    const nextContent = advanceDeliverTask(lines, task, {
      timestamp,
      logPath: relative(config.rootDir, logPath),
    });
    await writeFile(config.queuePath, nextContent);
    console.log(`[${new Date().toISOString()}] completed: ${task.rawCommand}`);
    return 0;
  }

  const reason =
    failureSignal ?? (result.exitCode === null ? result.output : `command exited with code ${result.exitCode}`);
  const nextContent = markTask(lines, task, "blocked", {
    timestamp,
    reason,
    logPath: relative(config.rootDir, logPath),
  });
  await writeFile(config.queuePath, nextContent);
  console.error(`[${new Date().toISOString()}] blocked: ${reason}`);
  return 1;
}

async function loadQueue(queuePath: string) {
  const content = await readFile(queuePath, "utf8");
  return parseQueue(content);
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

async function createRunLogPath(config: RunnerConfig, task: QueueTask, timestamp: string) {
  const runsDir = join(config.stateDir, "runs");
  await mkdir(runsDir, { recursive: true });
  return join(runsDir, `${timestamp.replace(/[:.]/g, "-")}-${taskSlug(task)}.log`);
}

async function requestStop(config: RunnerConfig): Promise<number> {
  await mkdir(config.stateDir, { recursive: true });
  await writeFile(stopPath(config), stopRequestContent());
  console.log(`Stop requested: ${stopPath(config)}`);
  console.log("A running queue:run will exit before starting another OpenCode task.");
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
  return provider(config).buildCommand({
    phase: task.action === "deliver" ? deliverPhase(task) : task.action,
    task,
    projectDir: config.projectDir,
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
        },
      },
      opencodePrintLogs: config.opencodePrintLogs,
      opencodeLogLevel: config.opencodeLogLevel,
    },
  });
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
      env: childEnvForCwd(options.cwd),
      detached: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    activeChildProcess = child;
    const log = createWriteStream(options.logPath, { flags: "a" });
    let output = "";
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

      const message = `\nOpenSpec Shipper task timed out after ${formatDuration(options.timeoutMs)}; terminating OpenCode.\n`;
      output = capOutput(`${output}${message}`);
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
        )} elapsed, ${formatDuration(now - lastChildOutputAt)} since last OpenCode output. Log: ${
          options.logPath
        }${formatStatsSnapshot(options.stats, now, {
          lastStatsAt,
          lastStatsError,
          update: (next) => {
            lastStatsAt = next.lastStatsAt;
            lastStatsError = next.lastStatsError;
          },
        })}\n`;
        output = capOutput(`${output}${message}`);
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

    child.stdout.on("data", (chunk: Buffer) => capture(chunk, process.stdout));
    child.stderr.on("data", (chunk: Buffer) => capture(chunk, process.stderr));
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
      resolve({ exitCode, output });
    });
  });
}

export async function detectActiveOpenCodeProcesses(): Promise<string[]> {
  if (process.env.OPENSPEC_SHIPPER_ALLOW_ACTIVE_EXECUTOR === "1" || process.env.ORCHESTER_ALLOW_ACTIVE_OPENCODE === "1") {
    return [];
  }

  const result = spawnSync("pgrep", ["-x", "opencode"], { encoding: "utf8" });
  if (result.status === 1) {
    return [];
  }

  if (result.status !== 0) {
    return [`pgrep failed with code ${result.status ?? "unknown"}`];
  }

  return result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map(describeProcess);
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
    console.log("The queue will not start another OpenCode worker while this process is active.");
    console.log("Stop that process if it is stale, or set OPENSPEC_SHIPPER_ALLOW_ACTIVE_EXECUTOR=1 to override.");
  } else {
    console.log(
      `Still busy after ${formatDuration(now - state.firstSeenAt)} (${state.checks} checks): same opencode process(es).`,
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
