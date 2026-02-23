import { describe, expect, it } from "vitest";
import {
  assetEnum,
  invoiceStateEnum,
  ledgerEntries,
  notificationChannelKindEnum,
  notificationChannels,
  notificationEventEnum,
  notificationRules,
  tipIntents,
  withdrawalStateEnum,
  withdrawals,
} from "./schema";

describe("schema", () => {
  it("exports core tables", () => {
    expect(tipIntents).toBeDefined();
    expect(ledgerEntries).toBeDefined();
    expect(withdrawals).toBeDefined();
    expect(notificationChannels).toBeDefined();
    expect(notificationRules).toBeDefined();
  });

  it("pins asset and invoice lifecycle enums to supported states", () => {
    expect(assetEnum.enumValues).toEqual(["CKB", "USDI"]);
    expect(invoiceStateEnum.enumValues).toEqual(["UNPAID", "SETTLED", "FAILED"]);
    expect(withdrawalStateEnum.enumValues).toEqual(["PENDING", "PROCESSING", "RETRY_PENDING", "COMPLETED", "FAILED"]);
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
    expect(ledgerEntries.idempotencyKey.name).toBe("idempotency_key");
    expect(withdrawals.state.name).toBe("state");
    expect(withdrawals.nextRetryAt.name).toBe("next_retry_at");
    expect(notificationChannels.kind.name).toBe("kind");
    expect(notificationChannels.enabled.name).toBe("enabled");
    expect(notificationRules.event.name).toBe("event");
    expect(notificationRules.channelId.name).toBe("channel_id");
  });
});
