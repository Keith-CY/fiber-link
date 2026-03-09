import { describe, expect, it } from "vitest";
import {
  DashboardWithdrawalStateFilterSchema,
  DashboardSummaryResultSchema,
  RpcErrorCode,
  RpcRequestSchema,
  TipCreateParamsSchema,
  TipCreateResultSchema,
  TipSettledFeedParamsSchema,
  TipSettledFeedResultSchema,
  TipStatusResultSchema,
  WithdrawalQuoteParamsSchema,
  WithdrawalQuoteResultSchema,
  WithdrawalRequestParamsSchema,
  WithdrawalRequestResultSchema,
} from "./contracts";

describe("rpc contracts", () => {
  it("validates canonical rpc request shape", () => {
    const parsed = RpcRequestSchema.safeParse({
      jsonrpc: "2.0",
      id: "1",
      method: "tip.create",
      params: {
        postId: "p1",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("pins tip.create and tip.status payload contracts", () => {
    expect(
      TipCreateParamsSchema.safeParse({
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "10",
        message: "Great post",
      }).success,
    ).toBe(true);
    expect(
      TipCreateParamsSchema.safeParse({
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "0",
      }).success,
    ).toBe(false);
    expect(
      TipCreateParamsSchema.safeParse({
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "-1",
      }).success,
    ).toBe(false);
    expect(
      TipCreateParamsSchema.safeParse({
        postId: "p1",
        fromUserId: "u1",
        toUserId: "u2",
        asset: "USDI",
        amount: "abc",
      }).success,
    ).toBe(false);

    expect(TipCreateResultSchema.safeParse({ invoice: "invoice-1" }).success).toBe(true);
    expect(TipStatusResultSchema.safeParse({ state: "SETTLED" }).success).toBe(true);
    expect(TipStatusResultSchema.safeParse({ state: "BROKEN" }).success).toBe(false);
    expect(
      WithdrawalRequestParamsSchema.safeParse({
        userId: "u1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      }).success,
    ).toBe(true);
    expect(
      WithdrawalRequestParamsSchema.safeParse({
        userId: "u1",
        asset: "USDI",
        amount: "1",
        destination: {
          kind: "PAYMENT_REQUEST",
          paymentRequest: "fiber:invoice:example",
        },
      }).success,
    ).toBe(true);
    expect(
      WithdrawalRequestResultSchema.parse({
        id: "wd-1",
        state: "PENDING",
      }).state,
    ).toBe("PENDING");
    expect(
      WithdrawalRequestResultSchema.parse({
        id: "w1",
        state: "LIQUIDITY_PENDING",
      }).state,
    ).toBe("LIQUIDITY_PENDING");
    expect(
      WithdrawalRequestResultSchema.safeParse({
        id: "w2",
        state: "RETRY_PENDING",
      }).success,
    ).toBe(false);
    expect(
      WithdrawalRequestResultSchema.safeParse({
        id: "w3",
        state: "COMPLETED",
      }).success,
    ).toBe(false);
    expect(DashboardWithdrawalStateFilterSchema.options).toContain("LIQUIDITY_PENDING");
    expect(
      DashboardSummaryResultSchema.safeParse({
        balance: "10",
        balances: {
          available: "10",
          pending: "2",
          locked: "1",
          asset: "CKB",
        },
        stats: {
          pendingCount: 1,
          completedCount: 3,
          failedCount: 0,
        },
        tips: [
          {
            id: "tip-1",
            invoice: "inv-1",
            postId: "p1",
            amount: "1",
            asset: "CKB",
            state: "UNPAID",
            direction: "IN",
            counterpartyUserId: "u2",
            message: "Great post",
            createdAt: "2026-02-16T00:00:00.000Z",
            settledAt: null,
          },
        ],
        generatedAt: "2026-02-16T00:00:00.000Z",
      }).success,
    ).toBe(true);

    expect(
      WithdrawalQuoteParamsSchema.safeParse({
        userId: "u1",
        asset: "CKB",
        amount: "61",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
        },
      }).success,
    ).toBe(true);
    expect(
      WithdrawalQuoteResultSchema.safeParse({
        asset: "CKB",
        amount: "61",
        minimumAmount: "61",
        availableBalance: "124",
        lockedBalance: "61",
        networkFee: "0.00001",
        receiveAmount: "60.99999",
        destinationValid: true,
        validationMessage: null,
      }).success,
    ).toBe(true);
    expect(
      TipSettledFeedParamsSchema.safeParse({
        limit: 20,
        after: { settledAt: "2026-02-16T00:00:00.000Z", id: "tip-1" },
      }).success,
    ).toBe(true);
    expect(
      TipSettledFeedResultSchema.safeParse({
        items: [
          {
            tipIntentId: "tip-1",
            postId: "p1",
            invoice: "inv-1",
            amount: "31",
            asset: "CKB",
            fromUserId: "u1",
            toUserId: "u2",
            message: "Great post",
            settledAt: "2026-02-16T00:00:01.000Z",
          },
        ],
        nextCursor: { settledAt: "2026-02-16T00:00:01.000Z", id: "tip-1" },
      }).success,
    ).toBe(true);

    expect(
      DashboardSummaryResultSchema.parse({
        balance: "0",
        balances: {
          available: "0",
          pending: "0",
          locked: "0",
          asset: "CKB",
        },
        stats: {
          pendingCount: 0,
          completedCount: 0,
          failedCount: 0,
        },
        tips: [],
        admin: {
          filtersApplied: {
            withdrawalState: "ALL",
            settlementState: "ALL",
          },
          apps: [],
          withdrawals: [
            {
              id: "wd-liquidity",
              userId: "u-liquidity",
              asset: "CKB",
              amount: "61",
              state: "LIQUIDITY_PENDING",
              retryCount: 0,
              createdAt: "2026-02-16T00:00:00.000Z",
              updatedAt: "2026-02-16T00:00:00.000Z",
              txHash: null,
              nextRetryAt: null,
              lastError: null,
            },
          ],
          settlements: [],
          pipelineBoard: {
            stageCounts: [
              { stage: "UNPAID", count: 2 },
              { stage: "SETTLED", count: 1 },
              { stage: "FAILED", count: 0 },
            ],
            invoiceRows: [
              {
                invoice: "inv-1",
                state: "UNPAID",
                amount: "2.5",
                asset: "CKB",
                fromUserId: "u1",
                toUserId: "u2",
                createdAt: "2026-02-16T00:00:00.000Z",
                timelineHref: "/fiber-link/timeline/inv-1",
              },
            ],
          },
        },
        generatedAt: "2026-02-16T00:00:00.000Z",
      }).admin?.withdrawals[0]?.state,
    ).toBe("LIQUIDITY_PENDING");
  });

  it("keeps rpc error code constants stable", () => {
    expect(RpcErrorCode.INVALID_REQUEST).toBe(-32600);
    expect(RpcErrorCode.INVALID_PARAMS).toBe(-32602);
    expect(RpcErrorCode.UNAUTHORIZED).toBe(-32001);
    expect(RpcErrorCode.RATE_LIMITED).toBe(-32005);
    expect(RpcErrorCode.TIP_NOT_FOUND).toBe(-32004);
  });
});
