import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { TipIntentListCursor } from "@fiber-link/db";

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

export type { SettlementCursorStore };
