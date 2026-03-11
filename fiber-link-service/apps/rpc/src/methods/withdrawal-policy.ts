import {
  addDecimalStrings,
  compareDecimalStrings,
  formatDecimal,
  parseDecimal,
  type Asset,
  type WithdrawalPolicyRecord,
  type WithdrawalPolicyUsage,
} from "@fiber-link/db";
import {
  getCkbAddressMinCellCapacityShannons,
  shannonsToCkbDecimal,
  WithdrawalExecutionError,
  type WithdrawalDestination,
} from "@fiber-link/fiber-adapter";

export type RequestWithdrawalInput = {
  appId: string;
  userId: string;
  asset: Asset;
  amount: string;
  destination: WithdrawalDestination;
};

export class WithdrawalPolicyViolationError extends Error {
  constructor(
    public readonly reason:
      | "ASSET_NOT_ALLOWED"
      | "AMOUNT_BELOW_MIN_CAPACITY"
      | "MAX_PER_REQUEST_EXCEEDED"
      | "PER_USER_DAILY_LIMIT_EXCEEDED"
      | "PER_APP_DAILY_LIMIT_EXCEEDED"
      | "COOLDOWN_ACTIVE"
      | "INVALID_DESTINATION_ADDRESS"
      | "WITHDRAWAL_SIGNER_UNAVAILABLE",
    message: string,
  ) {
    super(message);
    this.name = "WithdrawalPolicyViolationError";
  }
}

const DEFAULT_ALLOWED_ASSETS: Asset[] = ["CKB", "USDI"];
const DEFAULT_MAX_PER_REQUEST = "5000";
const DEFAULT_PER_USER_DAILY_MAX = "20000";
const DEFAULT_PER_APP_DAILY_MAX = "200000";
const DEFAULT_COOLDOWN_SECONDS = 0;
export const WITHDRAWAL_SIGNER_UNAVAILABLE_MESSAGE =
  "CKB address withdrawals are temporarily unavailable because the withdrawal signer is not configured";

function parseAllowedAssetsFromEnv(raw: string | undefined): Asset[] {
  if (!raw) {
    return DEFAULT_ALLOWED_ASSETS;
  }

  const values = raw
    .split(",")
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
  const unique = new Set<Asset>();
  for (const item of values) {
    if (item === "CKB" || item === "USDI") {
      unique.add(item);
    }
  }
  if (unique.size === 0) {
    return DEFAULT_ALLOWED_ASSETS;
  }
  return [...unique.values()];
}

function parseNonNegativeIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") {
    return fallback;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new Error(`${name} must be an integer >= 0`);
  }
  return parsed;
}

function parsePositiveAmountEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : raw.trim();
  const parsed = parseDecimal(value);
  if (parsed.value <= 0n) {
    throw new Error(`${name} must be a positive decimal`);
  }
  return formatDecimal(parsed.value, parsed.scale);
}

export function defaultPolicyForApp(appId: string): WithdrawalPolicyRecord {
  return {
    appId,
    allowedAssets: parseAllowedAssetsFromEnv(process.env.FIBER_WITHDRAWAL_POLICY_ALLOWED_ASSETS),
    maxPerRequest: parsePositiveAmountEnv("FIBER_WITHDRAWAL_POLICY_MAX_PER_REQUEST", DEFAULT_MAX_PER_REQUEST),
    perUserDailyMax: parsePositiveAmountEnv(
      "FIBER_WITHDRAWAL_POLICY_PER_USER_DAILY_MAX",
      DEFAULT_PER_USER_DAILY_MAX,
    ),
    perAppDailyMax: parsePositiveAmountEnv("FIBER_WITHDRAWAL_POLICY_PER_APP_DAILY_MAX", DEFAULT_PER_APP_DAILY_MAX),
    cooldownSeconds: parseNonNegativeIntegerEnv(
      "FIBER_WITHDRAWAL_POLICY_COOLDOWN_SECONDS",
      DEFAULT_COOLDOWN_SECONDS,
    ),
    updatedBy: null,
    createdAt: new Date(0),
    updatedAt: new Date(0),
  };
}

