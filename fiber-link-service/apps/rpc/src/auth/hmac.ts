import crypto from "node:crypto";

type SignArgs = { secret: string; payload: string; ts: string; nonce: string };

type CheckArgs = SignArgs & { signature: string };

// v2 binds x-app-id into the signed string: `v2\n<appId>\n<ts>.<nonce>.<payload>`, i.e. a
// prefix in front of the legacy v1 string. Header values cannot contain newlines, so the
// app id cannot be shifted into ts/nonce and no v2 string can equal a v1 string.
const v2Ts = (appId: string, ts: string) => `v2\n${appId}\n${ts}`;

export const verifyHmac = {
  signV2({ appId, ts, ...args }: SignArgs & { appId: string }) {
    return verifyHmac.sign({ ...args, ts: v2Ts(appId, ts) });
  },
  checkV2({ appId, ts, ...args }: CheckArgs & { appId: string }) {
    return verifyHmac.check({ ...args, ts: v2Ts(appId, ts) });
  },
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
