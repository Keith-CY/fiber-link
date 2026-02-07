import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export type DbClient = NodePgDatabase<typeof schema>;

export function createDbClient(url = process.env.DATABASE_URL): DbClient {
  if (!url) {
    throw new Error("DATABASE_URL is required");
  }

  const pool = new Pool({
    connectionString: url,
  });

  return drizzle(pool, { schema });
}
