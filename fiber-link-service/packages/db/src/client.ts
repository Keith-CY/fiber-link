import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
// @ts-expect-error This workspace does not install pg type declarations.
import { Pool } from "pg";
import * as schema from "./schema";

export type DbClient = NodePgDatabase<typeof schema>;

export type DbClientOptions = {
  url?: string;
  /** Maximum number of clients in the pool. Defaults to 10. */
  maxConnections?: number;
  /** Milliseconds a client must sit idle before being closed. Defaults to 30 000. */
  idleTimeoutMs?: number;
  /** Milliseconds to wait for a connection before throwing. 0 = no timeout (pg default). Defaults to 0. */
  connectionTimeoutMs?: number;
  /** PostgreSQL statement_timeout in milliseconds. 0 = unlimited (pg default). Defaults to 0. */
  statementTimeoutMs?: number;
};

function parsePoolEnv(): Pick<
  DbClientOptions,
  "maxConnections" | "idleTimeoutMs" | "connectionTimeoutMs" | "statementTimeoutMs"
> {
  const parseMs = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return raw && Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
  };
  const parseInt_ = (raw: string | undefined, fallback: number) => {
    const n = Number(raw);
    return raw && Number.isInteger(n) && n > 0 ? n : fallback;
  };
  return {
    maxConnections: parseInt_(process.env.DB_POOL_MAX, 10),
    idleTimeoutMs: parseMs(process.env.DB_POOL_IDLE_TIMEOUT_MS, 30_000),
    connectionTimeoutMs: parseMs(process.env.DB_POOL_CONNECTION_TIMEOUT_MS, 0),
    statementTimeoutMs: parseMs(process.env.DB_STATEMENT_TIMEOUT_MS, 0),
  };
}

export function createDbClient(urlOrOptions: string | DbClientOptions = process.env.DATABASE_URL ?? ""): DbClient {
  const url = typeof urlOrOptions === "string" ? urlOrOptions : (urlOrOptions.url ?? process.env.DATABASE_URL ?? "");
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const envDefaults = parsePoolEnv();
  const opts = typeof urlOrOptions === "object" ? urlOrOptions : {};

  const maxConnections = opts.maxConnections ?? envDefaults.maxConnections ?? 10;
  const idleTimeoutMs = opts.idleTimeoutMs ?? envDefaults.idleTimeoutMs ?? 30_000;
  const connectionTimeoutMs = opts.connectionTimeoutMs ?? envDefaults.connectionTimeoutMs ?? 0;
  const statementTimeoutMs = opts.statementTimeoutMs ?? envDefaults.statementTimeoutMs ?? 0;

  const pool = new Pool({
    connectionString: url,
    max: maxConnections,
    idleTimeoutMillis: idleTimeoutMs,
    connectionTimeoutMillis: connectionTimeoutMs,
    ...(statementTimeoutMs > 0 && {
      options: `-c statement_timeout=${statementTimeoutMs}`,
    }),
  });

  return drizzle(pool, { schema });
}
