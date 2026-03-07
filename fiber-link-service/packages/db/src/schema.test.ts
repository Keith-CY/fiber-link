import { describe, expect, it } from "vitest";
import {
  assetEnum,
  invoiceStateEnum,
  ledgerEntries,
  liquidityRequestSourceKindEnum,
  liquidityRequestStateEnum,
  liquidityRequests,
  notificationChannelKindEnum,
  notificationChannels,
  notificationEventEnum,
  notificationRules,
  tipIntentEventSourceEnum,
  tipIntentEventTypeEnum,
  tipIntentEvents,
  tipIntents,
  withdrawalPolicies,
  withdrawalStateEnum,
  withdrawals,
} from "./schema";

describe("schema", () => {
  it("exports core tables", () => {
    expect(tipIntents).toBeDefined();
    expect(tipIntentEvents).toBeDefined();
    expect(ledgerEntries).toBeDefined();
    expect(withdrawals).toBeDefined();
    expect(liquidityRequests).toBeDefined();
    expect(withdrawalPolicies).toBeDefined();
    expect(notificationChannels).toBeDefined();
    expect(notificationRules).toBeDefined();
  });

  it("pins asset and invoice lifecycle enums to supported states", () => {
    expect(assetEnum.enumValues).toEqual(["CKB", "USDI"]);
    expect(invoiceStateEnum.enumValues).toEqual(["UNPAID", "SETTLED", "FAILED"]);
    expect(tipIntentEventSourceEnum.enumValues).toEqual(["TIP_CREATE", "TIP_STATUS", "SETTLEMENT_DISCOVERY"]);
    expect(tipIntentEventTypeEnum.enumValues).toEqual([
      "TIP_CREATED",
      "TIP_STATUS_UNPAID_OBSERVED",
      "TIP_STATUS_SETTLED",
      "TIP_STATUS_FAILED",
      "SETTLEMENT_NO_CHANGE",
      "SETTLEMENT_SETTLED_CREDIT_APPLIED",
      "SETTLEMENT_SETTLED_DUPLICATE",
      "SETTLEMENT_FAILED_UPSTREAM_REPORTED",
      "SETTLEMENT_RETRY_SCHEDULED",
      "SETTLEMENT_FAILED_PENDING_TIMEOUT",
      "SETTLEMENT_FAILED_CONTRACT_MISMATCH",
      "SETTLEMENT_FAILED_RETRY_EXHAUSTED",
      "SETTLEMENT_FAILED_TERMINAL_ERROR",
    ]);
    expect(withdrawalStateEnum.enumValues).toEqual([
      "LIQUIDITY_PENDING",
      "PENDING",
      "PROCESSING",
      "RETRY_PENDING",
      "COMPLETED",
      "FAILED",
    ]);
    expect(liquidityRequestStateEnum.enumValues).toEqual(["REQUESTED", "REBALANCING", "FUNDED", "FAILED"]);
    expect(liquidityRequestSourceKindEnum.enumValues).toEqual(["FIBER_TO_CKB_CHAIN"]);
    expect(notificationChannelKindEnum.enumValues).toEqual(["WEBHOOK"]);
    expect(notificationEventEnum.enumValues).toEqual([
      "WITHDRAWAL_RETRY_PENDING",
      "WITHDRAWAL_FAILED",
      "WITHDRAWAL_COMPLETED",
    ]);
  });

  it("keeps idempotency and lifecycle columns explicitly modeled", () => {
    expect(tipIntents.invoice.name).toBe("invoice");
    expect(tipIntents.invoiceState.name).toBe("invoice_state");
    expect(tipIntentEvents.type.name).toBe("type");
    expect(tipIntentEvents.tipIntentId.name).toBe("tip_intent_id");
    expect(ledgerEntries.idempotencyKey.name).toBe("idempotency_key");
    expect(withdrawals.state.name).toBe("state");
    expect(withdrawals.nextRetryAt.name).toBe("next_retry_at");
    expect(liquidityRequests.state.name).toBe("state");
    expect(liquidityRequests.sourceKind.name).toBe("source_kind");
    expect(liquidityRequests.requiredAmount.name).toBe("required_amount");
    expect(liquidityRequests.fundedAmount.name).toBe("funded_amount");
    expect(withdrawalPolicies.allowedAssets.name).toBe("allowed_assets");
    expect(withdrawalPolicies.maxPerRequest.name).toBe("max_per_request");
    expect(withdrawalPolicies.perUserDailyMax.name).toBe("per_user_daily_max");
    expect(withdrawalPolicies.perAppDailyMax.name).toBe("per_app_daily_max");
    expect(notificationChannels.kind.name).toBe("kind");
    expect(notificationChannels.enabled.name).toBe("enabled");
    expect(notificationRules.event.name).toBe("event");
    expect(notificationRules.channelId.name).toBe("channel_id");
  });
});
