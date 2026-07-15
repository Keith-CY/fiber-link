import { and, desc, eq, gte, sql } from "drizzle-orm";
import type { DbClient } from "./client";
import { tipIntents, withdrawals } from "./schema";

export type AnalyticsRange = "7d" | "30d" | "all";

export type AnalyticsTimeSeries = {
  date: string;
  amount: string;
};

export type AnalyticsTopPost = {
  postId: string;
  topicId: string | null;
  totalAmount: string;
  tipCount: number;
};

export type AnalyticsTopTipper = {
  userId: string;
  totalAmount: string;
  tipCount: number;
};

export type AnalyticsWithdrawal = {
  id: string;
  amount: string;
  asset: string;
  state: string;
  createdAt: string;
  completedAt: string | null;
};

export type AnalyticsResult = {
  timeSeries: AnalyticsTimeSeries[];
  topPosts: AnalyticsTopPost[];
  topTippers: AnalyticsTopTipper[];
  withdrawalHistory: AnalyticsWithdrawal[];
};

function rangeStart(range: AnalyticsRange): Date | null {
  if (range === "all") return null;
  const days = range === "7d" ? 7 : 30;
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export async function getCreatorAnalytics(
  db: DbClient,
  { appId, userId, range }: { appId: string; userId: string; range: AnalyticsRange },
): Promise<AnalyticsResult> {
  const since = rangeStart(range);

  const tipPredicates = [
    eq(tipIntents.appId, appId),
    eq(tipIntents.toUserId, userId),
    eq(tipIntents.invoiceState, "SETTLED"),
  ];
  if (since) {
    tipPredicates.push(gte(tipIntents.settledAt, since));
  }
  const tipWhere = and(...tipPredicates);

  const [timeSeriesRows, topPostRows, topTipperRows] = await Promise.all([
    db
      .select({
        date: sql<string>`to_char(${tipIntents.settledAt}::date, 'YYYY-MM-DD')`,
        amount: sql<string>`COALESCE(SUM(${tipIntents.amount}), 0)::text`,
      })
      .from(tipIntents)
      .where(tipWhere)
      .groupBy(sql`${tipIntents.settledAt}::date`)
      .orderBy(sql`${tipIntents.settledAt}::date`),

    db
      .select({
        postId: tipIntents.postId,
        // A post_id maps to exactly one topic, but topic_id is nullable for
        // rows created before it was tracked; MAX ignores NULLs so a post that
        // ever recorded a topic keeps its deep link.
        topicId: sql<string | null>`max(${tipIntents.topicId})`,
        totalAmount: sql<string>`COALESCE(SUM(${tipIntents.amount}), 0)::text`,
        tipCount: sql<number>`count(*)::int`,
      })
      .from(tipIntents)
      .where(tipWhere)
      .groupBy(tipIntents.postId)
      .orderBy(desc(sql`SUM(${tipIntents.amount})`))
      .limit(10),

    db
      .select({
        userId: tipIntents.fromUserId,
        totalAmount: sql<string>`COALESCE(SUM(${tipIntents.amount}), 0)::text`,
        tipCount: sql<number>`count(*)::int`,
      })
      .from(tipIntents)
      .where(tipWhere)
      .groupBy(tipIntents.fromUserId)
      .orderBy(desc(sql`SUM(${tipIntents.amount})`))
      .limit(10),
  ]);

  const withdrawalPredicates = [eq(withdrawals.appId, appId), eq(withdrawals.userId, userId)];
  if (since) {
    withdrawalPredicates.push(gte(withdrawals.createdAt, since));
  }

  const withdrawalRows = await db
    .select({
      id: withdrawals.id,
      amount: withdrawals.amount,
      asset: withdrawals.asset,
      state: withdrawals.state,
      createdAt: withdrawals.createdAt,
      completedAt: withdrawals.completedAt,
    })
    .from(withdrawals)
    .where(and(...withdrawalPredicates))
    .orderBy(desc(withdrawals.createdAt))
    .limit(50);

  return {
    timeSeries: timeSeriesRows.map((r) => ({ date: r.date, amount: r.amount })),
    topPosts: topPostRows.map((r) => ({
      postId: r.postId,
      topicId: r.topicId ?? null,
      totalAmount: r.totalAmount,
      tipCount: Number(r.tipCount),
    })),
    topTippers: topTipperRows.map((r) => ({
      userId: r.userId,
      totalAmount: r.totalAmount,
      tipCount: Number(r.tipCount),
    })),
    withdrawalHistory: withdrawalRows.map((r) => ({
      id: r.id,
      amount: String(r.amount),
      asset: r.asset,
      state: r.state,
      createdAt: r.createdAt.toISOString(),
      completedAt: r.completedAt ? r.completedAt.toISOString() : null,
    })),
  };
}
