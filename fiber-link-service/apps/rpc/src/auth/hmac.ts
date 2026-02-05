import crypto from "crypto";

type SignArgs = { secret: string; payload: string; ts: string; nonce: string };

type CheckArgs = SignArgs & { signature: string };

export const verifyHmac = {
  sign({ secret, payload, ts, nonce }: SignArgs) {
    const input = `${ts}.${nonce}.${payload}`;
    return crypto.createHmac("sha256", secret).update(input).digest("hex");
  },
  check({ secret, payload, ts, nonce, signature }: CheckArgs) {
    const expected = verifyHmac.sign({ secret, payload, ts, nonce });
    if (expected.length !== signature.length) return false;
    return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature));
  },
};
