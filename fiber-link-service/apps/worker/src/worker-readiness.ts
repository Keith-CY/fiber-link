import { createDbClient, createDbWithdrawalRepo, toErrorMessage } from "@fiber-link/db";

export type WorkerDependencyCheck = {
  status: "ok" | "error";
  message?: string;
};

export type WorkerReadinessResult = {
  status: "ready" | "not_ready";
  checks: {
    database: WorkerDependencyCheck;
    coreService: WorkerDependencyCheck;
  };
};

type WorkerReadinessDependencies = {
  listReadyForProcessing?: (now: Date) => Promise<unknown>;
  fetchImpl?: typeof fetch;
};

function getDefaultListReadyForProcessing() {
  const repo = createDbWithdrawalRepo(createDbClient());
  return (now: Date) => repo.listReadyForProcessing(now);
}

export async function checkWorkerDatabase(
  listReadyForProcessing: (now: Date) => Promise<unknown>,
): Promise<WorkerDependencyCheck> {
  try {
    await listReadyForProcessing(new Date());
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: toErrorMessage(error),
    };
  }
}

export async function checkWorkerCoreRpc(input: {
  endpoint: string;
  timeoutMs: number;
  fetchImpl?: typeof fetch;
}): Promise<WorkerDependencyCheck> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.floor(input.timeoutMs));
  const fetchImpl = input.fetchImpl ?? fetch;

  try {
    const response = await fetchImpl(input.endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"id":"worker-healthcheck","jsonrpc":"2.0","method":"ping","params":[]}',
      signal: controller.signal,
    });
    if (response.status >= 500) {
      return { status: "error", message: `HTTP ${response.status}` };
    }
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: toErrorMessage(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

export async function runWorkerReadinessChecks(
  input: {
    fiberRpcUrl: string;
    timeoutMs: number;
  },
  deps: WorkerReadinessDependencies = {},
): Promise<WorkerReadinessResult> {
  const database = await checkWorkerDatabase(deps.listReadyForProcessing ?? getDefaultListReadyForProcessing());
  const coreService = await checkWorkerCoreRpc({
    endpoint: input.fiberRpcUrl,
    timeoutMs: input.timeoutMs,
    fetchImpl: deps.fetchImpl,
  });

  const ready = database.status === "ok" && coreService.status === "ok";
  return {
    status: ready ? "ready" : "not_ready",
    checks: {
      database,
      coreService,
    },
  };
}
