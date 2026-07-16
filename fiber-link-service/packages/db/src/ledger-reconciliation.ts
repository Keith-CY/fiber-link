import { formatDecimal, parseDecimal, pow10 } from "./amount";
import type { LedgerEntryType } from "./ledger-repo";

/**
 * Pure ledger reconciliation over pre-fetched rows, mirroring the style of the
 * worker's withdrawal-parity checker: callers (admin services, scripts, tests)
 * fetch the rows however they like and this module only classifies anomalies.
 *
 * Reference model (see idempotency.ts and the write sites):
 * - a settled tip intent produces exactly one ledger credit with
 *   `refId = tipIntent.id`;
 * - a broadcasted/completed withdrawal produces exactly one ledger debit with
 *   `refId = withdrawal.id`.
 */

export type LedgerReconciliationTipIntent = {
  id: string;
  appId: string;
  toUserId: string;
  asset: string;
  amount: string;
  invoiceState: string;
};

export type LedgerReconciliationWithdrawal = {
  id: string;
  appId: string;
  userId: string;
  asset: string;
  amount: string;
  state: string;
};

export type LedgerReconciliationEntry = {
  id: string;
  appId: string;
  userId: string;
  asset: string;
  amount: string;
  type: LedgerEntryType;
  refId: string;
};

export const LEDGER_ANOMALY_KINDS = [
  "SETTLED_TIP_MISSING_CREDIT",
  "CREDIT_WITHOUT_SETTLED_TIP",
  "COMPLETED_WITHDRAWAL_MISSING_DEBIT",
  "DEBIT_WITHOUT_COMPLETED_WITHDRAWAL",
  "NEGATIVE_BALANCE_ACCOUNT",
  "DUPLICATE_REFERENCE_ENTRIES",
] as const;

export type LedgerAnomalyKind = (typeof LEDGER_ANOMALY_KINDS)[number];

export type LedgerAnomaly = {
  kind: LedgerAnomalyKind;
  detail: string;
  /** Tip intent id or withdrawal id the anomaly refers to, when applicable. */
  refId?: string;
  /** Example ledger entry ids so operators can jump straight to the rows. */
  entryIds?: string[];
  account?: { appId: string; userId: string; asset: string };
};

export type LedgerReconciliationReport = {
  anomalies: LedgerAnomaly[];
  countsByKind: Record<LedgerAnomalyKind, number>;
  checked: {
    tipIntents: number;
    withdrawals: number;
    entries: number;
    accounts: number;
  };
};

/** Debits are written on the PROCESSING -> BROADCASTED transition and remain valid through COMPLETED. */
const DEBIT_BEARING_WITHDRAWAL_STATES = new Set(["BROADCASTED", "COMPLETED"]);

function signedSum(entries: LedgerReconciliationEntry[]): { value: bigint; scale: number } {
  const parsed = entries.map((entry) => {
    const decimal = parseDecimal(entry.amount);
    const sign = entry.type === "debit" ? -1n : 1n;
    return { value: decimal.value * sign, scale: decimal.scale };
  });
  const maxScale = parsed.reduce((max, item) => Math.max(max, item.scale), 0);
  const value = parsed.reduce((acc, item) => acc + item.value * pow10(maxScale - item.scale), 0n);
  return { value, scale: maxScale };
}

