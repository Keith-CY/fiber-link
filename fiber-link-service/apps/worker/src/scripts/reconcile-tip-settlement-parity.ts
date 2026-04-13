import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import { createDbClient, ledgerEntries, tipIntents } from "@fiber-link/db";
import { buildTipSettlementParityReport } from "../tip-settlement-reconciliation";

type ReconcileArgs = {
  appId?: string;
  from?: Date;
  to?: Date;
  limit: number;
};

function parseDateFlag(value: string, key: string): Date {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${key}: ${value}`);
  }
  return date;
}

function parseArgs(argv: string[]): ReconcileArgs {
  const args: ReconcileArgs = { limit: 500 };

  for (const token of argv) {
    if (token.startsWith("--app-id=")) {
      args.appId = token.slice("--app-id=".length);
      continue;
    }
    if (token.startsWith("--from=")) {
      args.from = parseDateFlag(token.slice("--from=".length), "--from");
      continue;
    }
    if (token.startsWith("--to=")) {
      args.to = parseDateFlag(token.slice("--to=".length), "--to");
      continue;
    }
    if (token.startsWith("--limit=")) {
      const value = Number(token.slice("--limit=".length));
      if (!Number.isInteger(value) || value <= 0) {
        throw new Error(`Invalid --limit: ${token.slice("--limit=".length)}`);
      }
      args.limit = value;
      continue;
    }

    throw new Error(`Unknown argument: ${token}`);
  }

  if (args.from && args.to && args.from > args.to) {
    throw new Error("--from must be <= --to");
  }

  return args;
}

async function main() {
  const { appId, from, to, limit } = parseArgs(process.argv.slice(2));
  const db = createDbClient();

  const tipPredicates = [sql`TRUE`];
  if (appId) {
    tipPredicates.push(eq(tipIntents.appId, appId));
  }
  if (from) {
    tipPredicates.push(gte(tipIntents.createdAt, from));
  }
  if (to) {
    tipPredicates.push(lte(tipIntents.createdAt, to));
  }

  const creditPredicates = [sql`TRUE`, eq(ledgerEntries.type, "credit"), like(ledgerEntries.idempotencyKey, "settlement:tip_intent:%")];
  if (appId) {
    creditPredicates.push(eq(ledgerEntries.appId, appId));
  }
  if (from) {
    creditPredicates.push(gte(ledgerEntries.createdAt, from));
  }
  if (to) {
    creditPredicates.push(lte(ledgerEntries.createdAt, to));
  }

  const [tipRows, creditRows] = await Promise.all([
    db
      .select({
        id: tipIntents.id,
        appId: tipIntents.appId,
        postId: tipIntents.postId,
        fromUserId: tipIntents.fromUserId,
        toUserId: tipIntents.toUserId,
        asset: tipIntents.asset,
        amount: tipIntents.amount,
        invoice: tipIntents.invoice,
        state: tipIntents.invoiceState,
        settledAt: tipIntents.settledAt,
      })
      .from(tipIntents)
      .where(and(...tipPredicates))
      .orderBy(desc(tipIntents.createdAt), desc(tipIntents.id))
      .limit(limit),
    db
      .select({
        appId: ledgerEntries.appId,
        userId: ledgerEntries.userId,
        asset: ledgerEntries.asset,
        amount: ledgerEntries.amount,
        refId: ledgerEntries.refId,
        idempotencyKey: ledgerEntries.idempotencyKey,
      })
      .from(ledgerEntries)
      .where(and(...creditPredicates))
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(limit * 4),
  ]);

  const report = buildTipSettlementParityReport({
    tipIntents: tipRows.map((row) => ({
      ...row,
      amount: String(row.amount),
      settledAt: row.settledAt ? row.settledAt.toISOString() : null,
    })),
    credits: creditRows.map((row) => ({
      ...row,
      amount: String(row.amount),
    })),
  });

  console.log(
    JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        scope: {
          appId: appId ?? null,
          from: from?.toISOString() ?? null,
          to: to?.toISOString() ?? null,
          limit,
        },
        report,
      },
      null,
      2,
    ),
  );

  if (!report.healthy) {
    process.exitCode = 2;
  }
}

void main().catch((error) => {
  console.error("reconcile-tip-settlement-parity failed", error);
  process.exit(1);
});
