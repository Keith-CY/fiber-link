import { randomUUID } from "node:crypto";
import { and, desc, eq, lt, or, sql } from "drizzle-orm";
import { assertPositiveAmount, formatDecimal, parseDecimal, pow10 } from "./amount";
import type { DbClient } from "./client";
import { type Asset, ledgerEntries } from "./schema";

export type LedgerAsset = Asset;

export type LedgerWriteInput = {
  appId: string;
  userId: string;
  asset: LedgerAsset;
  amount: string;
  refId: string;
  idempotencyKey: string;
};

export type LedgerEntryType = "credit" | "debit";

export type LedgerEntryRecord = LedgerWriteInput & {
  id: string;
  type: LedgerEntryType;
  createdAt: Date;
};

export type LedgerWriteResult = { applied: boolean; entry?: LedgerEntryRecord };

export type LedgerEntryListCursor = {
  createdAt: Date;
  id: string;
};

export type LedgerEntryListOptions = {
  appId: string;
  userId?: string;
  asset?: LedgerAsset;
  type?: LedgerEntryType;
  limit?: number;
  after?: LedgerEntryListCursor;
};

export type LedgerBalanceBreakdown = {
  appId: string;
  userId: string;
  asset: LedgerAsset;
  balance: string;
  creditTotal: string;
  debitTotal: string;
  creditCount: number;
  debitCount: number;
  firstEntryAt: Date | null;
  lastEntryAt: Date | null;
};

export const LEDGER_ENTRY_LIST_DEFAULT_LIMIT = 50;
export const LEDGER_ENTRY_LIST_MAX_LIMIT = 200;

export type LedgerRepo = {
  creditOnce(input: LedgerWriteInput): Promise<LedgerWriteResult>;
  debitOnce(input: LedgerWriteInput): Promise<LedgerWriteResult>;
  getBalance(input: { appId: string; userId: string; asset: LedgerAsset }): Promise<string>;
  /** Newest first with keyset (createdAt, id) pagination; limit is clamped to {@link LEDGER_ENTRY_LIST_MAX_LIMIT}. */
  listEntries(options: LedgerEntryListOptions): Promise<LedgerEntryRecord[]>;
  /** Explain an account balance from its source credits/debits. */
  getBalanceBreakdown(input: { appId: string; userId: string; asset: LedgerAsset }): Promise<LedgerBalanceBreakdown>;
  __listForTests?: () => LedgerEntryRecord[];
  __resetForTests?: () => void;
};

type LedgerEntryRow = typeof ledgerEntries.$inferSelect;

