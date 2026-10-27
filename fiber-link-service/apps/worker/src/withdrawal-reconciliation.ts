import type { Asset, WithdrawalState } from "@fiber-link/db";

const WITHDRAWAL_DEBIT_PREFIX = "withdrawal:debit:";
const WITHDRAWAL_REVERSAL_PREFIX = "withdrawal:reversal:";

export type WithdrawalParityWithdrawalRow = {
  id: string;
  appId: string;
  userId: string;
  asset: Asset;
  amount: string;
  state: WithdrawalState;
  txHash: string | null;
};

export type WithdrawalParityDebitRow = {
  appId: string;
  userId: string;
  asset: Asset;
  amount: string;
  refId: string;
  idempotencyKey: string;
};

/** Credit refunding the broadcast debit of a withdrawal the chain rejected. */
export type WithdrawalParityReversalRow = WithdrawalParityDebitRow;

export type WithdrawalParityIssueKind =
  | "MALFORMED_DEBIT_IDEMPOTENCY_KEY"
  | "ORPHAN_DEBIT_ENTRY"
  | "COMPLETED_WITHDRAWAL_MISSING_TX_HASH"
  | "COMPLETED_WITHDRAWAL_MISSING_DEBIT"
  | "NON_COMPLETED_WITHDRAWAL_HAS_DEBIT"
  | "DUPLICATE_DEBIT_ENTRIES"
  | "DEBIT_ACCOUNT_MISMATCH"
  | "DEBIT_AMOUNT_MISMATCH"
  | "ORPHAN_REVERSAL_ENTRY"
  | "INVALID_WITHDRAWAL_REVERSAL";

export type WithdrawalParityIssue = {
  kind: WithdrawalParityIssueKind;
  withdrawalId?: string;
  idempotencyKey?: string;
  detail: string;
};

export type WithdrawalParityReport = {
  healthy: boolean;
  totals: {
    withdrawals: number;
    completedWithdrawals: number;
    debitEntries: number;
    matchedDebits: number;
    issueCount: number;
  };
  issuesByKind: Record<WithdrawalParityIssueKind, number>;
  issues: WithdrawalParityIssue[];
};

const ISSUE_KINDS: WithdrawalParityIssueKind[] = [
  "MALFORMED_DEBIT_IDEMPOTENCY_KEY",
  "ORPHAN_DEBIT_ENTRY",
  "COMPLETED_WITHDRAWAL_MISSING_TX_HASH",
  "COMPLETED_WITHDRAWAL_MISSING_DEBIT",
  "NON_COMPLETED_WITHDRAWAL_HAS_DEBIT",
  "DUPLICATE_DEBIT_ENTRIES",
  "DEBIT_ACCOUNT_MISMATCH",
  "DEBIT_AMOUNT_MISMATCH",
  "ORPHAN_REVERSAL_ENTRY",
  "INVALID_WITHDRAWAL_REVERSAL",
];

function createIssueCounter(): Record<WithdrawalParityIssueKind, number> {
  return Object.fromEntries(ISSUE_KINDS.map((kind) => [kind, 0])) as Record<WithdrawalParityIssueKind, number>;
}

export function parseWithdrawalIdFromDebitIdempotencyKey(idempotencyKey: string): string | null {
  if (!idempotencyKey.startsWith(WITHDRAWAL_DEBIT_PREFIX)) {
    return null;
  }
  const withdrawalId = idempotencyKey.slice(WITHDRAWAL_DEBIT_PREFIX.length).trim();
  return withdrawalId ? withdrawalId : null;
}

export function parseWithdrawalIdFromReversalIdempotencyKey(idempotencyKey: string): string | null {
  if (!idempotencyKey.startsWith(WITHDRAWAL_REVERSAL_PREFIX)) {
    return null;
  }
  const withdrawalId = idempotencyKey.slice(WITHDRAWAL_REVERSAL_PREFIX.length).trim();
  return withdrawalId ? withdrawalId : null;
}

