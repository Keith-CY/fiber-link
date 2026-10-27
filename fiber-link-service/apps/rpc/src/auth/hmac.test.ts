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

  it("binds the app id into v2 signatures", () => {
    const payload = "{}";
    const ts = "1700000000";
    const nonce = "n1";
    const sig = verifyHmac.signV2({ secret, payload, ts, nonce, appId: "app-a" });
    expect(verifyHmac.checkV2({ secret, payload, ts, nonce, appId: "app-a", signature: sig })).toBe(true);
    expect(verifyHmac.checkV2({ secret, payload, ts, nonce, appId: "app-b", signature: sig })).toBe(false);
    expect(sig).not.toBe(verifyHmac.sign({ secret, payload, ts, nonce }));
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
