const DEFAULT_ATTEMPTS = 8;
const DEFAULT_INITIAL_DELAY_MS = 2_000;
const DEFAULT_MAX_DELAY_MS = 10_000;

export async function verifyPublishedVersion(options) {
  const {
    capture,
    packageName,
    expectedVersion,
    registry,
    attempts = DEFAULT_ATTEMPTS,
    initialDelayMs = DEFAULT_INITIAL_DELAY_MS,
    maxDelayMs = DEFAULT_MAX_DELAY_MS,
    sleep = defaultSleep,
    onRetry = () => {},
  } = options;
  const totalAttempts = positiveInteger(attempts, DEFAULT_ATTEMPTS);
  let delayMs = positiveInteger(initialDelayMs, DEFAULT_INITIAL_DELAY_MS);
  const maximumDelayMs = positiveInteger(maxDelayMs, DEFAULT_MAX_DELAY_MS);
  let lastResult = verificationFailure("npm view was not executed", null, "");

  for (let attempt = 1; attempt <= totalAttempts; attempt += 1) {
    const result = capture("npm", [
      "view",
      `${packageName}@${expectedVersion}`,
      "version",
      "--prefer-online",
      "--registry",
      registry,
    ]);
    const registryVersion = result.stdout?.trim() ?? "";
    if (result.status === 0 && registryVersion === expectedVersion) {
      return {
        ok: true,
        version: registryVersion,
        attempts: attempt,
      };
    }

    lastResult = verificationFailure(
      verificationDetail(result, registryVersion, expectedVersion),
      result.status,
      registryVersion,
    );
    if (attempt === totalAttempts) {
      break;
    }

    onRetry({
      attempt,
      totalAttempts,
      delayMs,
      detail: lastResult.detail,
    });
    await sleep(delayMs);
    delayMs = Math.min(delayMs * 2, maximumDelayMs);
  }

  return {
    ok: false,
    attempts: totalAttempts,
    ...lastResult,
  };
}

function verificationFailure(detail, status, registryVersion) {
  return { detail, status, registryVersion };
}

function verificationDetail(result, registryVersion, expectedVersion) {
  const stderr = firstNonEmptyLine(result.stderr ?? "");
  if (stderr) {
    return stderr;
  }
  if (result.error?.message) {
    return result.error.message;
  }
  if (registryVersion) {
    return `registry returned ${registryVersion} instead of ${expectedVersion}`;
  }
  return `registry returned no version (exit ${result.status ?? "unknown"})`;
}

function firstNonEmptyLine(value) {
  return value.split(/\r?\n/).map((line) => line.trim()).find(Boolean);
}

function positiveInteger(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function defaultSleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
