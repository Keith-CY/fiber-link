import { describe, expect, it } from "vitest";
import {
  buildTipSettlementParityReport,
  parseTipIntentIdFromSettlementCreditIdempotencyKey,
} from "./tip-settlement-reconciliation";

describe("tip settlement reconciliation report", () => {
  it("returns healthy report when settled tips have matching credit evidence", () => {
    const report = buildTipSettlementParityReport({
      tipIntents: [
        {
          id: "tip-1",
          appId: "app-1",
          postId: "post-1",
          fromUserId: "u-from",
          toUserId: "u-to",
          asset: "USDI",
          amount: "10",
          invoice: "inv-1",
          state: "SETTLED",
          settledAt: "2026-04-13T00:00:00.000Z",
        },
        {
          id: "tip-2",
          appId: "app-1",
          postId: "post-2",
          fromUserId: "u-from",
          toUserId: "u-to",
          asset: "USDI",
          amount: "2",
          invoice: "inv-2",
          state: "UNPAID",
          settledAt: null,
        },
      ],
      credits: [
        {
          appId: "app-1",
          userId: "u-to",
          asset: "USDI",
          amount: "10",
          refId: "tip-1",
          idempotencyKey: "settlement:tip_intent:tip-1",
        },
      ],
    });

    expect(report.healthy).toBe(true);
    expect(report.totals.issueCount).toBe(0);
    expect(report.issues).toHaveLength(0);
    expect(report.totals.matchedCredits).toBe(1);
  });

  it("flags settled tips missing settledAt and credit evidence", () => {
    const report = buildTipSettlementParityReport({
      tipIntents: [
        {
          id: "tip-missing",
          appId: "app-1",
          postId: "post-1",
          fromUserId: "u-from",
          toUserId: "u-to",
          asset: "CKB",
          amount: "61",
          invoice: "inv-missing",
          state: "SETTLED",
          settledAt: null,
        },
      ],
      credits: [],
    });

    expect(report.healthy).toBe(false);
    expect(report.issuesByKind.SETTLED_TIP_MISSING_SETTLED_AT).toBe(1);
    expect(report.issuesByKind.SETTLED_TIP_MISSING_CREDIT).toBe(1);
  });

  it("flags malformed, orphan, duplicate and mismatch credit anomalies", () => {
    const report = buildTipSettlementParityReport({
      tipIntents: [
        {
          id: "tip-unpaid",
          appId: "app-1",
          postId: "post-1",
          fromUserId: "u-from",
          toUserId: "u-to",
          asset: "USDI",
          amount: "5",
          invoice: "inv-unpaid",
          state: "UNPAID",
          settledAt: null,
        },
        {
          id: "tip-settled",
          appId: "app-1",
          postId: "post-2",
          fromUserId: "u-from",
          toUserId: "u-to",
          asset: "USDI",
          amount: "3",
          invoice: "inv-settled",
          state: "SETTLED",
          settledAt: "2026-04-13T00:00:00.000Z",
        },
      ],
      credits: [
        {
          appId: "app-1",
          userId: "u-to",
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
          refId: "tip-orphan",
          idempotencyKey: "settlement:tip_intent:tip-orphan",
        },
        {
          appId: "app-1",
          userId: "u-to",
          asset: "USDI",
          amount: "5",
          refId: "tip-unpaid",
          idempotencyKey: "settlement:tip_intent:tip-unpaid",
        },
        {
          appId: "app-1",
          userId: "u-to",
          asset: "USDI",
          amount: "4",
          refId: "tip-settled",
          idempotencyKey: "settlement:tip_intent:tip-settled",
        },
        {
          appId: "app-2",
          userId: "u-drift",
          asset: "CKB",
          amount: "3",
          refId: "tip-settled-drift",
          idempotencyKey: "settlement:tip_intent:tip-settled",
        },
      ],
    });

    expect(report.healthy).toBe(false);
    expect(report.issuesByKind.MALFORMED_CREDIT_IDEMPOTENCY_KEY).toBe(1);
    expect(report.issuesByKind.ORPHAN_CREDIT_ENTRY).toBe(1);
    expect(report.issuesByKind.NON_SETTLED_TIP_HAS_CREDIT).toBe(1);
    expect(report.issuesByKind.DUPLICATE_CREDIT_ENTRIES).toBe(1);
    expect(report.issuesByKind.CREDIT_ACCOUNT_MISMATCH).toBe(1);
    expect(report.issuesByKind.CREDIT_AMOUNT_MISMATCH).toBe(1);
  });

  it("treats equivalent numeric amount strings as a match", () => {
    const report = buildTipSettlementParityReport({
      tipIntents: [
        {
          id: "tip-amount",
          appId: "app-1",
          postId: "post-1",
          fromUserId: "u-from",
          toUserId: "u-to",
          asset: "USDI",
          amount: "10.00",
          invoice: "inv-amount",
          state: "SETTLED",
          settledAt: "2026-04-13T00:00:00.000Z",
        },
      ],
      credits: [
        {
          appId: "app-1",
          userId: "u-to",
          asset: "USDI",
          amount: "10",
          refId: "tip-amount",
          idempotencyKey: "settlement:tip_intent:tip-amount",
        },
      ],
    });

    expect(report.healthy).toBe(true);
    expect(report.issuesByKind.CREDIT_AMOUNT_MISMATCH).toBe(0);
  });

  it("parses tip intent id from settlement credit idempotency key", () => {
    expect(parseTipIntentIdFromSettlementCreditIdempotencyKey("settlement:tip_intent:tip-123")).toBe("tip-123");
    expect(parseTipIntentIdFromSettlementCreditIdempotencyKey("settlement:tip_intent:")).toBeNull();
    expect(parseTipIntentIdFromSettlementCreditIdempotencyKey("withdrawal:debit:wd-1")).toBeNull();
  });
});
