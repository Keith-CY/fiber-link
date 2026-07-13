import { validateRpcEnv } from "./env";
import { buildServer } from "./server";

const host = process.env.RPC_HOST ?? "0.0.0.0";
const port = Number(process.env.RPC_PORT ?? "3000");

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid RPC_PORT: ${process.env.RPC_PORT ?? ""}`);
}

function getShutdownTimeoutMs(): number {
  const parsed = Number(process.env.RPC_SHUTDOWN_TIMEOUT_MS ?? "10000");
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 10_000;
}

async function main() {
  const envReport = validateRpcEnv();
  const app = buildServer();

  for (const warning of envReport.warnings) {
    app.log.warn({ scope: "env" }, warning);
  }
  if (envReport.errors.length > 0) {
    for (const error of envReport.errors) {
      app.log.error({ scope: "env" }, error);
    }
    throw new Error(`Invalid environment: ${envReport.errors.join("; ")}`);
  }

  const shutdown = async (signal: NodeJS.Signals) => {
    app.log.info({ signal }, "shutting down");
    // If close() hangs (a stuck connection or onClose hook), force the exit
    // after a bounded drain window instead of wedging the container.
    const forceExit = setTimeout(() => {
      app.log.error("graceful shutdown timed out; forcing exit");
      process.exit(1);
    }, getShutdownTimeoutMs());
    forceExit.unref();

    try {
      await app.close();
      process.exit(0);
    } catch (error) {
      app.log.error(error, "error during shutdown");
      process.exit(1);
    }
  };

  process.once("SIGINT", () => {
    void shutdown("SIGINT");
  });
  process.once("SIGTERM", () => {
    void shutdown("SIGTERM");
  });

  await app.listen({ host, port });
  app.log.info({ host, port }, "RPC server started");
}

void main().catch((error) => {
  console.error("RPC server failed to start", error);
  process.exit(1);
});
