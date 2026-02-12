import { randomUUID } from "crypto";
import { and, eq, lte, or, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { withdrawals } from "./schema";

export type WithdrawalAsset = "CKB" | "USDI";
export type WithdrawalState = "PENDING" | "PROCESSING" | "RETRY_PENDING" | "COMPLETED" | "FAILED";

export type CreateWithdrawalInput = {
  appId: string;
  userId: string;
  asset: WithdrawalAsset;
  amount: string;
  toAddress: string;
};

export type WithdrawalRecord = CreateWithdrawalInput & {
  id: string;
  state: WithdrawalState;
  retryCount: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  txHash: string | null;
};

export class WithdrawalNotFoundError extends Error {
  constructor(public readonly withdrawalId: string) {
    super("withdrawal not found");
    this.name = "WithdrawalNotFoundError";
  }
}

export class WithdrawalTransitionConflictError extends Error {
  constructor(
    public readonly targetState: WithdrawalState,
    public readonly currentState: string,
    public readonly withdrawalId: string,
  ) {
    super(`invalid transition to ${targetState} from ${currentState}`);
    this.name = "WithdrawalTransitionConflictError";
  }
}

export type WithdrawalRepo = {
  create(input: CreateWithdrawalInput): Promise<WithdrawalRecord>;
  findByIdOrThrow(id: string): Promise<WithdrawalRecord>;
  listReadyForProcessing(now: Date): Promise<WithdrawalRecord[]>;
  markProcessing(id: string, now: Date): Promise<WithdrawalRecord>;
  markCompleted(id: string, params: { now: Date; txHash: string }): Promise<WithdrawalRecord>;
  markRetryPending(id: string, params: { now: Date; nextRetryAt: Date; error: string }): Promise<WithdrawalRecord>;
  markFailed(id: string, params: { now: Date; error: string; incrementRetryCount?: boolean }): Promise<WithdrawalRecord>;
  __resetForTests?: () => void;
};

type WithdrawalRow = typeof withdrawals.$inferSelect;

function toRecord(row: WithdrawalRow): WithdrawalRecord {
  return {
    id: row.id,
    appId: row.appId,
    userId: row.userId,
    asset: row.asset as WithdrawalAsset,
    amount: typeof row.amount === "string" ? row.amount : String(row.amount),
    toAddress: row.toAddress,
    state: row.state as WithdrawalState,
    retryCount: row.retryCount,
    nextRetryAt: row.nextRetryAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    txHash: row.txHash,
  };
}

async function throwInvalidTransition(db: DbClient, id: string, targetState: string): Promise<never> {
  const [existing] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
  if (!existing) {
    throw new WithdrawalNotFoundError(id);
  }
  throw new WithdrawalTransitionConflictError(targetState as WithdrawalState, String(existing.state), id);
}

export function createDbWithdrawalRepo(db: DbClient): WithdrawalRepo {
  return {
    async create(input) {
      const now = new Date();
      const [row] = await db
        .insert(withdrawals)
        .values({
          appId: input.appId,
          userId: input.userId,
          asset: input.asset,
          amount: input.amount,
          toAddress: input.toAddress,
          state: "PENDING",
          retryCount: 0,
          nextRetryAt: null,
          lastError: null,
          createdAt: now,
          updatedAt: now,
          completedAt: null,
          txHash: null,
        })
        .returning();
      return toRecord(row);
    },

    async findByIdOrThrow(id) {
      const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
      if (!row) {
        throw new WithdrawalNotFoundError(id);
      }
      return toRecord(row);
    },

    async listReadyForProcessing(now) {
      const rows = await db
        .select()
        .from(withdrawals)
        .where(
          or(
            eq(withdrawals.state, "PENDING"),
            and(eq(withdrawals.state, "RETRY_PENDING"), lte(withdrawals.nextRetryAt, now)),
          ),
        );
      return rows.map(toRecord);
    },

    async markProcessing(id, now) {
      const [row] = await db
        .update(withdrawals)
        .set({ state: "PROCESSING", updatedAt: now })
        .where(
          and(
            eq(withdrawals.id, id),
            or(eq(withdrawals.state, "PENDING"), eq(withdrawals.state, "RETRY_PENDING")),
          ),
        )
        .returning();
      if (!row) {
        await throwInvalidTransition(db, id, "PROCESSING");
      }
      return toRecord(row);
    },

    async markCompleted(id, params) {
      const [row] = await db
        .update(withdrawals)
        .set({
          state: "COMPLETED",
          nextRetryAt: null,
          lastError: null,
          updatedAt: params.now,
          completedAt: params.now,
          txHash: params.txHash,
        })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "PROCESSING")))
        .returning();
      if (!row) {
        await throwInvalidTransition(db, id, "COMPLETED");
      }
      return toRecord(row);
    },

    async markRetryPending(id, params) {
      const [row] = await db
        .update(withdrawals)
        .set({
          state: "RETRY_PENDING",
          retryCount: sql`${withdrawals.retryCount} + 1`,
          nextRetryAt: params.nextRetryAt,
          lastError: params.error,
          updatedAt: params.now,
        })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "PROCESSING")))
        .returning();
      if (!row) {
        await throwInvalidTransition(db, id, "RETRY_PENDING");
      }
      return toRecord(row);
    },

    async markFailed(id, params) {
      const nextRetryCount = params.incrementRetryCount
        ? sql`${withdrawals.retryCount} + 1`
        : withdrawals.retryCount;
      const [row] = await db
        .update(withdrawals)
        .set({
          state: "FAILED",
          retryCount: nextRetryCount,
          nextRetryAt: null,
          lastError: params.error,
          updatedAt: params.now,
        })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "PROCESSING")))
        .returning();
      if (!row) {
        await throwInvalidTransition(db, id, "FAILED");
      }
      return toRecord(row);
    },
  };
}

