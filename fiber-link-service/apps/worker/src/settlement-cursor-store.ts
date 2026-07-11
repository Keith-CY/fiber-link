import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TipIntentListCursor, WorkerStateRepo } from "@fiber-link/db";

type SettlementCursorStore = {
  load: () => Promise<TipIntentListCursor | undefined>;
  save: (cursor: TipIntentListCursor | undefined) => Promise<void>;
};

function parseCursor(raw: string, filePath: string): TipIntentListCursor {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid settlement cursor file: ${filePath}`);
  }

  if (!parsed || typeof parsed !== "object") {
    throw new Error(`Invalid settlement cursor file: ${filePath}`);
  }

  const id = (parsed as { id?: unknown }).id;
  const createdAtRaw = (parsed as { createdAt?: unknown }).createdAt;
  if (typeof id !== "string" || !id.trim() || typeof createdAtRaw !== "string") {
    throw new Error(`Invalid settlement cursor file: ${filePath}`);
  }

  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) {
    throw new Error(`Invalid settlement cursor file: ${filePath}`);
  }

  return {
    id,
    createdAt,
  };
}

export function createFileSettlementCursorStore(filePath: string): SettlementCursorStore {
  const normalizedPath = filePath.trim();
  if (!normalizedPath) {
    throw new Error("WORKER_SETTLEMENT_CURSOR_FILE must not be empty");
  }

  return {
    async load() {
      try {
        const raw = await readFile(normalizedPath, "utf8");
        return parseCursor(raw, normalizedPath);
      } catch (error) {
        if ((error as NodeJS.ErrnoException)?.code === "ENOENT") {
          return undefined;
        }
        if ((error as Error)?.message?.startsWith("Invalid settlement cursor file:")) {
          const backupPath = `${normalizedPath}.invalid-${Date.now()}`;
          await rename(normalizedPath, backupPath).catch((renameError) => {
            if ((renameError as NodeJS.ErrnoException)?.code !== "ENOENT") {
              throw renameError;
            }
          });
          return undefined;
        }
        throw error;
      }
    },

    async save(cursor) {
      if (!cursor) {
        try {
          await unlink(normalizedPath);
        } catch (error) {
          if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
            throw error;
          }
        }
        return;
      }

      const payload = JSON.stringify(
        {
          id: cursor.id,
          createdAt: cursor.createdAt.toISOString(),
          updatedAt: new Date().toISOString(),
        },
        null,
        2,
      );
      const tmpPath = `${normalizedPath}.tmp`;
      await mkdir(dirname(normalizedPath), { recursive: true });
      await writeFile(tmpPath, `${payload}\n`, "utf8");
      await rename(tmpPath, normalizedPath);
    },
  };
}

const SETTLEMENT_CURSOR_STATE_KEY = "settlement-cursor";

function parseCursorValue(value: Record<string, unknown>): TipIntentListCursor | undefined {
  const id = value.id;
  const createdAtRaw = value.createdAt;
  if (typeof id !== "string" || !id.trim() || typeof createdAtRaw !== "string") {
    return undefined;
  }
  const createdAt = new Date(createdAtRaw);
  if (Number.isNaN(createdAt.getTime())) {
    return undefined;
  }
  return { id, createdAt };
}

export type CreateDbSettlementCursorStoreOptions = {
  /**
   * One-time adoption source: when the database holds no cursor yet, the
   * legacy file store is consulted so an upgraded deployment resumes where
   * the file-based cursor left off instead of rescanning from the start.
   */
  legacyFileStore?: SettlementCursorStore;
};

export function createDbSettlementCursorStore(
  repo: WorkerStateRepo,
  options: CreateDbSettlementCursorStoreOptions = {},
): SettlementCursorStore {
  return {
    async load() {
      const stored = await repo.get(SETTLEMENT_CURSOR_STATE_KEY);
      if (stored) {
        // An unparsable value is treated like the file store treats a corrupt
        // file: start over rather than crash the worker; discovery crediting
        // is idempotent, so a rescan is safe.
        return parseCursorValue(stored);
      }

      if (options.legacyFileStore) {
        const adopted = await options.legacyFileStore.load().catch(() => undefined);
        if (adopted) {
          await this.save(adopted);
          return adopted;
        }
      }

      return undefined;
    },

    async save(cursor) {
      if (!cursor) {
        await repo.delete(SETTLEMENT_CURSOR_STATE_KEY);
        return;
      }
      await repo.set(SETTLEMENT_CURSOR_STATE_KEY, {
        id: cursor.id,
        createdAt: cursor.createdAt.toISOString(),
        updatedAt: new Date().toISOString(),
      });
    },
  };
}

export type { SettlementCursorStore };
