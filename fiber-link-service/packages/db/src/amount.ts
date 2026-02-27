export type ParsedDecimal = { value: bigint; scale: number };

export class InvalidAmountError extends Error {
  constructor(public readonly amount: string) {
    super(`invalid amount: ${amount}`);
    this.name = "InvalidAmountError";
  }
}

export function pow10(n: number): bigint {
  if (n <= 0) return 1n;
  return BigInt(`1${"0".repeat(n)}`);
}

export function parseDecimal(value: string): ParsedDecimal {
  const raw = value.trim();
  if (!raw) {
    throw new InvalidAmountError(value);
  }

  let sign = 1n;
  let s = raw;
  if (s.startsWith("+")) s = s.slice(1);
  if (s.startsWith("-")) {
    sign = -1n;
    s = s.slice(1);
  }

  const parts = s.split(".");
  if (parts.length > 2) {
    throw new InvalidAmountError(value);
  }
  const [intPartRaw, fracPartRaw = ""] = parts;
  const intPart = intPartRaw === "" ? "0" : intPartRaw;
  const fracPart = fracPartRaw;

  if (!/^\d+$/.test(intPart) || (fracPart && !/^\d+$/.test(fracPart))) {
    throw new InvalidAmountError(value);
  }

  const scale = fracPart.length;
  const digitsStr = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, "");
  const digits = BigInt(digitsStr || "0");
  const normalizedSign = digits === 0n ? 1n : sign;
  return { value: normalizedSign * digits, scale };
}

export function formatDecimal(value: bigint, scale: number): string {
  if (scale === 0) return value.toString();

  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const digits = abs.toString().padStart(scale + 1, "0");
  const intPart = digits.slice(0, -scale).replace(/^0+(?=\d)/, "");
  let fracPart = digits.slice(-scale);
  fracPart = fracPart.replace(/0+$/, "");

  if (!fracPart) {
    return `${sign}${intPart || "0"}`;
  }
  return `${sign}${intPart || "0"}.${fracPart}`;
}

export function assertPositiveAmount(value: string): void {
  const parsed = parseDecimal(value);
  if (parsed.value <= 0n) {
    throw new InvalidAmountError(value);
  }
}

export function compareDecimalStrings(left: string, right: string): number {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const leftValue = a.value * pow10(scale - a.scale);
  const rightValue = b.value * pow10(scale - b.scale);
  if (leftValue === rightValue) {
    return 0;
  }
  return leftValue > rightValue ? 1 : -1;
}

export function addDecimalStrings(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const value = a.value * pow10(scale - a.scale) + b.value * pow10(scale - b.scale);
  return formatDecimal(value, scale);
}
