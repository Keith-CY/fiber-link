import { createDbClient, createDbWithdrawalRepo } from "@fiber-link/db";

const timeoutRaw = process.env.WORKER_READINESS_TIMEOUT_MS ?? "5000";
const timeoutMs = Number(timeoutRaw);
if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
  console.error(`[worker-healthcheck] invalid WORKER_READINESS_TIMEOUT_MS: ${timeoutRaw}`);
  process.exit(1);
}

const fiberRpcUrl = process.env.FIBER_RPC_URL;
if (!fiberRpcUrl) {
  console.error("[worker-healthcheck] FIBER_RPC_URL is required");
  process.exit(1);
}

type CheckResult = {
  status: "ok" | "error";
  message?: string;
};

async function checkDatabase(): Promise<CheckResult> {
  try {
    const repo = createDbWithdrawalRepo(createDbClient());
    await repo.listReadyForProcessing(new Date());
    return { status: "ok" };
  } catch (error) {
    return {
      status: "error",
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

async function checkCoreRpc(endpoint: string): Promise<CheckResult> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.floor(timeoutMs));
  try {
    const response = await fetch(endpoint, {
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
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function main() {
  const checks = {
    database: await checkDatabase(),
    coreService: await checkCoreRpc(fiberRpcUrl),
  };
  const ready = Object.values(checks).every((item) => item.status === "ok");
  const payload = {
    status: ready ? "ready" : "not_ready",
    checks,
  };

  console.log(JSON.stringify(payload));
  if (!ready) {
    process.exit(1);
  }
}

void main().catch((error) => {
  console.error("[worker-healthcheck] readiness probe failed unexpectedly", error);
  process.exit(1);
});
