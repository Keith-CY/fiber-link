import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { buildAdminConsoleServer } from "../server/admin-console-server";
import { createFixtureAdminConsoleDependencies, type AdminConsoleFixture } from "../server/admin-console-fixture-store";

type Options = {
  fixturePath?: string;
  host: string;
  port: number;
  role?: "SUPER_ADMIN" | "COMMUNITY_ADMIN";
  adminUserId?: string;
};

function parseArgs(argv: string[]): Options {
  const options: Options = {
    host: "127.0.0.1",
    port: 4318,
    role: "SUPER_ADMIN",
    adminUserId: "admin-ui-e2e",
  };

  for (const arg of argv) {
    if (arg.startsWith("--fixture=")) {
      options.fixturePath = arg.slice("--fixture=".length);
      continue;
    }
    if (arg.startsWith("--host=")) {
      options.host = arg.slice("--host=".length);
      continue;
    }
    if (arg.startsWith("--port=")) {
      options.port = Number(arg.slice("--port=".length));
      continue;
    }
    if (arg.startsWith("--role=")) {
      const role = arg.slice("--role=".length);
      if (role === "SUPER_ADMIN" || role === "COMMUNITY_ADMIN") {
        options.role = role;
        continue;
      }
      throw new Error(`invalid --role: ${role}`);
    }
    if (arg.startsWith("--admin-user-id=")) {
      options.adminUserId = arg.slice("--admin-user-id=".length);
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!Number.isInteger(options.port) || options.port <= 0 || options.port > 65535) {
    throw new Error(`invalid --port: ${options.port}`);
  }

  return options;
}

function loadFixture(fixturePath: string): AdminConsoleFixture {
  return JSON.parse(readFileSync(resolve(process.cwd(), fixturePath), "utf8")) as AdminConsoleFixture;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const fixtureDeps = options.fixturePath
    ? createFixtureAdminConsoleDependencies(loadFixture(options.fixturePath)).deps
    : undefined;
  const server = await buildAdminConsoleServer({
    deps: fixtureDeps,
    defaultRole: options.role,
    defaultAdminUserId: options.adminUserId,
  });

  const shutdown = async () => {
    await server.close();
    process.exit(0);
  };
  process.once("SIGINT", () => {
    void shutdown();
  });
  process.once("SIGTERM", () => {
    void shutdown();
  });

  await server.listen({
    host: options.host,
    port: options.port,
  });
  console.log(`admin-console-server listening on http://${options.host}:${options.port}`);
}

void main().catch((error) => {
  console.error("admin-console-server failed", error);
  process.exit(1);
});
