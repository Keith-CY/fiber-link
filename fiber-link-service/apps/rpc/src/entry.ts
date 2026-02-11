import { buildServer } from "./server";

const host = process.env.RPC_HOST ?? "0.0.0.0";
const port = Number(process.env.RPC_PORT ?? "3000");

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid RPC_PORT: ${process.env.RPC_PORT ?? ""}`);
}

async function main() {
  const app = buildServer();

  const shutdown = async () => {
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };

  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await app.listen({ host, port });
  app.log.info({ host, port }, "RPC server started");
}

void main().catch((error) => {
  console.error("RPC server failed to start", error);
  process.exit(1);
});
