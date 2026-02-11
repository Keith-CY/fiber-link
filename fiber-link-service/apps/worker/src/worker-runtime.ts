import { runWithdrawalBatch as runWithdrawalBatchDefault } from "./withdrawal-batch";

type WorkerLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown) => void;
};

type RunWithdrawalBatchFn = (options: { maxRetries: number; retryDelayMs: number }) => Promise<unknown>;

export type CreateWorkerRuntimeOptions = {
  intervalMs: number;
  maxRetries: number;
  retryDelayMs: number;
  shutdownTimeoutMs: number;
  runWithdrawalBatch?: RunWithdrawalBatchFn;
  setIntervalFn?: typeof setInterval;
  clearIntervalFn?: typeof clearInterval;
  exitFn?: (code: number) => void;
  logger?: WorkerLogger;
};

export type WorkerRuntime = {
  start: () => Promise<void>;
  shutdown: (signal: NodeJS.Signals | "manual") => Promise<void>;
};

const defaultLogger: WorkerLogger = {
  info(message, context) {
    console.log(message, context ?? {});
  },
  warn(message, context) {
    console.warn(message, context ?? {});
  },
  error(message, error) {
    console.error(message, error);
  },
};

async function waitForDrain(batchPromise: Promise<void>, timeoutMs: number): Promise<boolean> {
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  try {
    const result = await Promise.race([
      batchPromise.then(() => "drained" as const),
      new Promise<"timeout">((resolve) => {
        timeoutId = setTimeout(() => resolve("timeout"), timeoutMs);
      }),
    ]);
    return result === "drained";
  } finally {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
  }
}

export function createWorkerRuntime(options: CreateWorkerRuntimeOptions): WorkerRuntime {
  const runWithdrawalBatch = options.runWithdrawalBatch ?? runWithdrawalBatchDefault;
  const setIntervalFn = options.setIntervalFn ?? setInterval;
  const clearIntervalFn = options.clearIntervalFn ?? clearInterval;
  const exitFn = options.exitFn ?? process.exit;
  const logger = options.logger ?? defaultLogger;

  let timer: ReturnType<typeof setInterval> | null = null;
  let inFlightBatch: Promise<void> | null = null;
  let shuttingDown = false;
  let shutdownPromise: Promise<void> | null = null;

  async function processWithdrawals() {
    if (shuttingDown) {
      return;
    }
    if (inFlightBatch) {
      logger.warn("[worker] previous withdrawal batch still running; skipping tick", {
        intervalMs: options.intervalMs,
      });
      return;
    }

    inFlightBatch = (async () => {
      try {
        const result = await runWithdrawalBatch({
          maxRetries: options.maxRetries,
          retryDelayMs: options.retryDelayMs,
        });
        logger.info("[worker] withdrawal batch", {
          result,
        });
      } catch (error) {
        logger.error("[worker] withdrawal batch failed", error);
      } finally {
        inFlightBatch = null;
      }
    })();

    await inFlightBatch;
  }

  async function start() {
    await processWithdrawals();
    if (shuttingDown) {
      return;
    }
    timer = setIntervalFn(() => {
      void processWithdrawals();
    }, options.intervalMs);
    logger.info("[worker] started", {
      withdrawalIntervalMs: options.intervalMs,
      maxRetries: options.maxRetries,
      retryDelayMs: options.retryDelayMs,
      shutdownTimeoutMs: options.shutdownTimeoutMs,
    });
  }

  async function shutdown(signal: NodeJS.Signals | "manual") {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shuttingDown = true;
    shutdownPromise = (async () => {
      if (timer) {
        clearIntervalFn(timer);
        timer = null;
      }

      let exitCode = 0;
      if (inFlightBatch) {
        const drained = await waitForDrain(inFlightBatch, options.shutdownTimeoutMs);
        if (!drained) {
          exitCode = 1;
          logger.error("[worker] shutdown drain timed out; exiting with in-flight work", {
            signal,
            shutdownTimeoutMs: options.shutdownTimeoutMs,
          });
        }
      }

      logger.info("[worker] shutdown", { signal, exitCode });
      exitFn(exitCode);
    })();

    return shutdownPromise;
  }

  return {
    start,
    shutdown,
  };
}
