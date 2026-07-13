import { afterEach, beforeEach, mock } from "bun:test";

type ConsoleMethod = (...args: unknown[]) => void;

export function silenceConsoleDuringTests() {
  let originalLog: ConsoleMethod;
  let originalError: ConsoleMethod;
  let originalWarn: ConsoleMethod;

  beforeEach(() => {
    originalLog = console.log;
    originalError = console.error;
    originalWarn = console.warn;
    console.log = mock(() => {}) as ConsoleMethod;
    console.error = mock(() => {}) as ConsoleMethod;
    console.warn = mock(() => {}) as ConsoleMethod;
  });

  afterEach(() => {
    console.log = originalLog;
    console.error = originalError;
    console.warn = originalWarn;
  });
}
