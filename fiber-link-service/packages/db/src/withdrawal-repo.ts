import { randomUUID } from "crypto";
import { and, eq, lte, or, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { createDbLedgerRepo, type LedgerRepo } from "./ledger-repo";
import { withdrawals, type Asset } from "./schema";

export type WithdrawalAsset = Asset;
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

export class InsufficientFundsError extends Error {
  constructor(
    public readonly appId: string,
    public readonly userId: string,
    public readonly asset: WithdrawalAsset,
    public readonly amount: string,
  ) {
    super("insufficient funds");
    this.name = "InsufficientFundsError";
  }
}

export type PendingTotalInput = {
  appId: string;
  userId: string;
  asset: WithdrawalAsset;
};

export type BalanceCheckDeps = {
  ledgerRepo: LedgerRepo;
};

export type CompletionDeps = {
  ledgerRepo: LedgerRepo;
};

export type WithdrawalRepo = {
  create(input: CreateWithdrawalInput): Promise<WithdrawalRecord>;
  createWithBalanceCheck(input: CreateWithdrawalInput, deps: BalanceCheckDeps): Promise<WithdrawalRecord>;
  getPendingTotal(input: PendingTotalInput): Promise<string>;
  findByIdOrThrow(id: string): Promise<WithdrawalRecord>;
  listReadyForProcessing(now: Date): Promise<WithdrawalRecord[]>;
  markProcessing(id: string, now: Date): Promise<WithdrawalRecord>;
  markCompleted(id: string, params: { now: Date; txHash: string }): Promise<WithdrawalRecord>;
  markCompletedWithDebit(id: string, params: { now: Date; txHash: string }, deps: CompletionDeps): Promise<WithdrawalRecord>;
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

type ParsedDecimal = { value: bigint; scale: number };

function pow10(n: number): bigint {
  if (n <= 0) return 1n;
  return BigInt(`1${"0".repeat(n)}`);
}

function parseDecimal(value: string): ParsedDecimal {
  const raw = value.trim();
  if (!raw) {
    throw new Error("invalid amount");
  }

  let sign = 1n;
  let s = raw;
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    sign = -1n;
    s = s.slice(1);
  }

  const [intPartRaw, fracPartRaw = ""] = s.split(".");
  const intPart = intPartRaw === "" ? "0" : intPartRaw;
  const fracPart = fracPartRaw;

  if (!/^\d+$/.test(intPart) || (fracPart && !/^\d+$/.test(fracPart))) {
    throw new Error("invalid amount");
  }

  const scale = fracPart.length;
  const digitsStr = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, "");
  const digits = BigInt(digitsStr || "0");
  const normalizedSign = digits === 0n ? 1n : sign;
  return { value: normalizedSign * digits, scale };
}

function formatDecimal(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();

  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const digits = abs.toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, -scale).replace(/^0+(?=\d)/, "");
  let fracPart = digits.slice(-scale);
  fracPart = fracPart.replace(/0+$/, "");

  if (!fracPart) {
    return `${sign}${intPart || "0"}`;
  }
  return `${sign}${intPart || "0"}.${fracPart}`;
}

function sumAmounts(amounts: string[]): string {
  if (amounts.length === 0) return "0";
  const parsed = amounts.map(parseDecimal);
  const maxScale = parsed.reduce((m, p) => Math.max(m, p.scale), 0);
  const total = parsed.reduce((acc, p) => acc + p.value * pow10(maxScale - p.scale), 0n);
  return formatDecimal(total, maxScale);
}

function isInsufficient(balance: string, pending: string, amount: string): boolean {
  const parsedBalance = parseDecimal(balance);
  const parsedPending = parseDecimal(pending);
  const parsedAmount = parseDecimal(amount);
  const scale = Math.max(parsedBalance.scale, parsedPending.scale, parsedAmount.scale);
  const available =
    parsedBalance.value * pow10(scale - parsedBalance.scale) -
    parsedPending.value * pow10(scale - parsedPending.scale);
  const required = parsedAmount.value * pow10(scale - parsedAmount.scale);
  return available < required;
}

async function getPendingTotalWithClient(client: DbClient, input: PendingTotalInput): Promise<string> {
  const [row] = await client
    .select({
      total: sql<string>`COALESCE(SUM(${withdrawals.amount}), 0)`,
    })
    .from(withdrawals)
    .where(
      and(
        eq(withdrawals.appId, input.appId),
        eq(withdrawals.userId, input.userId),
        eq(withdrawals.asset, input.asset),
        or(
          eq(withdrawals.state, "PENDING"),
          eq(withdrawals.state, "PROCESSING"),
          eq(withdrawals.state, "RETRY_PENDING"),
        ),
      ),
    );

  return row ? String(row.total) : "0";
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

    async createWithBalanceCheck(input, _deps) {
      return db.transaction(async (tx) => {
        const lockKey = `${input.appId}:${input.userId}:${input.asset}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);

        const ledgerRepo = createDbLedgerRepo(tx);
        const balance = await ledgerRepo.getBalance({
          appId: input.appId,
          userId: input.userId,
          asset: input.asset,
        });
        const pending = await getPendingTotalWithClient(tx, {
          appId: input.appId,
          userId: input.userId,
          asset: input.asset,
        });
        if (isInsufficient(balance, pending, input.amount)) {
          throw new InsufficientFundsError(input.appId, input.userId, input.asset, input.amount);
        }

        const now = new Date();
        const [row] = await tx
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
      });
    },

    async getPendingTotal(input) {
      return getPendingTotalWithClient(db, input);
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

    async markCompletedWithDebit(id, params, _deps) {
      return db.transaction(async (tx) => {
        const [row] = await tx
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
          await throwInvalidTransition(tx, id, "COMPLETED");
        }

        const ledgerRepo = createDbLedgerRepo(tx);
        await ledgerRepo.debitOnce({
          appId: row.appId,
          userId: row.userId,
          asset: row.asset as WithdrawalAsset,
          amount: typeof row.amount === "string" ? row.amount : String(row.amount),
          refId: row.id,
          idempotencyKey: `withdrawal:debit:${row.id}`,
        });

        return toRecord(row);
      });
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
  const pendingStates = new Set<WithdrawalState>(["PENDING", "PROCESSING", "RETRY_PENDING"]);

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

    async createWithBalanceCheck(input, deps) {
      const pending = await this.getPendingTotal({
        appId: input.appId,
        userId: input.userId,
        asset: input.asset,
      });
      const balance = await deps.ledgerRepo.getBalance({
        appId: input.appId,
        userId: input.userId,
        asset: input.asset,
      });
      if (isInsufficient(balance, pending, input.amount)) {
        throw new InsufficientFundsError(input.appId, input.userId, input.asset, input.amount);
      }
      return this.create(input);
    },

    async getPendingTotal(input) {
      const pending = records.filter(
        (item) =>
          item.appId === input.appId &&
          item.userId === input.userId &&
          item.asset === input.asset &&
          pendingStates.has(item.state),
      );
      return sumAmounts(pending.map((item) => item.amount));
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

    async markCompletedWithDebit(id, params, deps) {
      const record = await this.markCompleted(id, params);
      await deps.ledgerRepo.debitOnce({
        appId: record.appId,
        userId: record.userId,
        asset: record.asset,
        amount: record.amount,
        refId: record.id,
        idempotencyKey: `withdrawal:debit:${record.id}`,
      });
      return record;
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
