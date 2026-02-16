import { and, desc, eq, or } from "drizzle-orm";
import { createDbClient, createDbLedgerRepo, tipIntents } from "@fiber-link/db";

type HandleDashboardSummaryInput = {
  appId: string;
  userId: string;
  limit?: number;
};

let defaultDbClient: ReturnType<typeof createDbClient> | null = null;

function getDefaultDbClient() {
  if (!defaultDbClient) {
    defaultDbClient = createDbClient();
  }
  return defaultDbClient;
}

export async function handleDashboardSummary(input: HandleDashboardSummaryInput) {
  const db = getDefaultDbClient();
  const ledgerRepo = createDbLedgerRepo(db);
  const limit = input.limit ?? 20;

  const [balance, recentTips] = await Promise.all([
    ledgerRepo.getBalance({
      appId: input.appId,
      userId: input.userId,
      asset: "CKB",
    }),
    db
      .select()
      .from(tipIntents)
      .where(
        and(
          eq(tipIntents.appId, input.appId),
          or(eq(tipIntents.fromUserId, input.userId), eq(tipIntents.toUserId, input.userId)),
        ),
      )
      .orderBy(desc(tipIntents.createdAt), desc(tipIntents.id))
      .limit(limit),
  ]);

  return {
    balance: String(balance),
    tips: recentTips.map((row) => ({
      id: row.id,
      invoice: row.invoice,
      postId: row.postId,
      amount: String(row.amount),
      asset: row.asset,
      state: row.invoiceState,
      direction: row.toUserId === input.userId ? ("IN" as const) : ("OUT" as const),
      counterpartyUserId: row.toUserId === input.userId ? row.fromUserId : row.toUserId,
      createdAt: row.createdAt.toISOString(),
    })),
    generatedAt: new Date().toISOString(),
  };
}
