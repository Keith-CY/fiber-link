export type WorkerLogLevel = "info" | "warn" | "error";

export type WorkerLogContext = Record<string, unknown>;

export type WorkerLogPayload = {
  component: string;
  event: string;
  severity: WorkerLogLevel;
  message: string;
  correlation?: Record<string, string>;
  timestamp: string;
};

export type WorkerLogger = {
  info: (message: string, context?: WorkerLogContext) => void;
  warn: (message: string, context?: WorkerLogContext) => void;
  error: (message: string, context?: WorkerLogContext) => void;
};

function normalizeValue(value: unknown): unknown {
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === "bigint") {
    return value.toString();
  }
  if (Array.isArray(value)) {
    return value.map((item) => normalizeValue(item));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const normalized: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(record)) {
      normalized[key] = normalizeValue(item);
    }
    return normalized;
  }
  return value;
}

export function buildWorkerLogPayload(
  component: string,
  event: string,
  severity: WorkerLogLevel,
  message: string,
  context?: WorkerLogContext,
  correlation?: Record<string, string>,
): WorkerLogPayload {
  return {
    component,
    event,
    severity,
    message,
    timestamp: new Date().toISOString(),
    ...normalizeValue(context ?? {}) as WorkerLogContext,
    ...(correlation && Object.keys(correlation).length > 0 ? { correlation } : {}),
  };
}

export function logWithContract(
  logger: WorkerLogger,
  level: WorkerLogLevel,
  component: string,
  event: string,
  message: string,
  context?: WorkerLogContext,
  correlation?: Record<string, string>,
) {
  logger[level](message, buildWorkerLogPayload(component, event, level, message, context, correlation));
}

export const defaultWorkerLogger: WorkerLogger = {
  info(message, context) {
    console.log(message, context ?? {});
  },
  warn(message, context) {
    console.warn(message, context ?? {});
  },
  error(message, context) {
    console.error(message, context ?? {});
  },
};
