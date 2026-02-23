export type WorkerLogSeverity = "info" | "warn" | "error";

export type WorkerLogContext = {
  requestId?: string;
  invoice?: string;
  appId?: string;
  [key: string]: unknown;
};

export type WorkerStructuredLog = WorkerLogContext & {
  component: string;
  event: string;
  severity: WorkerLogSeverity;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function toJsonSafe(value: unknown): unknown {
  try {
    return JSON.parse(
      JSON.stringify(value, (_key, current) => {
        if (typeof current === "bigint") {
          return current.toString();
        }
        if (current instanceof Error) {
          return {
            name: current.name,
            message: current.message,
            stack: current.stack,
          };
        }
        return current;
      }),
    );
  } catch {
    return String(value);
  }
}

function buildPayload(
  component: string,
  event: string,
  severity: WorkerLogSeverity,
  context?: WorkerLogContext,
): WorkerStructuredLog {
  const safeContext = toJsonSafe(context ?? {});
  const payloadBase = {
    component,
    event,
    severity,
  };
  if (!isRecord(safeContext)) {
    return {
      ...payloadBase,
      details: safeContext,
    };
  }
  return {
    ...payloadBase,
    ...safeContext,
  };
}

export function createComponentLogger(component: string): {
  info: (event: string, context?: WorkerLogContext) => void;
  warn: (event: string, context?: WorkerLogContext) => void;
  error: (event: string, context?: WorkerLogContext) => void;
} {
  return {
    info(event, context) {
      console.log(buildPayload(component, event, "info", context));
    },
    warn(event, context) {
      console.warn(buildPayload(component, event, "warn", context));
    },
    error(event, context) {
      console.error(buildPayload(component, event, "error", context));
    },
  };
}
