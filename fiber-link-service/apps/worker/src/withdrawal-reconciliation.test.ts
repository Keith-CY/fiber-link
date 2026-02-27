import { describe, expect, it } from "vitest";
import {
  buildWithdrawalParityReport,
  parseWithdrawalIdFromDebitIdempotencyKey,
} from "./withdrawal-reconciliation";

describe("withdrawal reconciliation report", () => {
  it("returns healthy report when parity is complete for completed withdrawals", () => {
    const report = buildWithdrawalParityReport({
      withdrawals: [
        {
          id: "wd-1",
          appId: "app-1",
          userId: "u-1",
          asset: "USDI",
          amount: "10",
          state: "COMPLETED",
          txHash: "0xabc",
        },
        {
          id: "wd-2",
          appId: "app-1",
          userId: "u-1",
          asset: "USDI",
          amount: "2",
          state: "PENDING",
          txHash: null,
        },
      ],
      debits: [
        {
          appId: "app-1",
          userId: "u-1",
          asset: "USDI",
          amount: "10",
          refId: "wd-1",
          idempotencyKey: "withdrawal:debit:wd-1",
        },
      ],
    });

    expect(report.healthy).toBe(true);
    expect(report.totals.issueCount).toBe(0);
    expect(report.issues).toHaveLength(0);
    expect(report.totals.matchedDebits).toBe(1);
  });

  it("flags completed withdrawals missing txHash and debit evidence", () => {
    const report = buildWithdrawalParityReport({
      withdrawals: [
        {
          id: "wd-missing",
          appId: "app-1",
          userId: "u-1",
          asset: "CKB",
          amount: "61",
          state: "COMPLETED",
          txHash: null,
        },
      ],
      debits: [],
    });

    expect(report.healthy).toBe(false);
    expect(report.issuesByKind.COMPLETED_WITHDRAWAL_MISSING_TX_HASH).toBe(1);
    expect(report.issuesByKind.COMPLETED_WITHDRAWAL_MISSING_DEBIT).toBe(1);
  });

  it("flags malformed, orphan, duplicate and mismatch debit anomalies", () => {
    const report = buildWithdrawalParityReport({
      withdrawals: [
        {
          id: "wd-pending",
          appId: "app-1",
          userId: "u-1",
          asset: "USDI",
          amount: "5",
          state: "PENDING",
          txHash: null,
        },
        {
          id: "wd-completed",
          appId: "app-1",
          userId: "u-1",
          asset: "USDI",
          amount: "3",
          state: "COMPLETED",
          txHash: "0xok",
        },
      ],
      debits: [
        {
          appId: "app-1",
          userId: "u-1",
          asset: "USDI",
          amount: "1",
          refId: "misc",
          idempotencyKey: "unexpected-key",
        },
        {
          appId: "app-1",
          userId: "u-9",
          asset: "USDI",
          amount: "7",
          refId: "wd-orphan",
          idempotencyKey: "withdrawal:debit:wd-orphan",
        },
        {
          appId: "app-1",
          userId: "u-1",
          asset: "USDI",
          amount: "5",
          refId: "wd-pending",
          idempotencyKey: "withdrawal:debit:wd-pending",
        },
        {
          appId: "app-1",
          userId: "u-1",
          asset: "USDI",
          amount: "4",
          refId: "wd-completed",
          idempotencyKey: "withdrawal:debit:wd-completed",
        },
        {
          appId: "app-2",
          userId: "u-2",
          asset: "CKB",
          amount: "3",
          refId: "wd-completed-drift",
          idempotencyKey: "withdrawal:debit:wd-completed",
        },
      ],
    });

    expect(report.healthy).toBe(false);
    expect(report.issuesByKind.MALFORMED_DEBIT_IDEMPOTENCY_KEY).toBe(1);
    expect(report.issuesByKind.ORPHAN_DEBIT_ENTRY).toBe(1);
    expect(report.issuesByKind.NON_COMPLETED_WITHDRAWAL_HAS_DEBIT).toBe(1);
    expect(report.issuesByKind.DUPLICATE_DEBIT_ENTRIES).toBe(1);
    expect(report.issuesByKind.DEBIT_ACCOUNT_MISMATCH).toBe(1);
    expect(report.issuesByKind.DEBIT_AMOUNT_MISMATCH).toBe(1);
  });

  it("parses withdrawal id from debit idempotency key", () => {
    expect(parseWithdrawalIdFromDebitIdempotencyKey("withdrawal:debit:wd-123")).toBe("wd-123");
    expect(parseWithdrawalIdFromDebitIdempotencyKey("withdrawal:debit:")).toBeNull();
    expect(parseWithdrawalIdFromDebitIdempotencyKey("credit:tip:1")).toBeNull();
  });
});
