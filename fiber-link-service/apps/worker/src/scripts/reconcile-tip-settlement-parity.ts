import { and, desc, eq, gte, inArray, like, lte, ne, sql } from "drizzle-orm";
import { createDbClient, ledgerEntries, tipIntents } from "@fiber-link/db";
import {
  buildTipSettlementParityReport,
  parseTipIntentIdFromSettlementCreditIdempotencyKey,
  type TipSettlementParityCreditRow,
} from "../tip-settlement-reconciliation";

type ReconcileArgs = {
  appId?: string;
  from?: Date;
  to?: Date;
  limit: number;
};

type TipParityScriptRow = {
  id: string;
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: (typeof tipIntents.$inferSelect)["asset"];
  amount: string;
  invoice: string;
  state: (typeof tipIntents.$inferSelect)["invoiceState"];
  settledAt: string | null;
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

function mapTipRow(row: {
  id: string;
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: (typeof tipIntents.$inferSelect)["asset"];
  amount: unknown;
  invoice: string;
  state: (typeof tipIntents.$inferSelect)["invoiceState"];
  settledAt: Date | null;
}): TipParityScriptRow {
  return {
    ...row,
    amount: String(row.amount),
    settledAt: row.settledAt ? row.settledAt.toISOString() : null,
  };
}

function mapCreditRow(row: {
  appId: string;
  userId: string;
  asset: (typeof ledgerEntries.$inferSelect)["asset"];
  amount: unknown;
  refId: string;
  idempotencyKey: string;
}): TipSettlementParityCreditRow {
  return {
    ...row,
    amount: String(row.amount),
  };
}

export function collectReferencedTipIntentIds(credits: TipSettlementParityCreditRow[]): string[] {
  const ids = new Set<string>();
  for (const credit of credits) {
    const tipIntentId = parseTipIntentIdFromSettlementCreditIdempotencyKey(credit.idempotencyKey);
    if (tipIntentId) {
      ids.add(tipIntentId);
    }
  }
  return [...ids];
}

export function mergeTipRows(...groups: TipParityScriptRow[][]): TipParityScriptRow[] {
  const byId = new Map<string, TipParityScriptRow>();
  for (const rows of groups) {
    for (const row of rows) {
      if (!byId.has(row.id)) {
        byId.set(row.id, row);
      }
    }
  }
  return [...byId.values()];
}

async function main() {
  const { appId, from, to, limit } = parseArgs(process.argv.slice(2));
  const db = createDbClient();

  const settledTipPredicates = [sql`TRUE`, eq(tipIntents.invoiceState, "SETTLED")];
  if (appId) {
    settledTipPredicates.push(eq(tipIntents.appId, appId));
  }
  if (from) {
    settledTipPredicates.push(gte(tipIntents.settledAt, from));
  }
  if (to) {
    settledTipPredicates.push(lte(tipIntents.settledAt, to));
  }

  const unsettledTipPredicates = [sql`TRUE`, ne(tipIntents.invoiceState, "SETTLED")];
  if (appId) {
    unsettledTipPredicates.push(eq(tipIntents.appId, appId));
  }
  if (from) {
    unsettledTipPredicates.push(gte(tipIntents.createdAt, from));
  }
  if (to) {
    unsettledTipPredicates.push(lte(tipIntents.createdAt, to));
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

  const [settledTipRowsRaw, unsettledTipRowsRaw, creditRowsRaw] = await Promise.all([
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
      .where(and(...settledTipPredicates))
      .orderBy(desc(tipIntents.settledAt), desc(tipIntents.id))
      .limit(limit),
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
      .where(and(...unsettledTipPredicates))
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

  const settledTipRows = settledTipRowsRaw.map(mapTipRow);
  const unsettledTipRows = unsettledTipRowsRaw.map(mapTipRow);
  const creditRows = creditRowsRaw.map(mapCreditRow);

  const loadedTipIds = new Set([...settledTipRows, ...unsettledTipRows].map((row) => row.id));
  const referencedTipIntentIds = collectReferencedTipIntentIds(creditRows).filter((id) => !loadedTipIds.has(id));

  const referencedTipRows = referencedTipIntentIds.length === 0
    ? []
    : (await db
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
      .where(inArray(tipIntents.id, referencedTipIntentIds))
    ).map(mapTipRow);

  const report = buildTipSettlementParityReport({
    tipIntents: mergeTipRows(settledTipRows, unsettledTipRows, referencedTipRows),
    credits: creditRows,
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

if (import.meta.main) {
  void main().catch((error) => {
    console.error("reconcile-tip-settlement-parity failed", error);
    process.exit(1);
  });
}