export function buildWithdrawalParityReport(args: {
  withdrawals: WithdrawalParityWithdrawalRow[];
  debits: WithdrawalParityDebitRow[];
  reversals?: WithdrawalParityReversalRow[];
}): WithdrawalParityReport {
  const issues: WithdrawalParityIssue[] = [];
  const issuesByKind = createIssueCounter();
  const withdrawalsById = new Map(args.withdrawals.map((row) => [row.id, row]));
  const debitsByWithdrawalId = new Map<string, WithdrawalParityDebitRow[]>();
  const reversalsByWithdrawalId = new Map<string, WithdrawalParityReversalRow[]>();
  let matchedDebits = 0;

  const addIssue = (issue: WithdrawalParityIssue) => {
    issues.push(issue);
    issuesByKind[issue.kind] += 1;
  };

  for (const debit of args.debits) {
    const withdrawalId = parseWithdrawalIdFromDebitIdempotencyKey(debit.idempotencyKey);
    if (!withdrawalId) {
      addIssue({
        kind: "MALFORMED_DEBIT_IDEMPOTENCY_KEY",
        idempotencyKey: debit.idempotencyKey,
        detail: "debit idempotency key does not follow withdrawal:debit:<withdrawal_id>",
      });
      continue;
    }

    const linked = debitsByWithdrawalId.get(withdrawalId) ?? [];
    linked.push(debit);
    debitsByWithdrawalId.set(withdrawalId, linked);

    if (!withdrawalsById.has(withdrawalId)) {
      addIssue({
        kind: "ORPHAN_DEBIT_ENTRY",
        withdrawalId,
        idempotencyKey: debit.idempotencyKey,
        detail: "debit entry references withdrawal id not present in report window",
      });
      continue;
    }

    matchedDebits += 1;
  }

  for (const reversal of args.reversals ?? []) {
    const withdrawalId = parseWithdrawalIdFromReversalIdempotencyKey(reversal.idempotencyKey);
    if (!withdrawalId) {
      addIssue({
        kind: "INVALID_WITHDRAWAL_REVERSAL",
        idempotencyKey: reversal.idempotencyKey,
        detail: "reversal idempotency key does not follow withdrawal:reversal:<withdrawal_id>",
      });
      continue;
    }
    if (!withdrawalsById.has(withdrawalId)) {
      addIssue({
        kind: "ORPHAN_REVERSAL_ENTRY",
        withdrawalId,
        idempotencyKey: reversal.idempotencyKey,
        detail: "reversal entry references withdrawal id not present in report window",
      });
      continue;
    }
    const linked = reversalsByWithdrawalId.get(withdrawalId) ?? [];
    linked.push(reversal);
    reversalsByWithdrawalId.set(withdrawalId, linked);
  }

  for (const withdrawal of args.withdrawals) {
    const linkedDebits = debitsByWithdrawalId.get(withdrawal.id) ?? [];
    const linkedReversals = reversalsByWithdrawalId.get(withdrawal.id) ?? [];

    if (withdrawal.state === "COMPLETED" || withdrawal.state === "BROADCASTED") {
      if (!withdrawal.txHash) {
        addIssue({
          kind: "COMPLETED_WITHDRAWAL_MISSING_TX_HASH",
          withdrawalId: withdrawal.id,
          detail: `${withdrawal.state.toLowerCase()} withdrawal is missing txHash evidence`,
        });
      }
      if (linkedDebits.length === 0) {
        addIssue({
          kind: "COMPLETED_WITHDRAWAL_MISSING_DEBIT",
          withdrawalId: withdrawal.id,
          detail: `${withdrawal.state.toLowerCase()} withdrawal has no matching debit entry`,
        });
      }
    } else if (linkedDebits.length > 0 && !(withdrawal.state === "FAILED" && linkedReversals.length > 0)) {
      // A FAILED withdrawal whose broadcast debit was reversed is consistent.
      addIssue({
        kind: "NON_COMPLETED_WITHDRAWAL_HAS_DEBIT",
        withdrawalId: withdrawal.id,
        detail: `withdrawal state ${withdrawal.state} should not have debit entries`,
      });
    }

    if (linkedDebits.length > 1) {
      addIssue({
        kind: "DUPLICATE_DEBIT_ENTRIES",
        withdrawalId: withdrawal.id,
        detail: `found ${linkedDebits.length} debit entries for single withdrawal`,
      });
    }

    for (const debit of linkedDebits) {
      if (
        debit.appId !== withdrawal.appId ||
        debit.userId !== withdrawal.userId ||
        debit.asset !== withdrawal.asset ||
        debit.refId !== withdrawal.id
      ) {
        addIssue({
          kind: "DEBIT_ACCOUNT_MISMATCH",
          withdrawalId: withdrawal.id,
          idempotencyKey: debit.idempotencyKey,
          detail: "debit app/user/asset/refId does not match withdrawal account dimensions",
        });
      }

      if (debit.amount !== withdrawal.amount) {
        addIssue({
          kind: "DEBIT_AMOUNT_MISMATCH",
          withdrawalId: withdrawal.id,
          idempotencyKey: debit.idempotencyKey,
          detail: `debit amount ${debit.amount} != withdrawal amount ${withdrawal.amount}`,
        });
      }
    }

    for (const reversal of linkedReversals) {
      let problem: string | null = null;
      if (withdrawal.state !== "FAILED") {
        problem = `withdrawal state ${withdrawal.state} should not have a reversal`;
      } else if (linkedDebits.length === 0) {
        problem = "reversal has no matching debit to reverse";
      } else if (
        reversal.appId !== withdrawal.appId ||
        reversal.userId !== withdrawal.userId ||
        reversal.asset !== withdrawal.asset ||
        reversal.refId !== withdrawal.id
      ) {
        problem = "reversal app/user/asset/refId does not match withdrawal account dimensions";
      } else if (reversal.amount !== withdrawal.amount) {
        problem = `reversal amount ${reversal.amount} != withdrawal amount ${withdrawal.amount}`;
      }
      if (problem) {
        addIssue({
          kind: "INVALID_WITHDRAWAL_REVERSAL",
          withdrawalId: withdrawal.id,
          idempotencyKey: reversal.idempotencyKey,
          detail: problem,
        });
      }
    }
  }

  const completedWithdrawals = args.withdrawals.filter((item) => item.state === "COMPLETED").length;
  return {
    healthy: issues.length === 0,
    totals: {
      withdrawals: args.withdrawals.length,
      completedWithdrawals,
      debitEntries: args.debits.length,
      matchedDebits,
      issueCount: issues.length,
    },
    issuesByKind,
    issues,
  };
}
