import { type NodePgDatabase, drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DbClient = NodePgDatabase<typeof schema>;

export type DbClientOptions = {
  url?: string;
  /** Maximum number of clients in the pool. When unset, pg.Pool default (10) is used. */
  maxConnections?: number;
  /** Milliseconds a client must sit idle before being closed. When unset, pg.Pool default (10 000) is used. */
  idleTimeoutMs?: number;
  /** Milliseconds to wait for a connection before throwing. 0 = no timeout. When unset, pg.Pool default (no timeout) is used. */
  connectionTimeoutMs?: number;
  /** PostgreSQL statement_timeout in milliseconds. 0 or unset = unlimited (no server-side timeout). */
  statementTimeoutMs?: number;
};

function parsePoolEnv(): DbClientOptions {
  const parseMs = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isFinite(n) && n >= 0 ? Math.floor(n) : undefined;
  };
  const parseInt_ = (raw: string | undefined): number | undefined => {
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n > 0 ? n : undefined;
  };
  return {
    maxConnections: parseInt_(process.env.DB_POOL_MAX),
    idleTimeoutMs: parseMs(process.env.DB_POOL_IDLE_TIMEOUT_MS),
    connectionTimeoutMs: parseMs(process.env.DB_POOL_CONNECTION_TIMEOUT_MS),
    statementTimeoutMs: parseMs(process.env.DB_STATEMENT_TIMEOUT_MS),
  };
}

export function createDbClient(urlOrOptions: string | DbClientOptions = process.env.DATABASE_URL ?? ""): DbClient {
  const url = typeof urlOrOptions === "string" ? urlOrOptions : (urlOrOptions.url ?? process.env.DATABASE_URL ?? "");
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const envDefaults = parsePoolEnv();
  const opts = typeof urlOrOptions === "object" ? urlOrOptions : {};

  const maxConnections = opts.maxConnections ?? envDefaults.maxConnections;
  const idleTimeoutMs = opts.idleTimeoutMs ?? envDefaults.idleTimeoutMs;
  const connectionTimeoutMs = opts.connectionTimeoutMs ?? envDefaults.connectionTimeoutMs;
  const statementTimeoutMs = opts.statementTimeoutMs ?? envDefaults.statementTimeoutMs;

  const pool = new Pool({
    connectionString: url,
    ...(maxConnections !== undefined && { max: maxConnections }),
    ...(idleTimeoutMs !== undefined && { idleTimeoutMillis: idleTimeoutMs }),
    ...(connectionTimeoutMs !== undefined && { connectionTimeoutMillis: connectionTimeoutMs }),
    ...(statementTimeoutMs !== undefined &&
      statementTimeoutMs > 0 && {
        options: `-c statement_timeout=${statementTimeoutMs}`,
      }),
  });

  return drizzle(pool, { schema });
}
