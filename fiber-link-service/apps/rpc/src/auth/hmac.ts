import crypto from "node:crypto";

type SignArgs = { secret: string; payload: string; ts: string; nonce: string };

type CheckArgs = SignArgs & { signature: string };

export const verifyHmac = {
  sign({ secret, payload, ts, nonce }: SignArgs) {
    const input = `${ts}.${nonce}.${payload}`;
    return crypto.createHmac("sha256", secret).update(input).digest("hex");
  },
  check({ secret, payload, ts, nonce, signature }: CheckArgs) {
    const expected = verifyHmac.sign({ secret, payload, ts, nonce });
    const expectedBuf = Buffer.from(expected);
    const signatureBuf = Buffer.from(signature);
    // Compare byte lengths: timingSafeEqual throws on mismatch, and non-ASCII input
    // can have the same string length but a different byte length.
    if (expectedBuf.length !== signatureBuf.length) return false;
    return crypto.timingSafeEqual(expectedBuf, signatureBuf);
  },
};
