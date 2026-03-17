import { assertPositiveAmount, compareDecimalStrings, type Asset } from "@fiber-link/db";

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

  const cooldownSeconds = Number(input.cooldownSeconds);
  if (!Number.isInteger(cooldownSeconds) || cooldownSeconds < 0) {
    throw new Error("cooldownSeconds must be an integer >= 0");
  }

  return {
    appId,
    allowedAssets: normalizedAssets,
    maxPerRequest,
    perUserDailyMax,
    perAppDailyMax,
    cooldownSeconds,
  };
}
