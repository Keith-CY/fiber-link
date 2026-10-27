import { type Asset, assertPositiveAmount, compareDecimalStrings } from "@fiber-link/db";

export type WithdrawalPolicyInput = {
  appId: string;
  allowedAssets: Asset[];
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: number;
};

function isSupportedAsset(value: unknown): value is Asset {
  return value === "CKB" || value === "USDI";
}

function normalizeAllowedAssets(raw: unknown): Asset[] {
  if (Array.isArray(raw)) {
    return Array.from(new Set(raw.filter(isSupportedAsset)));
  }

  if (typeof raw === "string") {
    return Array.from(
      new Set(
        raw
          .split(",")
          .map((item) => item.trim())
          .filter(isSupportedAsset),
      ),
    );
  }

  return [];
}

/** Upper bound of the `cooldown_seconds` int4 column. */
const MAX_COOLDOWN_SECONDS = 2_147_483_647;

/**
 * Accept only a plain non-negative integer (a number, or a string of digits from
 * a form field / CLI flag). `Number(...)` coercion is avoided on purpose: it
 * turns a cleared field (`""`/`null`) into 0 ("no cooldown") and accepts
 * `true`, `"1e3"` and values that overflow the int4 column.
 */
function parseCooldownSeconds(raw: unknown): number {
  const value =
    typeof raw === "number"
      ? raw
      : typeof raw === "string" && /^\d+$/.test(raw.trim())
        ? Number(raw.trim())
        : Number.NaN;
  if (!Number.isInteger(value) || value < 0 || value > MAX_COOLDOWN_SECONDS) {
    throw new Error(`cooldownSeconds must be an integer between 0 and ${MAX_COOLDOWN_SECONDS}`);
  }
  return value;
}

export function parseWithdrawalPolicyInput(raw: unknown): WithdrawalPolicyInput {
  if (!raw || typeof raw !== "object") {
    throw new Error("input must be an object");
  }
  const input = raw as Record<string, unknown>;

  const appId = typeof input.appId === "string" ? input.appId.trim() : "";
  if (!appId) {
    throw new Error("appId is required");
  }

  const normalizedAssets = normalizeAllowedAssets(input.allowedAssets);
  if (normalizedAssets.length === 0) {
    throw new Error("allowedAssets must include CKB or USDI");
  }

  const maxPerRequest = typeof input.maxPerRequest === "string" ? input.maxPerRequest.trim() : "";
  const perUserDailyMax = typeof input.perUserDailyMax === "string" ? input.perUserDailyMax.trim() : "";
  const perAppDailyMax = typeof input.perAppDailyMax === "string" ? input.perAppDailyMax.trim() : "";
  if (!maxPerRequest || !perUserDailyMax || !perAppDailyMax) {
    throw new Error("maxPerRequest, perUserDailyMax, and perAppDailyMax are required");
  }

  try {
    assertPositiveAmount(maxPerRequest);
    assertPositiveAmount(perUserDailyMax);
    assertPositiveAmount(perAppDailyMax);
  } catch {
    throw new Error("maxPerRequest, perUserDailyMax, and perAppDailyMax must be positive decimals");
  }

  if (compareDecimalStrings(maxPerRequest, perUserDailyMax) > 0) {
    throw new Error("maxPerRequest must be <= perUserDailyMax");
  }

  if (compareDecimalStrings(perUserDailyMax, perAppDailyMax) > 0) {
    throw new Error("perUserDailyMax must be <= perAppDailyMax");
  }

  const cooldownSeconds = parseCooldownSeconds(input.cooldownSeconds);

  return {
    appId,
    allowedAssets: normalizedAssets,
    maxPerRequest,
    perUserDailyMax,
    perAppDailyMax,
    cooldownSeconds,
  };
}