export function createInMemoryWithdrawalRepo(): WithdrawalRepo {
  const records: WithdrawalRecord[] = [];

  function clone(record: WithdrawalRecord): WithdrawalRecord {
    return {
      ...record,
      nextRetryAt: record.nextRetryAt ? new Date(record.nextRetryAt) : null,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
    };
  }

  return {
    async create(input) {
      const now = new Date();
      const record: WithdrawalRecord = {
        ...input,
        id: randomUUID(),
        state: "PENDING",
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        txHash: null,
      };
      records.push(record);
      return clone(record);
    },

    async findByIdOrThrow(id) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      return clone(record);
    },

    async listReadyForProcessing(now) {
      return records
        .filter(
          (item) =>
            item.state === "PENDING" ||
            (item.state === "RETRY_PENDING" && item.nextRetryAt !== null && item.nextRetryAt <= now),
        )
        .map(clone);
    },

    async markProcessing(id, now) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "PENDING" && record.state !== "RETRY_PENDING") {
        throw new WithdrawalTransitionConflictError("PROCESSING", record.state, id);
      }
      record.state = "PROCESSING";
      record.updatedAt = now;
      return clone(record);
    },

    async markCompleted(id, params) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "PROCESSING") {
        throw new WithdrawalTransitionConflictError("COMPLETED", record.state, id);
      }
      record.state = "COMPLETED";
      record.nextRetryAt = null;
      record.lastError = null;
      record.updatedAt = params.now;
      record.completedAt = params.now;
      record.txHash = params.txHash;
      return clone(record);
    },

    async markRetryPending(id, params) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "PROCESSING") {
        throw new WithdrawalTransitionConflictError("RETRY_PENDING", record.state, id);
      }
      record.state = "RETRY_PENDING";
      record.retryCount += 1;
      record.nextRetryAt = params.nextRetryAt;
      record.lastError = params.error;
      record.updatedAt = params.now;
      return clone(record);
    },

    async markFailed(id, params) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "PROCESSING") {
        throw new WithdrawalTransitionConflictError("FAILED", record.state, id);
      }
      if (params.incrementRetryCount) {
        record.retryCount += 1;
      }
      record.state = "FAILED";
      record.nextRetryAt = null;
      record.lastError = params.error;
      record.updatedAt = params.now;
      return clone(record);
    },

    __resetForTests() {
      records.length = 0;
    },
  };
}
