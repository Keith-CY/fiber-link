import { describe, it, expect } from "vitest";
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
});
