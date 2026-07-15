import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getCreatorAnalytics } from "./analytics-repo";
import type { DbClient } from "./client";
import { tipIntents, withdrawals } from "./schema";
import { type PgliteTestDb, createPgliteTestDb } from "./test-helpers/pglite";

const APP = "app-analytics";
const CREATOR = "creator-1";
const OTHER_CREATOR = "creator-2";

function daysAgoAtNoonUtc(days: number): Date {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  d.setUTCHours(12, 0, 0, 0);
  return d;
}

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

describe("getCreatorAnalytics (PGlite: real SQL over the committed migrations)", () => {
  let harness: PgliteTestDb;
  let db: DbClient;

  async function seedTip(input: {
    postId: string;
    topicId?: string | null;
    toUserId?: string;
    fromUserId?: string;
    amount: string;
    settledDaysAgo?: number;
    appId?: string;
    state?: "SETTLED" | "UNPAID";
  }): Promise<void> {
    const settled = input.state !== "UNPAID";
    const settledAt = settled ? daysAgoAtNoonUtc(input.settledDaysAgo ?? 0) : null;
    await db.insert(tipIntents).values({
      appId: input.appId ?? APP,
      postId: input.postId,
      topicId: input.topicId ?? null,
      fromUserId: input.fromUserId ?? "tipper-1",
      toUserId: input.toUserId ?? CREATOR,
      asset: "CKB",
      amount: input.amount,
      invoice: `inv-${randomUUID()}`,
      invoiceState: settled ? "SETTLED" : "UNPAID",
      createdAt: settledAt ?? new Date(),
      settledAt,
    });
  }

  async function seedWithdrawal(input: {
    amount: string;
    createdDaysAgo?: number;
    userId?: string;
    state?: string;
  }): Promise<void> {
    const createdAt = daysAgoAtNoonUtc(input.createdDaysAgo ?? 0);
    await db.insert(withdrawals).values({
      appId: APP,
      userId: input.userId ?? CREATOR,
      asset: "CKB",
      amount: input.amount,
      toAddress: "ckt1qexampleaddress",
      state: (input.state ?? "COMPLETED") as never,
      createdAt,
      completedAt: input.state === "COMPLETED" || input.state === undefined ? createdAt : null,
    });
  }

  beforeAll(async () => {
    harness = await createPgliteTestDb();
    db = harness.db;

    // Time series + range fixtures for CREATOR:
    //   2 days ago: 10 + 20 on the same day (bucket sums to 30)
    //   5 days ago: 7
    //   10 days ago: 40   (outside 7d, inside 30d)
    //   40 days ago: 100  (outside 30d, inside all)
    await seedTip({ postId: "post-a", topicId: "topic-a", amount: "10", settledDaysAgo: 2, fromUserId: "tipper-1" });
    await seedTip({ postId: "post-a", topicId: "topic-a", amount: "20", settledDaysAgo: 2, fromUserId: "tipper-2" });
    await seedTip({ postId: "post-b", topicId: "topic-b", amount: "7", settledDaysAgo: 5, fromUserId: "tipper-2" });
    await seedTip({ postId: "post-c", topicId: null, amount: "40", settledDaysAgo: 10, fromUserId: "tipper-3" });
    await seedTip({ postId: "post-d", topicId: "topic-d", amount: "100", settledDaysAgo: 40, fromUserId: "tipper-3" });

    // Noise that must never surface for CREATOR:
    await seedTip({ postId: "post-x", amount: "999", settledDaysAgo: 1, toUserId: OTHER_CREATOR });
    await seedTip({ postId: "post-y", amount: "888", settledDaysAgo: 1, appId: "other-app" });
    await seedTip({ postId: "post-z", amount: "777", state: "UNPAID" });

    await seedWithdrawal({ amount: "12", createdDaysAgo: 1 });
    await seedWithdrawal({ amount: "34", createdDaysAgo: 3, state: "PENDING" });
    await seedWithdrawal({ amount: "56", createdDaysAgo: 2, userId: OTHER_CREATOR });
  }, 60_000);

  afterAll(async () => {
    await harness.close();
  });

  it("7d: buckets daily sums and excludes older tips", async () => {
    const result = await getCreatorAnalytics(db, { appId: APP, userId: CREATOR, range: "7d" });

    expect(result.timeSeries).toEqual([
      { date: dateKey(daysAgoAtNoonUtc(5)), amount: "7" },
      { date: dateKey(daysAgoAtNoonUtc(2)), amount: "30" },
    ]);
  });

  it("30d: includes the 10-day-old tip but not the 40-day-old one", async () => {
    const result = await getCreatorAnalytics(db, { appId: APP, userId: CREATOR, range: "30d" });

    const dates = result.timeSeries.map((r) => r.date);
    expect(dates).toContain(dateKey(daysAgoAtNoonUtc(10)));
    expect(dates).not.toContain(dateKey(daysAgoAtNoonUtc(40)));
    const total = result.timeSeries.reduce((sum, r) => sum + Number(r.amount), 0);
    expect(total).toBe(30 + 7 + 40);
  });

  it("all: includes tips older than 30 days", async () => {
    const result = await getCreatorAnalytics(db, { appId: APP, userId: CREATOR, range: "all" });

    const dates = result.timeSeries.map((r) => r.date);
    expect(dates).toContain(dateKey(daysAgoAtNoonUtc(40)));
    const total = result.timeSeries.reduce((sum, r) => sum + Number(r.amount), 0);
    expect(total).toBe(30 + 7 + 40 + 100);
  });

  it("ranks top posts by total tip amount, not tip count, and returns topicId", async () => {
    const result = await getCreatorAnalytics(db, { appId: APP, userId: CREATOR, range: "all" });

    // post-d: 100 (1 tip) > post-c: 40 (1 tip) > post-a: 30 (2 tips) > post-b: 7
    expect(result.topPosts.map((p) => p.postId)).toEqual(["post-d", "post-c", "post-a", "post-b"]);
    expect(result.topPosts[0]).toEqual({ postId: "post-d", topicId: "topic-d", totalAmount: "100", tipCount: 1 });
    expect(result.topPosts[2]).toEqual({ postId: "post-a", topicId: "topic-a", totalAmount: "30", tipCount: 2 });
    // Rows that never recorded a topic keep a null topicId (no deep link).
    expect(result.topPosts[1]).toEqual({ postId: "post-c", topicId: null, totalAmount: "40", tipCount: 1 });
  });

  it("ranks top tippers by total tip amount", async () => {
    const result = await getCreatorAnalytics(db, { appId: APP, userId: CREATOR, range: "all" });

    // tipper-3: 40+100=140 > tipper-2: 20+7=27 > tipper-1: 10
    expect(result.topTippers).toEqual([
      { userId: "tipper-3", totalAmount: "140", tipCount: 2 },
      { userId: "tipper-2", totalAmount: "27", tipCount: 2 },
      { userId: "tipper-1", totalAmount: "10", tipCount: 1 },
    ]);
  });

  it("never leaks another creator's or another app's tips (isolation)", async () => {
    const result = await getCreatorAnalytics(db, { appId: APP, userId: CREATOR, range: "all" });

    const posts = result.topPosts.map((p) => p.postId);
    expect(posts).not.toContain("post-x");
    expect(posts).not.toContain("post-y");
    expect(posts).not.toContain("post-z");

    const other = await getCreatorAnalytics(db, { appId: APP, userId: OTHER_CREATOR, range: "all" });
    expect(other.topPosts.map((p) => p.postId)).toEqual(["post-x"]);
  });

  it("returns withdrawal history for the creator only, newest first", async () => {
    const result = await getCreatorAnalytics(db, { appId: APP, userId: CREATOR, range: "all" });

    expect(result.withdrawalHistory).toHaveLength(2);
    expect(result.withdrawalHistory[0].amount).toBe("12");
    expect(result.withdrawalHistory[0].state).toBe("COMPLETED");
    expect(result.withdrawalHistory[0].completedAt).not.toBeNull();
    expect(result.withdrawalHistory[1].amount).toBe("34");
    expect(result.withdrawalHistory[1].state).toBe("PENDING");
    expect(result.withdrawalHistory[1].completedAt).toBeNull();
  });

  it("empty data: a brand-new creator gets empty arrays, not errors", async () => {
    const result = await getCreatorAnalytics(db, { appId: APP, userId: "creator-brand-new", range: "7d" });

    expect(result).toEqual({
      timeSeries: [],
      topPosts: [],
      topTippers: [],
      withdrawalHistory: [],
    });
  });
});
