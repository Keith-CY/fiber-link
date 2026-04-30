export function normalizeRpcAmount(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return "0";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "0";
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return BigInt(trimmed).toString(10);
  }
  return trimmed;
}

export function normalizeRpcInteger(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return Number(BigInt(trimmed));
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : 0;
}

export function toHexQuantity(value: string): string {
  if (/^0x[0-9a-f]+$/i.test(value)) {
    return value.toLowerCase();
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`invalid amount: ${value}`);
  }
  return `0x${BigInt(value).toString(16)}`;
}

export const SHANNONS_PER_CKB = 100_000_000n;

export function parseCkbDecimalToShannons(value: string): bigint {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new Error(`invalid CKB amount: ${value}`);
  }
  const [integerPartRaw, fractionPartRaw = ""] = trimmed.split(".");
  if (fractionPartRaw.length > 8) {
    throw new Error(`CKB amount supports at most 8 decimal places, received: ${value}`);
  }
  const shannons = BigInt(integerPartRaw) * SHANNONS_PER_CKB + BigInt(fractionPartRaw.padEnd(8, "0"));
  if (shannons <= 0n) {
    throw new Error(`CKB amount must be greater than 0, received: ${value}`);
  }
  return shannons;
}

export function ckbDecimalToHexQuantity(value: string): string {
  return `0x${parseCkbDecimalToShannons(value).toString(16)}`;
}

export function pickStringCandidate(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

export function pickRequiredAmount(result: Record<string, unknown> | undefined, key: string): string {
  const normalized = normalizeRpcAmount(result?.[key]);
  if (normalized === "0") {
    return "0";
  }
  return normalized;
}

export function normalizeOptionalName(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim().toLowerCase();
}

export function parseBoolean(input: string | undefined): boolean | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return undefined;
}

export function pickTxEvidence(result: Record<string, unknown> | undefined): string | null {
  const candidates = [result?.tx_hash, result?.txHash, result?.payment_hash, result?.paymentHash, result?.hash];
  for (const value of candidates) {
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return null;
}

export function parsePositiveInteger(input: string | undefined): number | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  if (!/^[0-9]+$/.test(input)) {
    return undefined;
  }
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}
