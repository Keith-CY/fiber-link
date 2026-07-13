import { eq } from "drizzle-orm";
import type { DbClient } from "./client";
import { workerState } from "./schema";

/**
 * Small keyed JSON store for worker runtime state (e.g. the settlement
 * discovery cursor), so state survives container replacement without a
 * host volume.
 */
export type WorkerStateRepo = {
  get(key: string): Promise<Record<string, unknown> | undefined>;
  set(key: string, value: Record<string, unknown>): Promise<void>;
  delete(key: string): Promise<void>;
};

export function createDbWorkerStateRepo(db: DbClient): WorkerStateRepo {
  return {
    async get(key) {
      const rows = await db.select().from(workerState).where(eq(workerState.key, key)).limit(1);
      return rows[0]?.value ?? undefined;
    },

    async set(key, value) {
      await db
        .insert(workerState)
        .values({ key, value, updatedAt: new Date() })
        .onConflictDoUpdate({
          target: workerState.key,
          set: { value, updatedAt: new Date() },
        });
    },

    async delete(key) {
      await db.delete(workerState).where(eq(workerState.key, key));
    },
  };
}

export function createInMemoryWorkerStateRepo(seed: Record<string, Record<string, unknown>> = {}): WorkerStateRepo {
  const store = new Map<string, Record<string, unknown>>(Object.entries(seed));
  return {
    async get(key) {
      return store.get(key);
    },
    async set(key, value) {
      store.set(key, value);
    },
    async delete(key) {
      store.delete(key);
    },
  };
}
