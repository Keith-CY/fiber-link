import type { Asset, InvoiceState } from "@fiber-link/db";

const SETTLEMENT_CREDIT_PREFIX = "settlement:tip_intent:";

export type TipSettlementParityTipRow = {
  id: string;
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: Asset;
  amount: string;
  invoice: string;
  state: InvoiceState;
  settledAt: string | null;
};

export type TipSettlementParityCreditRow = {
  appId: string;
  userId: string;
  asset: Asset;
  amount: string;
  refId: string;
  idempotencyKey: string;
};

export type TipSettlementParityIssueKind =
  | "MALFORMED_CREDIT_IDEMPOTENCY_KEY"
  | "ORPHAN_CREDIT_ENTRY"
  | "SETTLED_TIP_MISSING_SETTLED_AT"
  | "SETTLED_TIP_MISSING_CREDIT"
  | "NON_SETTLED_TIP_HAS_CREDIT"
  | "DUPLICATE_CREDIT_ENTRIES"
  | "CREDIT_ACCOUNT_MISMATCH"
  | "CREDIT_AMOUNT_MISMATCH";

export type TipSettlementParityIssue = {
  kind: TipSettlementParityIssueKind;
  tipIntentId?: string;
  invoice?: string;
  idempotencyKey?: string;
  detail: string;
};

export type TipSettlementParityReport = {
  healthy: boolean;
  totals: {
    tipIntents: number;
    settledTipIntents: number;
    creditEntries: number;
    matchedCredits: number;
    issueCount: number;
  };
  issuesByKind: Record<TipSettlementParityIssueKind, number>;
  issues: TipSettlementParityIssue[];
};

const ISSUE_KINDS: TipSettlementParityIssueKind[] = [
  "MALFORMED_CREDIT_IDEMPOTENCY_KEY",
  "ORPHAN_CREDIT_ENTRY",
  "SETTLED_TIP_MISSING_SETTLED_AT",
  "SETTLED_TIP_MISSING_CREDIT",
  "NON_SETTLED_TIP_HAS_CREDIT",
  "DUPLICATE_CREDIT_ENTRIES",
  "CREDIT_ACCOUNT_MISMATCH",
  "CREDIT_AMOUNT_MISMATCH",
];

function createIssueCounter(): Record<TipSettlementParityIssueKind, number> {
  return Object.fromEntries(ISSUE_KINDS.map((kind) => [kind, 0])) as Record<TipSettlementParityIssueKind, number>;
}

export function parseTipIntentIdFromSettlementCreditIdempotencyKey(idempotencyKey: string): string | null {
  if (!idempotencyKey.startsWith(SETTLEMENT_CREDIT_PREFIX)) {
    return null;
  }
  const tipIntentId = idempotencyKey.slice(SETTLEMENT_CREDIT_PREFIX.length).trim();
  return tipIntentId ? tipIntentId : null;
}

export function buildTipSettlementParityReport(args: {
  tipIntents: TipSettlementParityTipRow[];
  credits: TipSettlementParityCreditRow[];
}): TipSettlementParityReport {
  const issues: TipSettlementParityIssue[] = [];
  const issuesByKind = createIssueCounter();
  const tipIntentsById = new Map(args.tipIntents.map((row) => [row.id, row]));
  const creditsByTipIntentId = new Map<string, TipSettlementParityCreditRow[]>();
  let matchedCredits = 0;

  const addIssue = (issue: TipSettlementParityIssue) => {
    issues.push(issue);
    issuesByKind[issue.kind] += 1;
  };

  for (const credit of args.credits) {
    const tipIntentId = parseTipIntentIdFromSettlementCreditIdempotencyKey(credit.idempotencyKey);
    if (!tipIntentId) {
      addIssue({
        kind: "MALFORMED_CREDIT_IDEMPOTENCY_KEY",
        idempotencyKey: credit.idempotencyKey,
        detail: "credit idempotency key does not follow settlement:tip_intent:<tip_intent_id>",
      });
      continue;
    }

    const linked = creditsByTipIntentId.get(tipIntentId) ?? [];
    linked.push(credit);
    creditsByTipIntentId.set(tipIntentId, linked);

    if (!tipIntentsById.has(tipIntentId)) {
      addIssue({
        kind: "ORPHAN_CREDIT_ENTRY",
        tipIntentId,
        idempotencyKey: credit.idempotencyKey,
        detail: "credit entry references tip intent id not present in report window",
      });
      continue;
    }

    matchedCredits += 1;
  }

  for (const tipIntent of args.tipIntents) {
    const linkedCredits = creditsByTipIntentId.get(tipIntent.id) ?? [];

    if (tipIntent.state === "SETTLED") {
      if (!tipIntent.settledAt) {
        addIssue({
          kind: "SETTLED_TIP_MISSING_SETTLED_AT",
          tipIntentId: tipIntent.id,
          invoice: tipIntent.invoice,
          detail: "settled tip intent is missing settledAt evidence",
        });
      }
      if (linkedCredits.length === 0) {
        addIssue({
          kind: "SETTLED_TIP_MISSING_CREDIT",
          tipIntentId: tipIntent.id,
          invoice: tipIntent.invoice,
          detail: "settled tip intent has no matching credit entry",
        });
      }
    } else if (linkedCredits.length > 0) {
      addIssue({
        kind: "NON_SETTLED_TIP_HAS_CREDIT",
        tipIntentId: tipIntent.id,
        invoice: tipIntent.invoice,
        detail: `tip intent state ${tipIntent.state} should not have credit entries`,
      });
    }

    if (linkedCredits.length > 1) {
      addIssue({
        kind: "DUPLICATE_CREDIT_ENTRIES",
        tipIntentId: tipIntent.id,
        invoice: tipIntent.invoice,
        detail: `found ${linkedCredits.length} credit entries for single tip intent`,
      });
    }

    for (const credit of linkedCredits) {
      if (
        credit.appId !== tipIntent.appId ||
        credit.userId !== tipIntent.toUserId ||
        credit.asset !== tipIntent.asset ||
        credit.refId !== tipIntent.id
      ) {
        addIssue({
          kind: "CREDIT_ACCOUNT_MISMATCH",
          tipIntentId: tipIntent.id,
          invoice: tipIntent.invoice,
          idempotencyKey: credit.idempotencyKey,
          detail: "credit app/user/asset/refId does not match settled tip account dimensions",
        });
      }

      const creditAmount = Number(credit.amount);
      const tipAmount = Number(tipIntent.amount);
      const amountsMatch = Number.isFinite(creditAmount) && Number.isFinite(tipAmount)
        ? creditAmount === tipAmount
        : credit.amount === tipIntent.amount;
      if (!amountsMatch) {
        addIssue({
          kind: "CREDIT_AMOUNT_MISMATCH",
          tipIntentId: tipIntent.id,
          invoice: tipIntent.invoice,
          idempotencyKey: credit.idempotencyKey,
          detail: `credit amount ${credit.amount} != settled tip amount ${tipIntent.amount}`,
        });
      }
    }
  }

  const settledTipIntents = args.tipIntents.filter((item) => item.state === "SETTLED").length;
  return {
    healthy: issues.length === 0,
    totals: {
      tipIntents: args.tipIntents.length,
      settledTipIntents,
      creditEntries: args.credits.length,
      matchedCredits,
      issueCount: issues.length,
    },
    issuesByKind,
    issues,
  };
}
