import { and, desc, eq, gte, like, lte, sql } from "drizzle-orm";
import { createDbClient, ledgerEntries, withdrawals } from "@fiber-link/db";
import { buildWithdrawalParityReport } from "../withdrawal-reconciliation";

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

  const withdrawalPredicates = [sql`TRUE`];
  if (appId) {
    withdrawalPredicates.push(eq(withdrawals.appId, appId));
  }
  if (from) {
    withdrawalPredicates.push(gte(withdrawals.createdAt, from));
  }
  if (to) {
    withdrawalPredicates.push(lte(withdrawals.createdAt, to));
  }

  const debitPredicates = [sql`TRUE`, eq(ledgerEntries.type, "debit"), like(ledgerEntries.idempotencyKey, "withdrawal:debit:%")];
  if (appId) {
    debitPredicates.push(eq(ledgerEntries.appId, appId));
  }
  if (from) {
    debitPredicates.push(gte(ledgerEntries.createdAt, from));
  }
  if (to) {
    debitPredicates.push(lte(ledgerEntries.createdAt, to));
  }

  const [withdrawalRows, debitRows] = await Promise.all([
    db
      .select({
        id: withdrawals.id,
        appId: withdrawals.appId,
        userId: withdrawals.userId,
        asset: withdrawals.asset,
        amount: withdrawals.amount,
        state: withdrawals.state,
        txHash: withdrawals.txHash,
      })
      .from(withdrawals)
      .where(and(...withdrawalPredicates))
      .orderBy(desc(withdrawals.createdAt), desc(withdrawals.id))
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
      .where(and(...debitPredicates))
      .orderBy(desc(ledgerEntries.createdAt), desc(ledgerEntries.id))
      .limit(limit * 4),
  ]);

  const report = buildWithdrawalParityReport({
    withdrawals: withdrawalRows.map((row) => ({
      ...row,
      amount: String(row.amount),
    })),
    debits: debitRows.map((row) => ({
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
  console.error("reconcile-withdrawal-parity failed", error);
  process.exit(1);
});
