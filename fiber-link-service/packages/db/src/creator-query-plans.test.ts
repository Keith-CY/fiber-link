import { and, desc, eq, gte } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { tipIntents } from "./schema";
import { type PgliteTestDb, createPgliteTestDb } from "./test-helpers/pglite";

const CREATOR_RECENT_INDEX = "tip_intents_app_to_user_created_at_idx";
const CREATOR_SETTLED_INDEX = "tip_intents_app_to_user_state_settled_at_idx";

/**
 * Creator dashboards (dashboard.summary recent tips + tip stats, and
 * dashboard.analytics) filter tip_intents by (app_id, to_user_id). Without a
 * matching index the only candidates lead with app_id alone, so every request
 * walks the app's whole tip history. Seq scans are disabled so the planner must
 * pick an index even on an empty table; the assertion is which one it picks.
 */
describe("creator dashboard query plans (PGlite)", () => {
  let harness: PgliteTestDb;

  async function explain(query: { toSQL: () => { sql: string; params: unknown[] } }): Promise<string> {
    const { sql, params } = query.toSQL();
    const result = await harness.raw.query<{ "QUERY PLAN": string }>(`EXPLAIN ${sql}`, params);
    return result.rows.map((row) => row["QUERY PLAN"]).join("\n");
  }

  beforeAll(async () => {
    harness = await createPgliteTestDb();
    await harness.raw.exec("SET enable_seqscan = off");
  });

  afterAll(async () => {
    await harness.close();
  });

  it("recent tips received by a creator read the creator recent index in order", async () => {
    const plan = await explain(
      harness.db
        .select()
        .from(tipIntents)
        .where(and(eq(tipIntents.appId, "app-1"), eq(tipIntents.toUserId, "creator-1")))
        .orderBy(desc(tipIntents.createdAt), desc(tipIntents.id))
        .limit(20),
    );

    expect(plan).toContain(CREATOR_RECENT_INDEX);
    // The index already yields rows in the requested order.
    expect(plan).not.toMatch(/\bSort\b/);
  });

  it("creator analytics over settled tips use the creator settled index", async () => {
    const plan = await explain(
      harness.db
        .select({ id: tipIntents.id })
        .from(tipIntents)
        .where(
          and(
            eq(tipIntents.appId, "app-1"),
            eq(tipIntents.toUserId, "creator-1"),
            eq(tipIntents.invoiceState, "SETTLED"),
            gte(tipIntents.settledAt, new Date("2026-01-01T00:00:00Z")),
          ),
        ),
    );

    expect(plan).toContain(CREATOR_SETTLED_INDEX);
    expect(plan).not.toContain("Filter:");
  });
});
