import { describe, expect, it } from "vitest";
import {
  collectReferencedTipIntentIds,
  mergeTipRows,
} from "./scripts/reconcile-tip-settlement-parity";

describe("reconcile tip settlement parity script helpers", () => {
  it("collects referenced tip ids from credit idempotency keys", () => {
    expect(
      collectReferencedTipIntentIds([
        {
          appId: "app-1",
          userId: "u-1",
          asset: "CKB",
          amount: "10",
          refId: "tip-1",
          idempotencyKey: "settlement:tip_intent:tip-1",
        },
        {
          appId: "app-1",
          userId: "u-1",
          asset: "CKB",
          amount: "11",
          refId: "tip-1",
          idempotencyKey: "settlement:tip_intent:tip-1",
        },
        {
          appId: "app-1",
          userId: "u-2",
          asset: "CKB",
          amount: "9",
          refId: "misc",
          idempotencyKey: "unexpected-key",
        },
        {
          appId: "app-1",
          userId: "u-3",
          asset: "USDI",
          amount: "7",
          refId: "tip-2",
          idempotencyKey: "settlement:tip_intent:tip-2",
        },
      ]),
    ).toEqual(["tip-1", "tip-2"]);
  });

  it("merges tip rows without duplicating ids", () => {
    expect(
      mergeTipRows(
        [
          {
            id: "tip-1",
            appId: "app-1",
            postId: "post-1",
            fromUserId: "u-from",
            toUserId: "u-to",
            asset: "CKB",
            amount: "10",
            invoice: "inv-1",
            state: "SETTLED",
            settledAt: "2026-04-14T00:00:00.000Z",
          },
        ],
        [
          {
            id: "tip-1",
            appId: "app-1",
            postId: "post-1",
            fromUserId: "u-from",
            toUserId: "u-to",
            asset: "CKB",
            amount: "10",
            invoice: "inv-1",
            state: "SETTLED",
            settledAt: "2026-04-14T00:00:00.000Z",
          },
          {
            id: "tip-2",
            appId: "app-1",
            postId: "post-2",
            fromUserId: "u-from",
            toUserId: "u-other",
            asset: "USDI",
            amount: "3",
            invoice: "inv-2",
            state: "UNPAID",
            settledAt: null,
          },
        ],
      ),
    ).toEqual([
      {
        id: "tip-1",
        appId: "app-1",
        postId: "post-1",
        fromUserId: "u-from",
        toUserId: "u-to",
        asset: "CKB",
        amount: "10",
        invoice: "inv-1",
        state: "SETTLED",
        settledAt: "2026-04-14T00:00:00.000Z",
      },
      {
        id: "tip-2",
        appId: "app-1",
        postId: "post-2",
        fromUserId: "u-from",
        toUserId: "u-other",
        asset: "USDI",
        amount: "3",
        invoice: "inv-2",
        state: "UNPAID",
        settledAt: null,
      },
    ]);
  });
});