export function reconcileLedger(input: {
  tipIntents: LedgerReconciliationTipIntent[];
  withdrawals: LedgerReconciliationWithdrawal[];
  entries: LedgerReconciliationEntry[];
}): LedgerReconciliationReport {
  const anomalies: LedgerAnomaly[] = [];

  const creditsByRef = new Map<string, LedgerReconciliationEntry[]>();
  const debitsByRef = new Map<string, LedgerReconciliationEntry[]>();
  for (const entry of input.entries) {
    const byRef = entry.type === "credit" ? creditsByRef : debitsByRef;
    const linked = byRef.get(entry.refId) ?? [];
    linked.push(entry);
    byRef.set(entry.refId, linked);
  }

  const tipById = new Map(input.tipIntents.map((tip) => [tip.id, tip]));
  const withdrawalById = new Map(input.withdrawals.map((withdrawal) => [withdrawal.id, withdrawal]));

  for (const tip of input.tipIntents) {
    if (tip.invoiceState !== "SETTLED") {
      continue;
    }
    if ((creditsByRef.get(tip.id) ?? []).length === 0) {
      anomalies.push({
        kind: "SETTLED_TIP_MISSING_CREDIT",
        refId: tip.id,
        detail: `settled tip intent ${tip.id} has no ledger credit`,
      });
    }
  }

  for (const [refId, credits] of creditsByRef) {
    const entryIds = credits.map((entry) => entry.id);
    const tip = tipById.get(refId);
    if (!tip) {
      anomalies.push({
        kind: "CREDIT_WITHOUT_SETTLED_TIP",
        refId,
        entryIds,
        detail: `ledger credit references unknown tip intent ${refId}`,
      });
    } else if (tip.invoiceState !== "SETTLED") {
      anomalies.push({
        kind: "CREDIT_WITHOUT_SETTLED_TIP",
        refId,
        entryIds,
        detail: `ledger credit exists but tip intent ${refId} is ${tip.invoiceState}`,
      });
    }
    if (credits.length > 1) {
      anomalies.push({
        kind: "DUPLICATE_REFERENCE_ENTRIES",
        refId,
        entryIds,
        detail: `${credits.length} credit entries share ref ${refId}`,
      });
    }
  }

  for (const withdrawal of input.withdrawals) {
    if (!DEBIT_BEARING_WITHDRAWAL_STATES.has(withdrawal.state)) {
      continue;
    }
    if ((debitsByRef.get(withdrawal.id) ?? []).length === 0) {
      anomalies.push({
        kind: "COMPLETED_WITHDRAWAL_MISSING_DEBIT",
        refId: withdrawal.id,
        detail: `${withdrawal.state} withdrawal ${withdrawal.id} has no ledger debit`,
      });
    }
  }

  for (const [refId, debits] of debitsByRef) {
    const entryIds = debits.map((entry) => entry.id);
    const withdrawal = withdrawalById.get(refId);
    if (!withdrawal) {
      anomalies.push({
        kind: "DEBIT_WITHOUT_COMPLETED_WITHDRAWAL",
        refId,
        entryIds,
        detail: `ledger debit references unknown withdrawal ${refId}`,
      });
    } else if (!DEBIT_BEARING_WITHDRAWAL_STATES.has(withdrawal.state)) {
      anomalies.push({
        kind: "DEBIT_WITHOUT_COMPLETED_WITHDRAWAL",
        refId,
        entryIds,
        detail: `ledger debit exists but withdrawal ${refId} is ${withdrawal.state}`,
      });
    }
    if (debits.length > 1) {
      anomalies.push({
        kind: "DUPLICATE_REFERENCE_ENTRIES",
        refId,
        entryIds,
        detail: `${debits.length} debit entries share ref ${refId}`,
      });
    }
  }

  const byAccount = new Map<string, LedgerReconciliationEntry[]>();
  for (const entry of input.entries) {
    const key = JSON.stringify([entry.appId, entry.userId, entry.asset]);
    const linked = byAccount.get(key) ?? [];
    linked.push(entry);
    byAccount.set(key, linked);
  }
  for (const entries of byAccount.values()) {
    const { appId, userId, asset } = entries[0];
    const sum = signedSum(entries);
    if (sum.value < 0n) {
      anomalies.push({
        kind: "NEGATIVE_BALANCE_ACCOUNT",
        account: { appId, userId, asset },
        entryIds: entries.slice(0, 5).map((entry) => entry.id),
        detail: `account ${appId}/${userId}/${asset} has negative balance ${formatDecimal(sum.value, sum.scale)}`,
      });
    }
  }

  const countsByKind = Object.fromEntries(LEDGER_ANOMALY_KINDS.map((kind) => [kind, 0])) as Record<
    LedgerAnomalyKind,
    number
  >;
  for (const anomaly of anomalies) {
    countsByKind[anomaly.kind] += 1;
  }

  return {
    anomalies,
    countsByKind,
    checked: {
      tipIntents: input.tipIntents.length,
      withdrawals: input.withdrawals.length,
      entries: input.entries.length,
      accounts: byAccount.size,
    },
  };
}
