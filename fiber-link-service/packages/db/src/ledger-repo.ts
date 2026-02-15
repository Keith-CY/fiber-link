import { randomUUID } from "crypto";
import { and, eq, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { ledgerEntries, type Asset } from "./schema";

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

export type LedgerRepo = {
  creditOnce(input: LedgerWriteInput): Promise<LedgerWriteResult>;
  debitOnce(input: LedgerWriteInput): Promise<LedgerWriteResult>;
  getBalance(input: { appId: string; userId: string; asset: LedgerAsset }): Promise<string>;
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
        .where(and(eq(ledgerEntries.appId, input.appId), eq(ledgerEntries.userId, input.userId), eq(ledgerEntries.asset, input.asset)));

      return row ? String(row.balance) : "0";
    },
  };
}

export function createInMemoryLedgerRepo(): LedgerRepo {
  const entries: LedgerEntryRecord[] = [];

  function clone(record: LedgerEntryRecord): LedgerEntryRecord {
    return { ...record, createdAt: new Date(record.createdAt) };
  }

  async function writeOnce(input: LedgerWriteInput, type: LedgerEntryType): Promise<LedgerWriteResult> {
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

    __listForTests() {
      return entries.map(clone);
    },

    __resetForTests() {
      entries.length = 0;
    },
  };
}
