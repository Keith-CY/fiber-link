import { describe, expect, it } from "vitest";
import {
  DashboardSummaryResultSchema,
  RpcErrorCode,
  RpcRequestSchema,
  TipCreateParamsSchema,
  TipCreateResultSchema,
  TipStatusResultSchema,
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
        toAddress: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      }).success,
    ).toBe(true);
    expect(
      WithdrawalRequestResultSchema.safeParse({
        id: "wd-1",
        state: "PENDING",
      }).success,
    ).toBe(true);
    expect(
      DashboardSummaryResultSchema.safeParse({
        balance: "10",
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
            createdAt: "2026-02-16T00:00:00.000Z",
          },
        ],
        generatedAt: "2026-02-16T00:00:00.000Z",
      }).success,
    ).toBe(true);

    expect(
      DashboardSummaryResultSchema.safeParse({
        balance: "0",
        tips: [],
        admin: {
          filtersApplied: {
            withdrawalState: "ALL",
            settlementState: "ALL",
          },
          apps: [],
          withdrawals: [],
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
      }).success,
    ).toBe(true);
  });

  it("keeps rpc error code constants stable", () => {
    expect(RpcErrorCode.INVALID_REQUEST).toBe(-32600);
    expect(RpcErrorCode.INVALID_PARAMS).toBe(-32602);
    expect(RpcErrorCode.UNAUTHORIZED).toBe(-32001);
    expect(RpcErrorCode.TIP_NOT_FOUND).toBe(-32004);
  });
});
