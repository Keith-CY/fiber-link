import type { Asset, WithdrawalState } from "@fiber-link/db";

const WITHDRAWAL_DEBIT_PREFIX = "withdrawal:debit:";

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

export type WithdrawalParityIssueKind =
  | "MALFORMED_DEBIT_IDEMPOTENCY_KEY"
  | "ORPHAN_DEBIT_ENTRY"
  | "COMPLETED_WITHDRAWAL_MISSING_TX_HASH"
  | "COMPLETED_WITHDRAWAL_MISSING_DEBIT"
  | "NON_COMPLETED_WITHDRAWAL_HAS_DEBIT"
  | "DUPLICATE_DEBIT_ENTRIES"
  | "DEBIT_ACCOUNT_MISMATCH"
  | "DEBIT_AMOUNT_MISMATCH";

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

export function buildWithdrawalParityReport(args: {
  withdrawals: WithdrawalParityWithdrawalRow[];
  debits: WithdrawalParityDebitRow[];
}): WithdrawalParityReport {
  const issues: WithdrawalParityIssue[] = [];
  const issuesByKind = createIssueCounter();
  const withdrawalsById = new Map(args.withdrawals.map((row) => [row.id, row]));
  const debitsByWithdrawalId = new Map<string, WithdrawalParityDebitRow[]>();
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

  for (const withdrawal of args.withdrawals) {
    const linkedDebits = debitsByWithdrawalId.get(withdrawal.id) ?? [];

    if (withdrawal.state === "COMPLETED") {
      if (!withdrawal.txHash) {
        addIssue({
          kind: "COMPLETED_WITHDRAWAL_MISSING_TX_HASH",
          withdrawalId: withdrawal.id,
          detail: "completed withdrawal is missing txHash evidence",
        });
      }
      if (linkedDebits.length === 0) {
        addIssue({
          kind: "COMPLETED_WITHDRAWAL_MISSING_DEBIT",
          withdrawalId: withdrawal.id,
          detail: "completed withdrawal has no matching debit entry",
        });
      }
    } else if (linkedDebits.length > 0) {
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