function toRecord(row: LedgerEntryRow): LedgerEntryRecord {
  return {
    id: row.id,
    appId: row.appId,
    userId: row.userId,
    asset: row.asset as LedgerAsset,
    amount: typeof row.amount === "string" ? row.amount : String(row.amount),
    type: row.type as LedgerEntryType,
    refId: row.refId,
    idempotencyKey: row.idempotencyKey,
    createdAt: row.createdAt,
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

function sumEntries(entries: { type: LedgerEntryType; amount: string }[]): string {
  if (entries.length === 0) return "0";

  const parsed = entries.map((e) => {
    const p = parseDecimal(e.amount);
    const sign = e.type === "debit" ? -1n : 1n;
    return { value: p.value * sign, scale: p.scale };
  });

  const maxScale = parsed.reduce((m, p) => Math.max(m, p.scale), 0);
  const sum = parsed.reduce((acc, p) => acc + p.value * pow10(maxScale - p.scale), 0n);
  return formatDecimal(sum, maxScale);
}

export function createDbLedgerRepo(db: DbClient): LedgerRepo {
  async function writeOnce(input: LedgerWriteInput, type: LedgerEntryType): Promise<LedgerWriteResult> {
    assertPositiveAmount(input.amount);

    const now = new Date();

    try {
      const inserted = await db
        .insert(ledgerEntries)
        .values({
          appId: input.appId,
          userId: input.userId,
          asset: input.asset,
          amount: input.amount,
          type,
          refId: input.refId,
          idempotencyKey: input.idempotencyKey,
          createdAt: now,
        })
        .onConflictDoNothing({ target: ledgerEntries.idempotencyKey })
        .returning();

      if (inserted.length > 0) {
        return { applied: true, entry: toRecord(inserted[0]) };
      }
    } catch (err) {
      // Race between two workers can still throw a unique violation depending on driver settings.
      if (!isUniqueViolation(err)) {
        throw err;
      }
    }

    const [existing] = await db
      .select()
      .from(ledgerEntries)
      .where(eq(ledgerEntries.idempotencyKey, input.idempotencyKey))
      .limit(1);
    return { applied: false, entry: existing ? toRecord(existing) : undefined };
  }

  return {
    async creditOnce(input) {
      return writeOnce(input, "credit");
    },

    async debitOnce(input) {
      return writeOnce(input, "debit");
    },

    async getBalance(input) {
      const [row] = await db
        .select({
          balance: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.type} = 'credit' THEN ${ledgerEntries.amount} ELSE -${ledgerEntries.amount} END), 0)`,
        })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.appId, input.appId),
            eq(ledgerEntries.userId, input.userId),
            eq(ledgerEntries.asset, input.asset),
          ),
        );

      return row ? String(row.balance) : "0";
    },

    async listEntries(options) {
      const limit = Math.min(
        Math.max(options.limit ?? LEDGER_ENTRY_LIST_DEFAULT_LIMIT, 1),
        LEDGER_ENTRY_LIST_MAX_LIMIT,
      );
      const clauses = [eq(ledgerEntries.appId, options.appId)];
      if (options.userId) {
        clauses.push(eq(ledgerEntries.userId, options.userId));
      }
      if (options.asset) {
        clauses.push(eq(ledgerEntries.asset, options.asset));
      }
      if (options.type) {
        clauses.push(eq(ledgerEntries.type, options.type));
      }
      if (options.after) {
        const keyset = or(
          lt(ledgerEntries.createdAt, options.after.createdAt),
          and(eq(ledgerEntries.createdAt, options.after.createdAt), lt(ledgerEntries.id, options.after.id)),
        );
        if (keyset) {
          clauses.push(keyset);
        }
      }

      const rows = await db
        .select()
        .from(ledgerEntries)
        .where(and(...clauses))
        .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
        .limit(limit);
      return rows.map(toRecord);
    },

    async getBalanceBreakdown(input) {
      const [row] = await db
        .select({
          balance: sql<string>`COALESCE(SUM(CASE WHEN ${ledgerEntries.type} = 'credit' THEN ${ledgerEntries.amount} ELSE -${ledgerEntries.amount} END), 0)`,
          creditTotal: sql<string>`COALESCE(SUM(${ledgerEntries.amount}) FILTER (WHERE ${ledgerEntries.type} = 'credit'), 0)`,
          debitTotal: sql<string>`COALESCE(SUM(${ledgerEntries.amount}) FILTER (WHERE ${ledgerEntries.type} = 'debit'), 0)`,
          creditCount: sql<number>`(COUNT(*) FILTER (WHERE ${ledgerEntries.type} = 'credit'))::int`,
          debitCount: sql<number>`(COUNT(*) FILTER (WHERE ${ledgerEntries.type} = 'debit'))::int`,
          firstEntryAt: sql<Date | null>`MIN(${ledgerEntries.createdAt})`,
          lastEntryAt: sql<Date | null>`MAX(${ledgerEntries.createdAt})`,
        })
        .from(ledgerEntries)
        .where(
          and(
            eq(ledgerEntries.appId, input.appId),
            eq(ledgerEntries.userId, input.userId),
            eq(ledgerEntries.asset, input.asset),
          ),
        );

      return {
        appId: input.appId,
        userId: input.userId,
        asset: input.asset,
        balance: row ? String(row.balance) : "0",
        creditTotal: row ? String(row.creditTotal) : "0",
        debitTotal: row ? String(row.debitTotal) : "0",
        creditCount: row ? Number(row.creditCount) : 0,
        debitCount: row ? Number(row.debitCount) : 0,
        firstEntryAt: row?.firstEntryAt ? new Date(row.firstEntryAt) : null,
        lastEntryAt: row?.lastEntryAt ? new Date(row.lastEntryAt) : null,
      };
    },
  };
}

export function createInMemoryLedgerRepo(): LedgerRepo {
  const entries: LedgerEntryRecord[] = [];

  function clone(record: LedgerEntryRecord): LedgerEntryRecord {
    return { ...record, createdAt: new Date(record.createdAt) };
  }

  async function writeOnce(input: LedgerWriteInput, type: LedgerEntryType): Promise<LedgerWriteResult> {
    assertPositiveAmount(input.amount);

    const existing = entries.find((item) => item.idempotencyKey === input.idempotencyKey);
    if (existing) {
      return { applied: false, entry: clone(existing) };
    }

    const record: LedgerEntryRecord = {
      ...input,
      id: randomUUID(),
      type,
      createdAt: new Date(),
    };
    entries.push(record);
    return { applied: true, entry: clone(record) };
  }

  return {
    async creditOnce(input) {
      return writeOnce(input, "credit");
    },

    async debitOnce(input) {
      return writeOnce(input, "debit");
    },

    async getBalance(input) {
      const relevant = entries.filter(
        (item) => item.appId === input.appId && item.userId === input.userId && item.asset === input.asset,
      );
      return sumEntries(relevant);
    },

    async listEntries(options) {
      const limit = Math.min(
        Math.max(options.limit ?? LEDGER_ENTRY_LIST_DEFAULT_LIMIT, 1),
        LEDGER_ENTRY_LIST_MAX_LIMIT,
      );
      let items = entries.filter((item) => item.appId === options.appId);
      if (options.userId) {
        items = items.filter((item) => item.userId === options.userId);
      }
      if (options.asset) {
        items = items.filter((item) => item.asset === options.asset);
      }
      if (options.type) {
        items = items.filter((item) => item.type === options.type);
      }
      items = items.slice().sort((left, right) => {
        const createdAtDiff = right.createdAt.getTime() - left.createdAt.getTime();
        if (createdAtDiff !== 0) {
          return createdAtDiff;
        }
        return right.id.localeCompare(left.id);
      });
      const after = options.after;
      if (after) {
        items = items.filter(
          (item) =>
            item.createdAt.getTime() < after.createdAt.getTime() ||
            (item.createdAt.getTime() === after.createdAt.getTime() && item.id < after.id),
        );
      }
      return items.slice(0, limit).map(clone);
    },

    async getBalanceBreakdown(input) {
      const relevant = entries.filter(
        (item) => item.appId === input.appId && item.userId === input.userId && item.asset === input.asset,
      );
      const credits = relevant.filter((item) => item.type === "credit");
      const debits = relevant.filter((item) => item.type === "debit");
      const timestamps = relevant.map((item) => item.createdAt.getTime());
      return {
        appId: input.appId,
        userId: input.userId,
        asset: input.asset,
        balance: sumEntries(relevant),
        creditTotal: sumEntries(credits),
        // sumEntries signs debits negative; total debit volume is the magnitude.
        debitTotal: sumEntries(debits).replace(/^-/, ""),
        creditCount: credits.length,
        debitCount: debits.length,
        firstEntryAt: timestamps.length > 0 ? new Date(Math.min(...timestamps)) : null,
        lastEntryAt: timestamps.length > 0 ? new Date(Math.max(...timestamps)) : null,
      };
    },

    __listForTests() {
      return entries.map(clone);
    },

    __resetForTests() {
      entries.length = 0;
    },
  };
}
