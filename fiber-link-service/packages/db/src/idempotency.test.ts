import { describe, expect, it } from "vitest";
import { settlementCreditIdempotencyKey, withdrawalDebitIdempotencyKey } from "./idempotency";

describe("idempotency key helpers", () => {
  it("builds settlement credit key from tip_intent id", () => {
    expect(settlementCreditIdempotencyKey("tip-123")).toBe("settlement:tip_intent:tip-123");
  });

  it("builds withdrawal debit key from withdrawal id", () => {
    expect(withdrawalDebitIdempotencyKey("wd-987")).toBe("withdrawal:debit:wd-987");
  });

  it("generates distinct keys for different resources", () => {
    expect(settlementCreditIdempotencyKey("same")).not.toBe(withdrawalDebitIdempotencyKey("same"));
  });
});
