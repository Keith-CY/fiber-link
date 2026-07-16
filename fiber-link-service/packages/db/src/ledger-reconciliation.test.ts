import { describe, expect, it } from "vitest";
import {
  type LedgerReconciliationEntry,
  type LedgerReconciliationTipIntent,
  type LedgerReconciliationWithdrawal,
  reconcileLedger,
} from "./ledger-reconciliation";

function tip(overrides: Partial<LedgerReconciliationTipIntent> = {}): LedgerReconciliationTipIntent {
  return {
    id: "tip-1",
    appId: "app-1",
    toUserId: "author-1",
    asset: "CKB",
    amount: "100",
    invoiceState: "SETTLED",
    ...overrides,
  };
}

function withdrawal(overrides: Partial<LedgerReconciliationWithdrawal> = {}): LedgerReconciliationWithdrawal {
  return {
    id: "w-1",
    appId: "app-1",
    userId: "author-1",
    asset: "CKB",
    amount: "40",
    state: "COMPLETED",
    ...overrides,
  };
}

function entry(overrides: Partial<LedgerReconciliationEntry> = {}): LedgerReconciliationEntry {
  return {
    id: "e-1",
    appId: "app-1",
    userId: "author-1",
    asset: "CKB",
    amount: "100",
    type: "credit",
    refId: "tip-1",
    ...overrides,
  };
}

describe("reconcileLedger", () => {
  it("reports a clean ledger with zero anomalies", () => {
    const report = reconcileLedger({
      tipIntents: [tip()],
      withdrawals: [withdrawal()],
      entries: [entry(), entry({ id: "e-2", type: "debit", refId: "w-1", amount: "40" })],
    });

    expect(report.anomalies).toEqual([]);
    expect(Object.values(report.countsByKind).every((count) => count === 0)).toBe(true);
    expect(report.checked).toEqual({ tipIntents: 1, withdrawals: 1, entries: 2, accounts: 1 });
  });

  it("flags a settled tip without a credit", () => {
    const report = reconcileLedger({ tipIntents: [tip()], withdrawals: [], entries: [] });
    expect(report.countsByKind.SETTLED_TIP_MISSING_CREDIT).toBe(1);
    expect(report.anomalies[0]).toMatchObject({ kind: "SETTLED_TIP_MISSING_CREDIT", refId: "tip-1" });
  });

  it("does not require credits for UNPAID or FAILED tips", () => {
    const report = reconcileLedger({
      tipIntents: [tip({ invoiceState: "UNPAID" }), tip({ id: "tip-2", invoiceState: "FAILED" })],
      withdrawals: [],
      entries: [],
    });
    expect(report.anomalies).toEqual([]);
  });

  it("flags a credit whose tip intent is unknown or not settled", () => {
    const report = reconcileLedger({
      tipIntents: [tip({ id: "tip-unpaid", invoiceState: "UNPAID" })],
      withdrawals: [],
      entries: [entry({ id: "e-orphan", refId: "tip-missing" }), entry({ id: "e-early", refId: "tip-unpaid" })],
    });
    expect(report.countsByKind.CREDIT_WITHOUT_SETTLED_TIP).toBe(2);
    const details = report.anomalies.map((anomaly) => anomaly.detail);
    expect(details.some((detail) => detail.includes("unknown tip intent tip-missing"))).toBe(true);
    expect(details.some((detail) => detail.includes("is UNPAID"))).toBe(true);
    expect(report.anomalies[0].entryIds).toEqual(["e-orphan"]);
  });

  it("flags a completed or broadcasted withdrawal without a debit", () => {
    const report = reconcileLedger({
      tipIntents: [],
      withdrawals: [
        withdrawal(),
        withdrawal({ id: "w-2", state: "BROADCASTED" }),
        withdrawal({ id: "w-3", state: "PENDING" }),
      ],
      entries: [],
    });
    expect(report.countsByKind.COMPLETED_WITHDRAWAL_MISSING_DEBIT).toBe(2);
  });

  it("flags a debit without a completed/broadcasted withdrawal", () => {
    const report = reconcileLedger({
      tipIntents: [],
      withdrawals: [withdrawal({ id: "w-pending", state: "PENDING" })],
      entries: [
        entry({ id: "e-orphan", type: "debit", refId: "w-missing", amount: "5" }),
        entry({ id: "e-early", type: "debit", refId: "w-pending", amount: "5" }),
      ],
    });
    expect(report.countsByKind.DEBIT_WITHOUT_COMPLETED_WITHDRAWAL).toBe(2);
  });

  it("flags a negative balance account", () => {
    const report = reconcileLedger({
      tipIntents: [tip()],
      withdrawals: [withdrawal({ amount: "150" })],
      entries: [entry(), entry({ id: "e-2", type: "debit", refId: "w-1", amount: "150" })],
    });
    expect(report.countsByKind.NEGATIVE_BALANCE_ACCOUNT).toBe(1);
    const anomaly = report.anomalies.find((item) => item.kind === "NEGATIVE_BALANCE_ACCOUNT");
    expect(anomaly?.account).toEqual({ appId: "app-1", userId: "author-1", asset: "CKB" });
    expect(anomaly?.detail).toContain("-50");
  });

  it("flags duplicate entries sharing one reference", () => {
    const report = reconcileLedger({
      tipIntents: [tip()],
      withdrawals: [withdrawal()],
      entries: [
        entry(),
        entry({ id: "e-dup" }),
        entry({ id: "e-3", type: "debit", refId: "w-1", amount: "10" }),
        entry({ id: "e-4", type: "debit", refId: "w-1", amount: "10" }),
      ],
    });
    expect(report.countsByKind.DUPLICATE_REFERENCE_ENTRIES).toBe(2);
    const duplicate = report.anomalies.find(
      (item) => item.kind === "DUPLICATE_REFERENCE_ENTRIES" && item.refId === "tip-1",
    );
    expect(duplicate?.entryIds).toEqual(["e-1", "e-dup"]);
  });

  it("keeps accounts with different assets separate for balance checks", () => {
    const report = reconcileLedger({
      tipIntents: [tip(), tip({ id: "tip-2", asset: "USDI", amount: "5" })],
      withdrawals: [],
      entries: [entry(), entry({ id: "e-2", refId: "tip-2", asset: "USDI", amount: "5" })],
    });
    expect(report.checked.accounts).toBe(2);
    expect(report.anomalies).toEqual([]);
  });
});
