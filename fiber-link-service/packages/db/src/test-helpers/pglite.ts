import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { DbClient } from "../client";
import * as schema from "../schema";

export type PgliteTestDb = {
  db: DbClient;
  raw: PGlite;
  close: () => Promise<void>;
};

/**
 * In-process Postgres (WASM) for DB-level tests: boots a fresh PGlite
 * instance and applies every committed drizzle migration, so tests exercise
 * the real SQL the service runs — aggregation, grouping, date bucketing —
 * without needing a Postgres server. This doubles as a migration smoke test:
 * a migration that fails to apply breaks every suite using this helper.
 */
export async function createPgliteTestDb(): Promise<PgliteTestDb> {
  const pg = new PGlite();
  const migrationsDir = resolve(__dirname, "..", "..", "drizzle");
  const files = readdirSync(migrationsDir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    for (const statement of sql.split("--> statement-breakpoint")) {
      const trimmed = statement.trim();
      if (trimmed.length > 0) {
        await pg.exec(trimmed);
      }
    }
  }

  // PGlite's drizzle instance is structurally compatible with the pg Pool
  // one for query building/execution, which is all the repos need.
  const db = drizzle(pg, { schema }) as unknown as DbClient;
  return {
    db,
    raw: pg,
    close: async () => {
      await pg.close?.();
    },
  };
}
