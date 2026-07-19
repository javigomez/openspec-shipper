const LOCAL_STATE_PATHS = [
  ".openspec-shipper/.env",
  ".openspec-shipper/queue.md",
  ".openspec-shipper/shipper.lock",
  ".openspec-shipper/stop",
];

const LOCAL_STATE_PREFIXES = [
  ".openspec-shipper/runs/",
  ".openspec-shipper/tmp/",
  ".openspec-shipper/workspaces/",
  "worktrees/",
];

export function isLocalStateStatus(statusLine: string): boolean {
  const normalized = statusLine.replace(/\\/g, "/");
  return (
    LOCAL_STATE_PATHS.some((path) => normalized.includes(path)) ||
    LOCAL_STATE_PREFIXES.some((path) => normalized.includes(path))
  );
}

export function filterLocalStateStatus(status: string[]): string[] {
  return status.filter((line) => !isLocalStateStatus(line));
}
