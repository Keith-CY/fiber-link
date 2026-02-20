import { randomUUID } from "crypto";
import { and, asc, eq, gt, gte, lte, or, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { assertPositiveAmount } from "./amount";
import { tipIntents, type Asset, type InvoiceState } from "./schema";

export type TipAsset = Asset;
export type SettlementFailureReason =
  | "RETRY_TRANSIENT_ERROR"
  | "FAILED_UPSTREAM_REPORTED"
  | "FAILED_PENDING_TIMEOUT"
  | "FAILED_CONTRACT_MISMATCH"
  | "FAILED_RETRY_EXHAUSTED"
  | "FAILED_TERMINAL_ERROR";

export type CreateTipIntentInput = {
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: TipAsset;
  amount: string;
  invoice: string;
};

export type TipIntentRecord = CreateTipIntentInput & {
  id: string;
  invoiceState: InvoiceState;
  settlementRetryCount: number;
  settlementNextRetryAt: Date | null;
  settlementLastError: string | null;
  settlementFailureReason: SettlementFailureReason | null;
  settlementLastCheckedAt: Date | null;
  createdAt: Date;
  settledAt: Date | null;
};

export type TipIntentListCursor = {
  createdAt: Date;
  id: string;
};

export type TipIntentListOptions = {
  appId?: string;
  createdAtFrom?: Date;
  createdAtTo?: Date;
  limit?: number;
  after?: TipIntentListCursor;
};

export type TipIntentCountOptions = Omit<TipIntentListOptions, "limit" | "after">;

export class TipIntentNotFoundError extends Error {
  constructor(public readonly invoice: string) {
    super("tip intent not found");
    this.name = "TipIntentNotFoundError";
  }
}

const ALLOWED_INVOICE_STATE_TRANSITIONS: Record<InvoiceState, ReadonlySet<InvoiceState>> = {
  UNPAID: new Set<InvoiceState>(["UNPAID", "SETTLED", "FAILED"]),
  SETTLED: new Set<InvoiceState>(["SETTLED"]),
  FAILED: new Set<InvoiceState>(["FAILED"]),
};

function isAllowedInvoiceStateTransition(from: InvoiceState, to: InvoiceState): boolean {
  return ALLOWED_INVOICE_STATE_TRANSITIONS[from].has(to);
}

export class InvoiceStateTransitionError extends Error {
  constructor(
    public readonly invoice: string,
    public readonly from: InvoiceState,
    public readonly to: InvoiceState,
  ) {
    super(`invalid invoice state transition: ${from} -> ${to}`);
    this.name = "InvoiceStateTransitionError";
  }
}

export type TipIntentRepo = {
  create(input: CreateTipIntentInput): Promise<TipIntentRecord>;
  findByInvoiceOrThrow(invoice: string): Promise<TipIntentRecord>;
  updateInvoiceState(invoice: string, state: InvoiceState): Promise<TipIntentRecord>;
  markSettlementRetryPending(
    invoice: string,
    params: { now: Date; nextRetryAt: Date; error: string },
  ): Promise<TipIntentRecord>;
  clearSettlementFailure(invoice: string, params: { now: Date }): Promise<TipIntentRecord>;
  markSettlementTerminalFailure(
    invoice: string,
    params: { now: Date; reason: SettlementFailureReason; error: string },
  ): Promise<TipIntentRecord>;
  listByInvoiceState(state: InvoiceState, options?: TipIntentListOptions): Promise<TipIntentRecord[]>;
  countByInvoiceState(state: InvoiceState, options?: TipIntentCountOptions): Promise<number>;
  __resetForTests?: () => void;
};

type TipIntentRow = typeof tipIntents.$inferSelect;

function toRecord(row: TipIntentRow): TipIntentRecord {
  return {
    id: row.id,
    appId: row.appId,
    postId: row.postId,
    fromUserId: row.fromUserId,
    toUserId: row.toUserId,
    asset: row.asset as TipAsset,
    amount: typeof row.amount === "string" ? row.amount : String(row.amount),
    invoice: row.invoice,
    invoiceState: row.invoiceState as InvoiceState,
    settlementRetryCount: row.settlementRetryCount ?? 0,
    settlementNextRetryAt: row.settlementNextRetryAt ?? null,
    settlementLastError: row.settlementLastError ?? null,
    settlementFailureReason: (row.settlementFailureReason as SettlementFailureReason | null) ?? null,
    settlementLastCheckedAt: row.settlementLastCheckedAt ?? null,
    createdAt: row.createdAt,
    settledAt: row.settledAt ?? null,
  };
}

function isUniqueViolation(err: unknown): boolean {
  return Boolean(
    err &&
      typeof err === "object" &&
      "code" in err &&
      // postgres unique violation
      (err as { code?: unknown }).code === "23505",
  );
}

export function createDbTipIntentRepo(db: DbClient): TipIntentRepo {
  async function findRowOrThrow(invoice: string): Promise<TipIntentRow> {
    const [row] = await db.select().from(tipIntents).where(eq(tipIntents.invoice, invoice)).limit(1);
    if (!row) {
      throw new TipIntentNotFoundError(invoice);
    }
    return row;
  }

  function buildStateFilters(state: InvoiceState, options: TipIntentListOptions | TipIntentCountOptions = {}) {
    const filters = [eq(tipIntents.invoiceState, state)];
    if (options.appId) {
      filters.push(eq(tipIntents.appId, options.appId));
    }
    if (options.createdAtFrom) {
      filters.push(gte(tipIntents.createdAt, options.createdAtFrom));
    }
    if (options.createdAtTo) {
      filters.push(lte(tipIntents.createdAt, options.createdAtTo));
    }
    if ("after" in options && options.after) {
      filters.push(
        or(
          gt(tipIntents.createdAt, options.after.createdAt),
          and(eq(tipIntents.createdAt, options.after.createdAt), gt(tipIntents.id, options.after.id)),
        )!,
      );
    }
    return filters;
  }

  return {
    async create(input) {
      assertPositiveAmount(input.amount);
      const now = new Date();
      try {
        const [row] = await db
          .insert(tipIntents)
          .values({
            appId: input.appId,
            postId: input.postId,
            fromUserId: input.fromUserId,
            toUserId: input.toUserId,
            asset: input.asset,
            amount: input.amount,
            invoice: input.invoice,
            invoiceState: "UNPAID",
            settlementRetryCount: 0,
            settlementNextRetryAt: null,
            settlementLastError: null,
            settlementFailureReason: null,
            settlementLastCheckedAt: now,
            createdAt: now,
            settledAt: null,
          })
          .returning();
        return toRecord(row);
      } catch (err) {
        if (isUniqueViolation(err)) {
          throw new Error("duplicate invoice");
        }
        throw err;
      }
    },

    async findByInvoiceOrThrow(invoice) {
      const row = await findRowOrThrow(invoice);
      return toRecord(row);
    },

    async updateInvoiceState(invoice, state) {
      const now = new Date();
      const nextSettledAt = state === "SETTLED" ? sql`COALESCE(${tipIntents.settledAt}, ${now})` : null;
      const clearFailure = state === "SETTLED";
      const stateFilter =
        state === "SETTLED"
          ? or(eq(tipIntents.invoiceState, "UNPAID"), eq(tipIntents.invoiceState, "SETTLED"))
          : state === "FAILED"
            ? or(eq(tipIntents.invoiceState, "UNPAID"), eq(tipIntents.invoiceState, "FAILED"))
            : eq(tipIntents.invoiceState, "UNPAID");
      const [row] = await db
        .update(tipIntents)
        .set({
          invoiceState: state,
          settledAt: nextSettledAt,
          settlementLastCheckedAt: now,
          settlementRetryCount: clearFailure ? 0 : tipIntents.settlementRetryCount,
          settlementNextRetryAt: clearFailure ? null : tipIntents.settlementNextRetryAt,
          settlementLastError: clearFailure ? null : tipIntents.settlementLastError,
          settlementFailureReason: clearFailure ? null : tipIntents.settlementFailureReason,
        })
        .where(and(eq(tipIntents.invoice, invoice), stateFilter))
        .returning();
      if (row) {
        return toRecord(row);
      }

      const current = await findRowOrThrow(invoice);
      const currentState = current.invoiceState as InvoiceState;
      if (!isAllowedInvoiceStateTransition(currentState, state)) {
        throw new InvoiceStateTransitionError(invoice, currentState, state);
      }
      return toRecord(current);
    },

    async markSettlementRetryPending(invoice, params) {
      const [row] = await db
        .update(tipIntents)
        .set({
          settlementRetryCount: sql`${tipIntents.settlementRetryCount} + 1`,
          settlementNextRetryAt: params.nextRetryAt,
          settlementLastError: params.error,
          settlementFailureReason: "RETRY_TRANSIENT_ERROR",
          settlementLastCheckedAt: params.now,
        })
        .where(and(eq(tipIntents.invoice, invoice), eq(tipIntents.invoiceState, "UNPAID")))
        .returning();

      if (row) {
        return toRecord(row);
      }

      return toRecord(await findRowOrThrow(invoice));
    },

    async clearSettlementFailure(invoice, params) {
      const [row] = await db
        .update(tipIntents)
        .set({
          settlementRetryCount: 0,
          settlementNextRetryAt: null,
          settlementLastError: null,
          settlementFailureReason: null,
          settlementLastCheckedAt: params.now,
        })
        .where(eq(tipIntents.invoice, invoice))
        .returning();

      if (!row) {
        throw new TipIntentNotFoundError(invoice);
      }
      return toRecord(row);
    },

    async markSettlementTerminalFailure(invoice, params) {
      const [row] = await db
        .update(tipIntents)
        .set({
          invoiceState: "FAILED",
          settledAt: null,
          settlementNextRetryAt: null,
          settlementLastError: params.error,
          settlementFailureReason: params.reason,
          settlementLastCheckedAt: params.now,
        })
        .where(and(eq(tipIntents.invoice, invoice), eq(tipIntents.invoiceState, "UNPAID")))
        .returning();

      if (row) {
        return toRecord(row);
      }

      return toRecord(await findRowOrThrow(invoice));
    },

    async listByInvoiceState(state, options = {}) {
      const filters = buildStateFilters(state, options);

      let query = db
        .select()
        .from(tipIntents)
        .where(and(...filters))
        .orderBy(asc(tipIntents.createdAt), asc(tipIntents.id));
      if (options.limit && options.limit > 0) {
        query = query.limit(options.limit);
      }
      const rows = await query;
      return rows.map(toRecord);
    },

    async countByInvoiceState(state, options = {}) {
      const filters = buildStateFilters(state, options);
      const [row] = await db.select({ count: sql<number>`count(*)` }).from(tipIntents).where(and(...filters));
      return Number(row?.count ?? 0);
    },
  };
}

export function createInMemoryTipIntentRepo(): TipIntentRepo {
  const records: TipIntentRecord[] = [];

  function clone(record: TipIntentRecord): TipIntentRecord {
    return {
      ...record,
      createdAt: new Date(record.createdAt),
      settledAt: record.settledAt ? new Date(record.settledAt) : null,
      settlementNextRetryAt: record.settlementNextRetryAt ? new Date(record.settlementNextRetryAt) : null,
      settlementLastCheckedAt: record.settlementLastCheckedAt ? new Date(record.settlementLastCheckedAt) : null,
    };
  }

  return {
    async create(input) {
      assertPositiveAmount(input.amount);
      if (records.some((item) => item.invoice === input.invoice)) {
        throw new Error("duplicate invoice");
      }
      const now = new Date();
      const record: TipIntentRecord = {
        ...input,
        id: randomUUID(),
        invoiceState: "UNPAID",
        settlementRetryCount: 0,
        settlementNextRetryAt: null,
        settlementLastError: null,
        settlementFailureReason: null,
        settlementLastCheckedAt: now,
        createdAt: now,
        settledAt: null,
      };
      records.push(record);
      return clone(record);
    },

    async findByInvoiceOrThrow(invoice) {
      const record = records.find((item) => item.invoice === invoice);
      if (!record) {
        throw new TipIntentNotFoundError(invoice);
      }
      return clone(record);
    },

    async updateInvoiceState(invoice, state) {
      const record = records.find((item) => item.invoice === invoice);
      if (!record) {
        throw new TipIntentNotFoundError(invoice);
      }
      if (record.invoiceState === state) {
        return clone(record);
      }
      if (!isAllowedInvoiceStateTransition(record.invoiceState, state)) {
        throw new InvoiceStateTransitionError(invoice, record.invoiceState, state);
      }

      record.invoiceState = state;
      if (state === "SETTLED") {
        record.settledAt = record.settledAt ?? new Date();
        record.settlementRetryCount = 0;
        record.settlementNextRetryAt = null;
        record.settlementLastError = null;
        record.settlementFailureReason = null;
      } else {
        record.settledAt = null;
      }
      record.settlementLastCheckedAt = new Date();
      return clone(record);
    },

    async markSettlementRetryPending(invoice, params) {
      const record = records.find((item) => item.invoice === invoice);
      if (!record) {
        throw new TipIntentNotFoundError(invoice);
      }
      if (record.invoiceState !== "UNPAID") {
        return clone(record);
      }

      record.settlementRetryCount += 1;
      record.settlementNextRetryAt = new Date(params.nextRetryAt);
      record.settlementLastError = params.error;
      record.settlementFailureReason = "RETRY_TRANSIENT_ERROR";
      record.settlementLastCheckedAt = new Date(params.now);
      return clone(record);
    },

    async clearSettlementFailure(invoice, params) {
      const record = records.find((item) => item.invoice === invoice);
      if (!record) {
        throw new TipIntentNotFoundError(invoice);
      }
      record.settlementRetryCount = 0;
      record.settlementNextRetryAt = null;
      record.settlementLastError = null;
      record.settlementFailureReason = null;
      record.settlementLastCheckedAt = new Date(params.now);
      return clone(record);
    },

    async markSettlementTerminalFailure(invoice, params) {
      const record = records.find((item) => item.invoice === invoice);
      if (!record) {
        throw new TipIntentNotFoundError(invoice);
      }
      if (record.invoiceState !== "UNPAID") {
        return clone(record);
      }
      record.invoiceState = "FAILED";
      record.settledAt = null;
      record.settlementNextRetryAt = null;
      record.settlementLastError = params.error;
      record.settlementFailureReason = params.reason;
      record.settlementLastCheckedAt = new Date(params.now);
      return clone(record);
    },

    async listByInvoiceState(state, options = {}) {
      let items = records.filter((item) => item.invoiceState === state);
      if (options.appId) {
        items = items.filter((item) => item.appId === options.appId);
      }
      if (options.createdAtFrom) {
        items = items.filter((item) => item.createdAt >= options.createdAtFrom!);
      }
      if (options.createdAtTo) {
        items = items.filter((item) => item.createdAt <= options.createdAtTo!);
      }
      if (options.after) {
        const cursorTime = options.after.createdAt.getTime();
        items = items.filter((item) => {
          const itemTime = item.createdAt.getTime();
          return itemTime > cursorTime || (itemTime === cursorTime && item.id > options.after!.id);
        });
      }
      items = items.sort((left, right) => {
        const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return left.id.localeCompare(right.id);
      });
      if (options.limit && options.limit > 0) {
        items = items.slice(0, options.limit);
      }
      return items.map(clone);
    },

    async countByInvoiceState(state, options = {}) {
      let items = records.filter((item) => item.invoiceState === state);
      if (options.appId) {
        items = items.filter((item) => item.appId === options.appId);
      }
      if (options.createdAtFrom) {
        items = items.filter((item) => item.createdAt >= options.createdAtFrom!);
      }
      if (options.createdAtTo) {
        items = items.filter((item) => item.createdAt <= options.createdAtTo!);
      }
      return items.length;
    },

    __resetForTests() {
      records.length = 0;
    },
  };
}