export function usageFallback(): WithdrawalPolicyUsage {
  return {
    appDailyTotal: "0",
    userDailyTotal: "0",
    lastRequestedAt: null,
  };
}

export function assertOnChainWithdrawalReady(
  input: RequestWithdrawalInput,
  usesDefaultHotWalletInventoryProvider: boolean,
) {
  if (input.destination.kind !== "CKB_ADDRESS" || !usesDefaultHotWalletInventoryProvider) {
    return;
  }

  if (process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY?.trim()) {
    return;
  }

  throw new WithdrawalPolicyViolationError(
    "WITHDRAWAL_SIGNER_UNAVAILABLE",
    WITHDRAWAL_SIGNER_UNAVAILABLE_MESSAGE,
  );
}

export function assertWithdrawalPolicy(
  input: RequestWithdrawalInput,
  policy: WithdrawalPolicyRecord,
  usage: WithdrawalPolicyUsage,
  now: Date,
  minimumRequiredAmount: string,
) {
  if (!policy.allowedAssets.includes(input.asset)) {
    throw new WithdrawalPolicyViolationError(
      "ASSET_NOT_ALLOWED",
      `asset ${input.asset} is not allowed for withdrawals in app ${input.appId}`,
    );
  }

  if (compareDecimalStrings(input.amount, minimumRequiredAmount) < 0) {
    throw new WithdrawalPolicyViolationError(
      "AMOUNT_BELOW_MIN_CAPACITY",
      `withdrawal amount ${input.amount} is below minimum required ${minimumRequiredAmount} for destination address`,
    );
  }

  if (compareDecimalStrings(input.amount, policy.maxPerRequest) > 0) {
    throw new WithdrawalPolicyViolationError(
      "MAX_PER_REQUEST_EXCEEDED",
      `withdrawal amount ${input.amount} exceeds per-request limit ${policy.maxPerRequest}`,
    );
  }

  const nextUserTotal = addDecimalStrings(usage.userDailyTotal, input.amount);
  if (compareDecimalStrings(nextUserTotal, policy.perUserDailyMax) > 0) {
    throw new WithdrawalPolicyViolationError(
      "PER_USER_DAILY_LIMIT_EXCEEDED",
      `daily user withdrawal limit exceeded: ${nextUserTotal} > ${policy.perUserDailyMax}`,
    );
  }

  const nextAppTotal = addDecimalStrings(usage.appDailyTotal, input.amount);
  if (compareDecimalStrings(nextAppTotal, policy.perAppDailyMax) > 0) {
    throw new WithdrawalPolicyViolationError(
      "PER_APP_DAILY_LIMIT_EXCEEDED",
      `daily app withdrawal limit exceeded: ${nextAppTotal} > ${policy.perAppDailyMax}`,
    );
  }

  if (policy.cooldownSeconds > 0 && usage.lastRequestedAt) {
    const elapsedMs = now.getTime() - usage.lastRequestedAt.getTime();
    const cooldownMs = policy.cooldownSeconds * 1000;
    if (elapsedMs >= 0 && elapsedMs < cooldownMs) {
      const remaining = Math.ceil((cooldownMs - elapsedMs) / 1000);
      throw new WithdrawalPolicyViolationError(
        "COOLDOWN_ACTIVE",
        `withdrawal cooldown active, retry in ${remaining}s`,
      );
    }
  }
}

export async function resolveMinimumRequiredAmount(input: RequestWithdrawalInput): Promise<string> {
  if (input.destination.kind !== "CKB_ADDRESS") {
    return "0";
  }

  if (input.asset !== "CKB") {
    throw new WithdrawalPolicyViolationError(
      "INVALID_DESTINATION_ADDRESS",
      "CKB address withdrawal destination currently supports only CKB asset",
    );
  }

  const toAddress = input.destination.address;

  try {
    const minShannons = getCkbAddressMinCellCapacityShannons(toAddress);
    return shannonsToCkbDecimal(minShannons);
  } catch (error) {
    if (error instanceof WithdrawalExecutionError) {
      throw new WithdrawalPolicyViolationError("INVALID_DESTINATION_ADDRESS", error.message);
    }
    throw error;
  }
}
