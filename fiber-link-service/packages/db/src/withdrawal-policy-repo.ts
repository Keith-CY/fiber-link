import { and, eq, gte, ne, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { assertPositiveAmount, formatDecimal, parseDecimal, pow10 } from "./amount";
import { type Asset, withdrawalPolicies, withdrawals } from "./schema";

export type WithdrawalPolicyRecord = {
  appId: string;
  allowedAssets: Asset[];
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: number;
  updatedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export type UpsertWithdrawalPolicyInput = {
  appId: string;
  allowedAssets: Asset[];
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: number;
  updatedBy?: string | null;
};

export type WithdrawalPolicyUsageInput = {
  appId: string;
  userId: string;
  asset: Asset;
  now: Date;
};

export type WithdrawalPolicyUsage = {
  appDailyTotal: string;
  userDailyTotal: string;
  lastRequestedAt: Date | null;
};

export type WithdrawalPolicyRepo = {
  getByAppId(appId: string): Promise<WithdrawalPolicyRecord | null>;
  upsert(input: UpsertWithdrawalPolicyInput): Promise<WithdrawalPolicyRecord>;
  getUsage(input: WithdrawalPolicyUsageInput): Promise<WithdrawalPolicyUsage>;
  __setUsageForTests?: (input: WithdrawalPolicyUsageInput, usage: WithdrawalPolicyUsage) => void;
  __resetForTests?: () => void;
};

function normalizeAllowedAssets(raw: unknown): Asset[] {
  if (!Array.isArray(raw)) {
    return [];
  }
  const unique = new Set<Asset>();
  for (const item of raw) {
    if (item === "CKB" || item === "USDI") {
      unique.add(item);
    }
  }
  return [...unique.values()];
}

function normalizeAmount(amount: string): string {
  assertPositiveAmount(amount);
  const parsed = parseDecimal(amount);
  return formatDecimal(parsed.value, parsed.scale);
}

function toRecord(row: typeof withdrawalPolicies.$inferSelect): WithdrawalPolicyRecord {
  return {
    appId: row.appId,
    allowedAssets: normalizeAllowedAssets(row.allowedAssets),
    maxPerRequest: String(row.maxPerRequest),
    perUserDailyMax: String(row.perUserDailyMax),
    perAppDailyMax: String(row.perAppDailyMax),
    cooldownSeconds: row.cooldownSeconds,
    updatedBy: row.updatedBy,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function usageWindowStart(now: Date): Date {
  return new Date(now.getTime() - 24 * 60 * 60 * 1000);
}

export function createDbWithdrawalPolicyRepo(db: DbClient): WithdrawalPolicyRepo {
  return {
    async getByAppId(appId) {
      const [row] = await db
        .select()
        .from(withdrawalPolicies)
        .where(eq(withdrawalPolicies.appId, appId))
        .limit(1);
      if (!row) {
        return null;
      }
      return toRecord(row);
    },

    async upsert(input) {
      const allowedAssets = normalizeAllowedAssets(input.allowedAssets);
      if (allowedAssets.length === 0) {
        throw new Error("allowedAssets must include at least one supported asset");
      }
      const maxPerRequest = normalizeAmount(input.maxPerRequest);
      const perUserDailyMax = normalizeAmount(input.perUserDailyMax);
      const perAppDailyMax = normalizeAmount(input.perAppDailyMax);
      if (!Number.isInteger(input.cooldownSeconds) || input.cooldownSeconds < 0) {
        throw new Error("cooldownSeconds must be an integer >= 0");
      }

      const now = new Date();
      const [row] = await db
        .insert(withdrawalPolicies)
        .values({
          appId: input.appId,
          allowedAssets,
          maxPerRequest,
          perUserDailyMax,
          perAppDailyMax,
          cooldownSeconds: input.cooldownSeconds,
          updatedBy: input.updatedBy ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .onConflictDoUpdate({
          target: withdrawalPolicies.appId,
          set: {
            allowedAssets,
            maxPerRequest,
            perUserDailyMax,
            perAppDailyMax,
            cooldownSeconds: input.cooldownSeconds,
            updatedBy: input.updatedBy ?? null,
            updatedAt: now,
          },
        })
        .returning();
      return toRecord(row);
    },

    async getUsage(input) {
      const since = usageWindowStart(input.now);

      const [userRow] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${withdrawals.amount}), 0)`,
          lastRequestedAt: sql<Date | null>`MAX(${withdrawals.createdAt})`,
        })
        .from(withdrawals)
        .where(
          and(
            eq(withdrawals.appId, input.appId),
            eq(withdrawals.userId, input.userId),
            eq(withdrawals.asset, input.asset),
            ne(withdrawals.state, "FAILED"),
            gte(withdrawals.createdAt, since),
          ),
        );

      const [appRow] = await db
        .select({
          total: sql<string>`COALESCE(SUM(${withdrawals.amount}), 0)`,
        })
        .from(withdrawals)
        .where(
          and(
            eq(withdrawals.appId, input.appId),
            eq(withdrawals.asset, input.asset),
            ne(withdrawals.state, "FAILED"),
            gte(withdrawals.createdAt, since),
          ),
        );

      return {
        userDailyTotal: userRow ? String(userRow.total) : "0",
        appDailyTotal: appRow ? String(appRow.total) : "0",
        lastRequestedAt: userRow?.lastRequestedAt ? new Date(userRow.lastRequestedAt) : null,
      };
    },
  };
}

function usageKey(input: WithdrawalPolicyUsageInput): string {
  return `${input.appId}:${input.userId}:${input.asset}`;
}

function normalizeUsage(usage: WithdrawalPolicyUsage): WithdrawalPolicyUsage {
  return {
    appDailyTotal: usage.appDailyTotal,
    userDailyTotal: usage.userDailyTotal,
    lastRequestedAt: usage.lastRequestedAt ? new Date(usage.lastRequestedAt) : null,
  };
}

function compareDecimal(left: string, right: string): number {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const leftValue = a.value * pow10(scale - a.scale);
  const rightValue = b.value * pow10(scale - b.scale);
  if (leftValue === rightValue) return 0;
  return leftValue > rightValue ? 1 : -1;
}

export function createInMemoryWithdrawalPolicyRepo(
  initial: WithdrawalPolicyRecord[] = [],
): WithdrawalPolicyRepo {
  const byAppId = new Map<string, WithdrawalPolicyRecord>();
  for (const item of initial) {
    byAppId.set(item.appId, {
      ...item,
      allowedAssets: [...item.allowedAssets],
      createdAt: new Date(item.createdAt),
      updatedAt: new Date(item.updatedAt),
    });
  }
  const usageByKey = new Map<string, WithdrawalPolicyUsage>();

  return {
    async getByAppId(appId) {
      const row = byAppId.get(appId);
      if (!row) {
        return null;
      }
      return {
        ...row,
        allowedAssets: [...row.allowedAssets],
        createdAt: new Date(row.createdAt),
        updatedAt: new Date(row.updatedAt),
      };
    },

    async upsert(input) {
      const allowedAssets = normalizeAllowedAssets(input.allowedAssets);
      if (allowedAssets.length === 0) {
        throw new Error("allowedAssets must include at least one supported asset");
      }
      const maxPerRequest = normalizeAmount(input.maxPerRequest);
      const perUserDailyMax = normalizeAmount(input.perUserDailyMax);
      const perAppDailyMax = normalizeAmount(input.perAppDailyMax);
      if (!Number.isInteger(input.cooldownSeconds) || input.cooldownSeconds < 0) {
        throw new Error("cooldownSeconds must be an integer >= 0");
      }
      if (compareDecimal(maxPerRequest, perUserDailyMax) > 0) {
        throw new Error("maxPerRequest must be <= perUserDailyMax");
      }

      const current = byAppId.get(input.appId);
      const now = new Date();
      const createdAt = current?.createdAt ?? now;
      const next: WithdrawalPolicyRecord = {
        appId: input.appId,
        allowedAssets,
        maxPerRequest,
        perUserDailyMax,
        perAppDailyMax,
        cooldownSeconds: input.cooldownSeconds,
        updatedBy: input.updatedBy ?? null,
        createdAt,
        updatedAt: now,
      };
      byAppId.set(input.appId, next);
      return {
        ...next,
        allowedAssets: [...next.allowedAssets],
        createdAt: new Date(next.createdAt),
        updatedAt: new Date(next.updatedAt),
      };
    },

    async getUsage(input) {
      const usage = usageByKey.get(usageKey(input));
      if (!usage) {
        return {
          appDailyTotal: "0",
          userDailyTotal: "0",
          lastRequestedAt: null,
        };
      }
      return normalizeUsage(usage);
    },

    __setUsageForTests(input, usage) {
      usageByKey.set(usageKey(input), normalizeUsage(usage));
    },

    __resetForTests() {
      byAppId.clear();
      usageByKey.clear();
    },
  };
}
