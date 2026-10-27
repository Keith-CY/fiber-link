import { describe, expect, it } from "vitest";
import { verifyHmac } from "./hmac";

const secret = "test-secret";

describe("hmac", () => {
  it("verifies valid signature", () => {
    const payload = "{}";
    const ts = "1700000000";
    const nonce = "n1";
    const sig = verifyHmac.sign({ secret, payload, ts, nonce });
    expect(verifyHmac.check({ secret, payload, ts, nonce, signature: sig })).toBe(true);
  });

  it("returns false on signature length mismatch", () => {
    const payload = "{}";
    const ts = "1700000000";
    const nonce = "n1";
    const result = verifyHmac.check({
      secret,
      payload,
      ts,
      nonce,
      signature: "short",
    });
    expect(result).toBe(false);
  });

  it("returns false for a non-ASCII signature with the same string length", () => {
    const payload = "{}";
    const ts = "1700000000";
    const nonce = "n1";
    const signature = "\u00e9".repeat(64);
    expect(verifyHmac.check({ secret, payload, ts, nonce, signature })).toBe(false);
  });
});
