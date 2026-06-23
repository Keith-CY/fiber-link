import { randomUUID } from "crypto";
import { and, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { assertPositiveAmount, formatDecimal, parseDecimal, pow10 } from "./amount";
import { withdrawalDebitIdempotencyKey } from "./idempotency";
import { createDbLedgerRepo, type LedgerRepo } from "./ledger-repo";
import { computeRetryDelay } from "./retry";
import { withdrawals, type Asset, type WithdrawalDestinationKind, type WithdrawalState } from "./schema";

export type WithdrawalAsset = Asset;

export type CreateWithdrawalInput = {
  appId: string;
  userId: string;
  asset: WithdrawalAsset;
  amount: string;
  toAddress: string;
  destinationKind?: WithdrawalDestinationKind;
  clientRequestId?: string;
};

export type CreateLiquidityPendingWithdrawalInput = CreateWithdrawalInput & {
  liquidityRequestId: string;
  liquidityPendingReason: string;
};

export type WithdrawalRecord = Omit<CreateWithdrawalInput, "clientRequestId"> & {
  id: string;
  destinationKind: WithdrawalDestinationKind;
  state: WithdrawalState;
  retryCount: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  txHash: string | null;
  clientRequestId: string | null;
  liquidityRequestId: string | null;
  liquidityPendingReason: string | null;
  liquidityCheckedAt: Date | null;
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

/**
 * Raised when an operator tries to revive a FAILED withdrawal that still
 * carries a broadcast `tx_hash`. Such a row was already broadcast on-chain (the
 * ledger debit happens at broadcast), so re-queueing it would broadcast a
 * second on-chain payout while the row stays debited once. This guard keeps the
 * "debit at broadcast" invariant from turning into a double-payment.
 */
export class WithdrawalRevivalBlockedError extends Error {
  constructor(
    public readonly withdrawalId: string,
    public readonly txHash: string,
  ) {
    super("cannot revive a withdrawal that already has a broadcast tx_hash");
    this.name = "WithdrawalRevivalBlockedError";
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

export type ActiveCkbAddressReservationTotalInput = {
  appId: string;
  asset: WithdrawalAsset;
  network: "AGGRON4" | "LINA";
};

export type FindByClientRequestIdInput = {
  appId: string;
  userId: string;
  clientRequestId: string;
};

export type CompletionDeps = {
  ledgerRepo: LedgerRepo;
};

export type ReapStaleProcessingInput = {
  now: Date;
  staleBefore: Date;
  baseRetryDelayMs: number;
  error: string;
};

export type WithdrawalRepo = {
  create(input: CreateWithdrawalInput): Promise<WithdrawalRecord>;
  createLiquidityPending(input: CreateLiquidityPendingWithdrawalInput): Promise<WithdrawalRecord>;
  createLiquidityPendingWithBalanceCheck(
    input: CreateLiquidityPendingWithdrawalInput,
    deps: BalanceCheckDeps,
  ): Promise<WithdrawalRecord>;
  createWithBalanceCheck(input: CreateWithdrawalInput, deps: BalanceCheckDeps): Promise<WithdrawalRecord>;
  getPendingTotal(input: PendingTotalInput): Promise<string>;
  getActiveCkbAddressReservationTotal(input: ActiveCkbAddressReservationTotalInput): Promise<string>;
  findByClientRequestId(input: FindByClientRequestIdInput): Promise<WithdrawalRecord | null>;
  findByIdOrThrow(id: string): Promise<WithdrawalRecord>;
  listLiquidityPending(): Promise<WithdrawalRecord[]>;
  listReadyForProcessing(now: Date): Promise<WithdrawalRecord[]>;
  listBroadcastedForConfirmation(): Promise<WithdrawalRecord[]>;
  reapStaleProcessing(input: ReapStaleProcessingInput): Promise<WithdrawalRecord[]>;
  markPendingFromLiquidity(id: string, now: Date): Promise<WithdrawalRecord>;
  markProcessing(id: string, now: Date): Promise<WithdrawalRecord>;
  markBroadcastedWithDebit(id: string, params: { now: Date; txHash: string }, deps: CompletionDeps): Promise<WithdrawalRecord>;
  markCompleted(id: string, params: { now: Date; txHash?: string }): Promise<WithdrawalRecord>;
  markCompletedWithDebit(id: string, params: { now: Date; txHash: string }, deps: CompletionDeps): Promise<WithdrawalRecord>;
  markRetryPending(id: string, params: { now: Date; nextRetryAt: Date; error: string }): Promise<WithdrawalRecord>;
  markFailedFromBroadcasted(id: string, params: { now: Date; error: string }): Promise<WithdrawalRecord>;
  markFailed(id: string, params: { now: Date; error: string; incrementRetryCount?: boolean }): Promise<WithdrawalRecord>;
  /**
   * Operator interventions. These are guarded state transitions (never raw
   * SQL) so the admin console inherits the same invariants and tests as the
   * worker-driven transitions.
   */
  adminRetryNow(id: string, params: { now: Date }): Promise<WithdrawalRecord>;
  adminReviveFromFailed(id: string, params: { now: Date }): Promise<WithdrawalRecord>;
  adminTerminalize(id: string, params: { now: Date; reason: string }): Promise<WithdrawalRecord>;
  __resetForTests?: () => void;
};

type WithdrawalRow = typeof withdrawals.$inferSelect;
const reservedWithdrawalStates: WithdrawalState[] = ["LIQUIDITY_PENDING", "PENDING", "PROCESSING", "BROADCASTED", "RETRY_PENDING"];

function toRecord(row: WithdrawalRow): WithdrawalRecord {
  return {
    id: row.id,
    appId: row.appId,
    userId: row.userId,
    asset: row.asset as WithdrawalAsset,
    amount: typeof row.amount === "string" ? row.amount : String(row.amount),
    destinationKind: row.destinationKind as WithdrawalDestinationKind,
    toAddress: row.toAddress,
    state: row.state as WithdrawalState,
    retryCount: row.retryCount,
    nextRetryAt: row.nextRetryAt,
    lastError: row.lastError,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
    completedAt: row.completedAt,
    txHash: row.txHash,
    clientRequestId: row.clientRequestId,
    liquidityRequestId: row.liquidityRequestId,
    liquidityPendingReason: row.liquidityPendingReason,
    liquidityCheckedAt: row.liquidityCheckedAt,
  };
}

function inferDestinationKind(toAddress: string): WithdrawalDestinationKind {
  const normalized = toAddress.trim().toLowerCase();
  if (normalized.startsWith("ckt1") || normalized.startsWith("ckb1")) {
    return "CKB_ADDRESS";
  }
  return "PAYMENT_REQUEST";
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      (err as { code?: unknown }).code === "23505",
  );
}

async function findByClientRequestIdWithClient(
  client: DbClient,
  input: FindByClientRequestIdInput,
): Promise<WithdrawalRecord | null> {
  const [row] = await client
    .select()
    .from(withdrawals)
    .where(
      and(
        eq(withdrawals.appId, input.appId),
        eq(withdrawals.userId, input.userId),
        eq(withdrawals.clientRequestId, input.clientRequestId),
      ),
    )
    .limit(1);
  return row ? toRecord(row) : null;
}

async function acquireClientRequestLock(
  client: DbClient,
  input: { appId: string; userId: string; clientRequestId?: string },
): Promise<void> {
  if (!input.clientRequestId) return;

  const clientRequestLockKey = `${input.appId}:${input.userId}:client-request:${input.clientRequestId}`;
  await client.execute(sql`select pg_advisory_xact_lock(hashtext(${clientRequestLockKey}))`);
}

async function findExistingClientRequestWithdrawal(
  client: DbClient,
  input: { appId: string; userId: string; clientRequestId?: string },
): Promise<WithdrawalRecord | null> {
  if (!input.clientRequestId) return null;

  return findByClientRequestIdWithClient(client, {
    appId: input.appId,
    userId: input.userId,
    clientRequestId: input.clientRequestId,
  });
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

function ckbAddressPrefixForNetwork(network: "AGGRON4" | "LINA"): "ckt1%" | "ckb1%" {
  return network === "AGGRON4" ? "ckt1%" : "ckb1%";
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
        inArray(withdrawals.state, reservedWithdrawalStates),
      ),
    );

  return row ? String(row.total) : "0";
}

async function getActiveCkbAddressReservationTotalWithClient(
  client: DbClient,
  input: ActiveCkbAddressReservationTotalInput,
): Promise<string> {
  const [row] = await client
    .select({
      total: sql<string>`COALESCE(SUM(${withdrawals.amount}), 0)`,
    })
    .from(withdrawals)
    .where(
      and(
        eq(withdrawals.appId, input.appId),
        eq(withdrawals.asset, input.asset),
        eq(withdrawals.destinationKind, "CKB_ADDRESS"),
        inArray(withdrawals.state, ["PENDING", "PROCESSING", "BROADCASTED", "RETRY_PENDING"]),
        sql`${withdrawals.toAddress} ILIKE ${ckbAddressPrefixForNetwork(input.network)}`,
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
      assertPositiveAmount(input.amount);
      if (input.clientRequestId) {
        const existing = await findByClientRequestIdWithClient(db, {
          appId: input.appId,
          userId: input.userId,
          clientRequestId: input.clientRequestId,
        });
        if (existing) return existing;
      }
      const now = new Date();
      try {
        const [row] = await db
          .insert(withdrawals)
          .values({
            appId: input.appId,
            userId: input.userId,
            asset: input.asset,
            amount: input.amount,
            destinationKind: input.destinationKind ?? inferDestinationKind(input.toAddress),
            toAddress: input.toAddress,
            state: "PENDING",
            retryCount: 0,
            nextRetryAt: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            txHash: null,
            clientRequestId: input.clientRequestId ?? null,
          })
          .returning();
        return toRecord(row);
      } catch (error) {
        if (!input.clientRequestId || !isUniqueViolation(error)) {
          throw error;
        }
        const existing = await findByClientRequestIdWithClient(db, {
          appId: input.appId,
          userId: input.userId,
          clientRequestId: input.clientRequestId,
        });
        if (existing) return existing;
        throw error;
      }
    },

    async createLiquidityPending(input) {
      assertPositiveAmount(input.amount);
      if (input.clientRequestId) {
        const existing = await findByClientRequestIdWithClient(db, {
          appId: input.appId,
          userId: input.userId,
          clientRequestId: input.clientRequestId,
        });
        if (existing) return existing;
      }
      const now = new Date();
      try {
        const [row] = await db
          .insert(withdrawals)
          .values({
            appId: input.appId,
            userId: input.userId,
            asset: input.asset,
            amount: input.amount,
            destinationKind: input.destinationKind ?? inferDestinationKind(input.toAddress),
            toAddress: input.toAddress,
            state: "LIQUIDITY_PENDING",
            retryCount: 0,
            nextRetryAt: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            txHash: null,
            clientRequestId: input.clientRequestId ?? null,
            liquidityRequestId: input.liquidityRequestId,
            liquidityPendingReason: input.liquidityPendingReason,
            liquidityCheckedAt: now,
          })
          .returning();
        return toRecord(row);
      } catch (error) {
        if (!input.clientRequestId || !isUniqueViolation(error)) {
          throw error;
        }
        const existing = await findByClientRequestIdWithClient(db, {
          appId: input.appId,
          userId: input.userId,
          clientRequestId: input.clientRequestId,
        });
        if (existing) return existing;
        throw error;
      }
    },

    async createLiquidityPendingWithBalanceCheck(input, _deps) {
      assertPositiveAmount(input.amount);
      return db.transaction(async (tx) => {
        const lockKey = `${input.appId}:${input.userId}:${input.asset}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
        await acquireClientRequestLock(tx, input);

        const existing = await findExistingClientRequestWithdrawal(tx, input);
        if (existing) return existing;

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
            destinationKind: input.destinationKind ?? inferDestinationKind(input.toAddress),
            toAddress: input.toAddress,
            state: "LIQUIDITY_PENDING",
            retryCount: 0,
            nextRetryAt: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            txHash: null,
            clientRequestId: input.clientRequestId ?? null,
            liquidityRequestId: input.liquidityRequestId,
            liquidityPendingReason: input.liquidityPendingReason,
            liquidityCheckedAt: now,
          })
          .returning();

        return toRecord(row);
      });
    },

    async createWithBalanceCheck(input, _deps) {
      assertPositiveAmount(input.amount);
      return db.transaction(async (tx) => {
        const lockKey = `${input.appId}:${input.userId}:${input.asset}`;
        await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${lockKey}))`);
        await acquireClientRequestLock(tx, input);

        const existing = await findExistingClientRequestWithdrawal(tx, input);
        if (existing) return existing;

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
            destinationKind: input.destinationKind ?? inferDestinationKind(input.toAddress),
            toAddress: input.toAddress,
            state: "PENDING",
            retryCount: 0,
            nextRetryAt: null,
            lastError: null,
            createdAt: now,
            updatedAt: now,
            completedAt: null,
            txHash: null,
            clientRequestId: input.clientRequestId ?? null,
          })
          .returning();

        return toRecord(row);
      });
    },

    async getPendingTotal(input) {
      return getPendingTotalWithClient(db, input);
    },

    async getActiveCkbAddressReservationTotal(input) {
      return getActiveCkbAddressReservationTotalWithClient(db, input);
    },

    async findByClientRequestId(input) {
      return findByClientRequestIdWithClient(db, input);
    },

    async findByIdOrThrow(id) {
      const [row] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
      if (!row) {
        throw new WithdrawalNotFoundError(id);
      }
      return toRecord(row);
    },

    async listLiquidityPending() {
      const rows = await db.select().from(withdrawals).where(eq(withdrawals.state, "LIQUIDITY_PENDING"));
      return rows.map(toRecord);
    },

    async listReadyForProcessing(now) {
      const [pendingRows, retryReadyRows] = await Promise.all([
        db.select().from(withdrawals).where(eq(withdrawals.state, "PENDING")),
        db
          .select()
          .from(withdrawals)
          .where(and(eq(withdrawals.state, "RETRY_PENDING"), lte(withdrawals.nextRetryAt, now))),
      ]);
      return [...pendingRows, ...retryReadyRows].map(toRecord);
    },

    async listBroadcastedForConfirmation() {
      const rows = await db
        .select()
        .from(withdrawals)
        .where(eq(withdrawals.state, "BROADCASTED"));
      return rows.map(toRecord);
    },

    async reapStaleProcessing(input) {
      const rows = await db
        .update(withdrawals)
        .set({
          state: "RETRY_PENDING",
          retryCount: sql`${withdrawals.retryCount} + 1`,
          nextRetryAt: sql`${input.now} + ((${input.baseRetryDelayMs} * pow(2, least(${withdrawals.retryCount}, 8))) || ' milliseconds')::interval`,
          lastError: input.error,
          updatedAt: input.now,
        })
        .where(and(eq(withdrawals.state, "PROCESSING"), lte(withdrawals.updatedAt, input.staleBefore)))
        .returning();
      return rows.map(toRecord);
    },

    async markPendingFromLiquidity(id, now) {
      const [row] = await db
        .update(withdrawals)
        .set({
          state: "PENDING",
          updatedAt: now,
          liquidityCheckedAt: now,
        })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "LIQUIDITY_PENDING")))
        .returning();
      if (!row) {
        await throwInvalidTransition(db, id, "PENDING");
      }
      return toRecord(row);
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

    async markBroadcastedWithDebit(id, params, _deps) {
      return db.transaction(async (tx) => {
        const [row] = await tx
          .update(withdrawals)
          .set({
            state: "BROADCASTED",
            nextRetryAt: null,
            lastError: null,
            updatedAt: params.now,
            txHash: params.txHash,
          })
          .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "PROCESSING")))
          .returning();

        if (!row) {
          await throwInvalidTransition(tx, id, "BROADCASTED");
        }

        const ledgerRepo = createDbLedgerRepo(tx);
        await ledgerRepo.debitOnce({
          appId: row.appId,
          userId: row.userId,
          asset: row.asset as WithdrawalAsset,
          amount: typeof row.amount === "string" ? row.amount : String(row.amount),
          refId: row.id,
          idempotencyKey: withdrawalDebitIdempotencyKey(row.id),
        });

        return toRecord(row);
      });
    },

    async markCompleted(id, params) {
      const setValues = params.txHash
        ? {
            state: "COMPLETED" as const,
            nextRetryAt: null,
            lastError: null,
            updatedAt: params.now,
            completedAt: params.now,
            txHash: params.txHash,
          }
        : {
            state: "COMPLETED" as const,
            nextRetryAt: null,
            lastError: null,
            updatedAt: params.now,
            completedAt: params.now,
          };
      const [row] = await db
        .update(withdrawals)
        .set(setValues)
        .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "BROADCASTED")))
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
          idempotencyKey: withdrawalDebitIdempotencyKey(row.id),
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

    async markFailedFromBroadcasted(id, params) {
      const [row] = await db
        .update(withdrawals)
        .set({
          state: "FAILED",
          nextRetryAt: null,
          lastError: params.error,
          updatedAt: params.now,
        })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "BROADCASTED")))
        .returning();
      if (!row) {
        await throwInvalidTransition(db, id, "FAILED");
      }
      return toRecord(row);
    },

    async markFailed(id, params) {
      const nextRetryCount = params.incrementRetryCount
        ? sql`${withdrawals.retryCount} + 1`
        : sql`${withdrawals.retryCount}`;
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

    async adminRetryNow(id, params) {
      const [row] = await db
        .update(withdrawals)
        .set({ nextRetryAt: params.now, updatedAt: params.now })
        .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "RETRY_PENDING")))
        .returning();
      if (!row) {
        await throwInvalidTransition(db, id, "RETRY_PENDING");
      }
      return toRecord(row);
    },

    async adminReviveFromFailed(id, params) {
      const [row] = await db
        .update(withdrawals)
        .set({ state: "PENDING", retryCount: 0, nextRetryAt: null, lastError: null, updatedAt: params.now })
        // The `tx_hash IS NULL` guard is the load-bearing safety rule: a FAILED
        // row that still has a tx_hash was already broadcast on-chain, so
        // re-queueing it would broadcast a second payout.
        .where(and(eq(withdrawals.id, id), eq(withdrawals.state, "FAILED"), isNull(withdrawals.txHash)))
        .returning();
      if (!row) {
        const [existing] = await db.select().from(withdrawals).where(eq(withdrawals.id, id)).limit(1);
        if (!existing) {
          throw new WithdrawalNotFoundError(id);
        }
        if (existing.state === "FAILED" && existing.txHash) {
          throw new WithdrawalRevivalBlockedError(id, existing.txHash);
        }
        throw new WithdrawalTransitionConflictError("PENDING", String(existing.state), id);
      }
      return toRecord(row);
    },

    async adminTerminalize(id, params) {
      const [row] = await db
        .update(withdrawals)
        .set({ state: "FAILED", nextRetryAt: null, lastError: params.reason, updatedAt: params.now })
        .where(
          and(
            eq(withdrawals.id, id),
            inArray(withdrawals.state, ["LIQUIDITY_PENDING", "PENDING", "RETRY_PENDING"]),
          ),
        )
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
  const pendingStates = new Set<WithdrawalState>(reservedWithdrawalStates);

  function clone(record: WithdrawalRecord): WithdrawalRecord {
    return {
      ...record,
      nextRetryAt: record.nextRetryAt ? new Date(record.nextRetryAt) : null,
      createdAt: new Date(record.createdAt),
      updatedAt: new Date(record.updatedAt),
      completedAt: record.completedAt ? new Date(record.completedAt) : null,
      liquidityCheckedAt: record.liquidityCheckedAt ? new Date(record.liquidityCheckedAt) : null,
    };
  }

  function findExistingClientRequest(input: {
    appId: string;
    userId: string;
    clientRequestId?: string;
  }): WithdrawalRecord | null {
    if (!input.clientRequestId) return null;

    const record = records.find(
      (item) =>
        item.appId === input.appId &&
        item.userId === input.userId &&
        item.clientRequestId === input.clientRequestId,
    );
    return record ? clone(record) : null;
  }

  return {
    async create(input) {
      assertPositiveAmount(input.amount);
      if (input.clientRequestId) {
        const existing = records.find(
          (item) =>
            item.appId === input.appId &&
            item.userId === input.userId &&
            item.clientRequestId === input.clientRequestId,
        );
        if (existing) return clone(existing);
      }
      const now = new Date();
      const record: WithdrawalRecord = {
        ...input,
        destinationKind: input.destinationKind ?? inferDestinationKind(input.toAddress),
        id: randomUUID(),
        state: "PENDING",
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        txHash: null,
        clientRequestId: input.clientRequestId ?? null,
        liquidityRequestId: null,
        liquidityPendingReason: null,
        liquidityCheckedAt: null,
      };
      records.push(record);
      return clone(record);
    },

    async createLiquidityPending(input) {
      assertPositiveAmount(input.amount);
      if (input.clientRequestId) {
        const existing = records.find(
          (item) =>
            item.appId === input.appId &&
            item.userId === input.userId &&
            item.clientRequestId === input.clientRequestId,
        );
        if (existing) return clone(existing);
      }
      const now = new Date();
      const record: WithdrawalRecord = {
        ...input,
        destinationKind: input.destinationKind ?? inferDestinationKind(input.toAddress),
        id: randomUUID(),
        state: "LIQUIDITY_PENDING",
        retryCount: 0,
        nextRetryAt: null,
        lastError: null,
        createdAt: now,
        updatedAt: now,
        completedAt: null,
        txHash: null,
        clientRequestId: input.clientRequestId ?? null,
        liquidityRequestId: input.liquidityRequestId,
        liquidityPendingReason: input.liquidityPendingReason,
        liquidityCheckedAt: now,
      };
      records.push(record);
      return clone(record);
    },

    async createLiquidityPendingWithBalanceCheck(input, deps) {
      const existing = findExistingClientRequest(input);
      if (existing) return existing;
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
      return this.createLiquidityPending(input);
    },

    async createWithBalanceCheck(input, deps) {
      const existing = findExistingClientRequest(input);
      if (existing) return existing;
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

    async getActiveCkbAddressReservationTotal(input) {
      const prefix = input.network === "AGGRON4" ? "ckt1" : "ckb1";
      const active = records.filter(
        (item) =>
          item.appId === input.appId &&
          item.asset === input.asset &&
          item.destinationKind === "CKB_ADDRESS" &&
          item.toAddress.toLowerCase().startsWith(prefix) &&
          (item.state === "PENDING" ||
            item.state === "PROCESSING" ||
            item.state === "BROADCASTED" ||
            item.state === "RETRY_PENDING"),
      );
      return sumAmounts(active.map((item) => item.amount));
    },

    async findByClientRequestId(input) {
      const record = records.find(
        (item) =>
          item.appId === input.appId && item.userId === input.userId && item.clientRequestId === input.clientRequestId,
      );
      return record ? clone(record) : null;
    },

    async findByIdOrThrow(id) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      return clone(record);
    },

    async listLiquidityPending() {
      return records.filter((item) => item.state === "LIQUIDITY_PENDING").map(clone);
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

    async listBroadcastedForConfirmation() {
      return records.filter((item) => item.state === "BROADCASTED").map(clone);
    },

    async reapStaleProcessing(input) {
      const reaped: WithdrawalRecord[] = [];
      for (const record of records) {
        if (record.state !== "PROCESSING" || record.updatedAt > input.staleBefore) {
          continue;
        }
        const computedRetryDelayMs = computeRetryDelay(input.baseRetryDelayMs, record.retryCount);
        record.state = "RETRY_PENDING";
        record.retryCount += 1;
        record.nextRetryAt = new Date(input.now.getTime() + computedRetryDelayMs);
        record.lastError = input.error;
        record.updatedAt = input.now;
        reaped.push(clone(record));
      }
      return reaped;
    },

    async markPendingFromLiquidity(id, now) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "LIQUIDITY_PENDING") {
        throw new WithdrawalTransitionConflictError("PENDING", record.state, id);
      }
      record.state = "PENDING";
      record.updatedAt = now;
      record.liquidityCheckedAt = now;
      return clone(record);
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

    async markBroadcastedWithDebit(id, params, deps) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "PROCESSING") {
        throw new WithdrawalTransitionConflictError("BROADCASTED", record.state, id);
      }
      record.state = "BROADCASTED";
      record.nextRetryAt = null;
      record.lastError = null;
      record.updatedAt = params.now;
      record.txHash = params.txHash;
      await deps.ledgerRepo.debitOnce({
        appId: record.appId,
        userId: record.userId,
        asset: record.asset,
        amount: record.amount,
        refId: record.id,
        idempotencyKey: withdrawalDebitIdempotencyKey(record.id),
      });
      return clone(record);
    },

    async markCompleted(id, params) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "BROADCASTED") {
        throw new WithdrawalTransitionConflictError("COMPLETED", record.state, id);
      }
      record.state = "COMPLETED";
      record.nextRetryAt = null;
      record.lastError = null;
      record.updatedAt = params.now;
      record.completedAt = params.now;
      if (params.txHash) {
        record.txHash = params.txHash;
      }
      return clone(record);
    },

    async markCompletedWithDebit(id, params, deps) {
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
      await deps.ledgerRepo.debitOnce({
        appId: record.appId,
        userId: record.userId,
        asset: record.asset,
        amount: record.amount,
        refId: record.id,
        idempotencyKey: withdrawalDebitIdempotencyKey(record.id),
      });
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

    async markFailedFromBroadcasted(id, params) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "BROADCASTED") {
        throw new WithdrawalTransitionConflictError("FAILED", record.state, id);
      }
      record.state = "FAILED";
      record.updatedAt = params.now;
      record.nextRetryAt = null;
      record.lastError = params.error;
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

    async adminRetryNow(id, params) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "RETRY_PENDING") {
        throw new WithdrawalTransitionConflictError("RETRY_PENDING", record.state, id);
      }
      record.nextRetryAt = params.now;
      record.updatedAt = params.now;
      return clone(record);
    },

    async adminReviveFromFailed(id, params) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "FAILED") {
        throw new WithdrawalTransitionConflictError("PENDING", record.state, id);
      }
      // Mirror the db guard: a broadcast tx_hash means an on-chain payout
      // already went out, so reviving would double-pay.
      if (record.txHash) {
        throw new WithdrawalRevivalBlockedError(id, record.txHash);
      }
      record.state = "PENDING";
      record.retryCount = 0;
      record.nextRetryAt = null;
      record.lastError = null;
      record.updatedAt = params.now;
      return clone(record);
    },

    async adminTerminalize(id, params) {
      const record = records.find((item) => item.id === id);
      if (!record) {
        throw new WithdrawalNotFoundError(id);
      }
      if (record.state !== "LIQUIDITY_PENDING" && record.state !== "PENDING" && record.state !== "RETRY_PENDING") {
        throw new WithdrawalTransitionConflictError("FAILED", record.state, id);
      }
      record.state = "FAILED";
      record.nextRetryAt = null;
      record.lastError = params.reason;
      record.updatedAt = params.now;
      return clone(record);
    },

    __resetForTests() {
      records.length = 0;
    },
  };
}
