import { randomUUID } from "crypto";
import { and, asc, eq, gte, lte, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { tipIntents } from "./schema";

export type TipAsset = "CKB" | "USDI";
export type InvoiceState = "UNPAID" | "SETTLED" | "FAILED";

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
  createdAt: Date;
  settledAt: Date | null;
};

export class TipIntentNotFoundError extends Error {
  constructor(public readonly invoice: string) {
    super("tip intent not found");
    this.name = "TipIntentNotFoundError";
  }
}

export type TipIntentRepo = {
  create(input: CreateTipIntentInput): Promise<TipIntentRecord>;
  findByInvoiceOrThrow(invoice: string): Promise<TipIntentRecord>;
  updateInvoiceState(invoice: string, state: InvoiceState): Promise<TipIntentRecord>;
  listByInvoiceState(
    state: InvoiceState,
    options?: { appId?: string; createdAtFrom?: Date; createdAtTo?: Date; limit?: number },
  ): Promise<TipIntentRecord[]>;
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
  return {
    async create(input) {
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
      const [row] = await db.select().from(tipIntents).where(eq(tipIntents.invoice, invoice)).limit(1);
      if (!row) {
        throw new TipIntentNotFoundError(invoice);
      }
      return toRecord(row);
    },

    async updateInvoiceState(invoice, state) {
      const now = new Date();
      const nextSettledAt = state === "SETTLED" ? sql`COALESCE(${tipIntents.settledAt}, ${now})` : null;
      const [row] = await db
        .update(tipIntents)
        .set({ invoiceState: state, settledAt: nextSettledAt })
        .where(eq(tipIntents.invoice, invoice))
        .returning();
      if (!row) {
        throw new TipIntentNotFoundError(invoice);
      }
      return toRecord(row);
    },

    async listByInvoiceState(state, options = {}) {
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

      let query = db.select().from(tipIntents).where(and(...filters)).orderBy(asc(tipIntents.createdAt));
      if (options.limit && options.limit > 0) {
        query = query.limit(options.limit);
      }
      const rows = await query;
      return rows.map(toRecord);
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
    };
  }

  return {
    async create(input) {
      if (records.some((item) => item.invoice === input.invoice)) {
        throw new Error("duplicate invoice");
      }
      const now = new Date();
      const record: TipIntentRecord = {
        ...input,
        id: randomUUID(),
        invoiceState: "UNPAID",
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

      record.invoiceState = state;
      if (state === "SETTLED") {
        record.settledAt = record.settledAt ?? new Date();
      } else {
        record.settledAt = null;
      }
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
      items = items.sort((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      if (options.limit && options.limit > 0) {
        items = items.slice(0, options.limit);
      }
      return items.map(clone);
    },

    __resetForTests() {
      records.length = 0;
    },
  };
}
