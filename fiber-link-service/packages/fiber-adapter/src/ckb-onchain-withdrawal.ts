import { BI, Indexer, RPC, commons, config, hd, helpers } from "@ckb-lumos/lumos";
import type { Asset, ExecuteWithdrawalArgs, WithdrawalExecutionKind } from "./types";

const SHANNONS_PER_CKB = 100_000_000n;
const DEFAULT_FEE_RATE_SHANNONS_PER_KB = 1_000n;
const DEFAULT_TESTNET_CKB_RPC_URL = "https://testnet.ckbapp.dev/";

type LumosConfig = typeof config.predefined.LINA;
export type CkbNetworkConfig = { cfg: LumosConfig; isTestnet: boolean };

export class WithdrawalExecutionError extends Error {
  constructor(
    message: string,
    public readonly kind: WithdrawalExecutionKind,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WithdrawalExecutionError";
  }
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}

function parseCkbAmountToShannons(amount: string): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new WithdrawalExecutionError(`invalid CKB amount: ${amount}`, "permanent");
  }

  const [intPartRaw, fracPartRaw = ""] = trimmed.split(".");
  if (fracPartRaw.length > 8) {
    throw new WithdrawalExecutionError(
      `CKB amount supports at most 8 decimal places, received: ${amount}`,
      "permanent",
    );
  }

  const intPart = BigInt(intPartRaw);
  const fracPart = fracPartRaw.padEnd(8, "0");
  const fracValue = fracPart ? BigInt(fracPart) : 0n;
  const shannons = intPart * SHANNONS_PER_CKB + fracValue;

  if (shannons <= 0n) {
    throw new WithdrawalExecutionError(`withdrawal amount must be greater than 0, received: ${amount}`, "permanent");
  }
  return shannons;
}

function parseOptionalBigIntEnv(name: string): bigint | null {
  const raw = process.env[name];
  if (typeof raw !== "string" || raw.trim() === "") {
    return null;
  }
  if (!/^\d+$/.test(raw.trim())) {
    throw new WithdrawalExecutionError(`${name} must be an integer in decimal shannons`, "permanent");
  }
  return BigInt(raw.trim());
}

function normalizeHexPrivateKey(input: string): string {
  const normalized = input.startsWith("0x") || input.startsWith("0X") ? `0x${input.slice(2)}` : `0x${input}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new WithdrawalExecutionError("FIBER_WITHDRAWAL_CKB_PRIVATE_KEY must be a 32-byte hex private key", "permanent");
  }
  return normalized.toLowerCase();
}

function resolvePrivateKey(): string {
  const raw = process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new WithdrawalExecutionError("FIBER_WITHDRAWAL_CKB_PRIVATE_KEY is required for on-chain withdrawal", "permanent");
  }
  return normalizeHexPrivateKey(raw);
}

export function resolveCkbNetworkConfig(toAddress: string): CkbNetworkConfig {
  const normalized = toAddress.trim().toLowerCase();
  if (normalized.startsWith("ckt1")) {
    return { cfg: config.predefined.AGGRON4, isTestnet: true };
  }
  if (normalized.startsWith("ckb1")) {
    return { cfg: config.predefined.LINA, isTestnet: false };
  }

  throw new WithdrawalExecutionError(
    "withdrawal destination must be a CKB address (ckt1... or ckb1...)",
    "permanent",
  );
}

function resolveCkbRpcUrl(isTestnet: boolean): string {
  const explicit = process.env.FIBER_WITHDRAWAL_CKB_RPC_URL?.trim();
  if (explicit) {
    return explicit;
  }

  if (isTestnet) {
    const testnetUrl = process.env.FIBER_WITHDRAWAL_CKB_RPC_URL_TESTNET?.trim();
    if (testnetUrl) {
      return testnetUrl;
    }
    return DEFAULT_TESTNET_CKB_RPC_URL;
  }

  const mainnetUrl = process.env.FIBER_WITHDRAWAL_CKB_RPC_URL_MAINNET?.trim();
  if (mainnetUrl) {
    return mainnetUrl;
  }

  throw new WithdrawalExecutionError(
    "FIBER_WITHDRAWAL_CKB_RPC_URL is required for mainnet on-chain withdrawal",
    "permanent",
  );
}

function resolveIndexerUrl(rpcUrl: string, isTestnet: boolean): string {
  const explicit = process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL?.trim();
  if (explicit) {
    return explicit;
  }

  if (isTestnet) {
    const testnetUrl = process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL_TESTNET?.trim();
    if (testnetUrl) {
      return testnetUrl;
    }
  } else {
    const mainnetUrl = process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL_MAINNET?.trim();
    if (mainnetUrl) {
      return mainnetUrl;
    }
  }

  return rpcUrl;
}

function resolveFeeRateShannonsPerKb(): bigint {
  const feeRate = parseOptionalBigIntEnv("FIBER_WITHDRAWAL_CKB_FEE_RATE_SHANNONS_PER_KB");
  if (feeRate === null) {
    return DEFAULT_FEE_RATE_SHANNONS_PER_KB;
  }
  if (feeRate <= 0n) {
    throw new WithdrawalExecutionError("FIBER_WITHDRAWAL_CKB_FEE_RATE_SHANNONS_PER_KB must be > 0", "permanent");
  }
  return feeRate;
}

function classifyUnknownRuntimeError(error: unknown): WithdrawalExecutionKind {
  const message = normalizeErrorMessage(error);
  if (error instanceof TypeError) {
    return "transient";
  }
  if (/ECONN|ETIMEDOUT|ENOTFOUND|network|fetch failed|timeout|temporar/i.test(message)) {
    return "transient";
  }
  return "permanent";
}

function resolvePolicyMinimumShannons(): bigint {
  const configured = parseOptionalBigIntEnv("FIBER_WITHDRAWAL_CKB_MIN_SHANNONS");
  if (configured === null) {
    return 0n;
  }
  if (configured < 0n) {
    throw new WithdrawalExecutionError("FIBER_WITHDRAWAL_CKB_MIN_SHANNONS must be >= 0", "permanent");
  }
  return configured;
}

export function shannonsToCkbDecimal(shannons: bigint): string {
  const integerPart = shannons / SHANNONS_PER_CKB;
  const fractionPart = shannons % SHANNONS_PER_CKB;
  if (fractionPart === 0n) {
    return integerPart.toString();
  }

  const fractionRaw = fractionPart.toString().padStart(8, "0").replace(/0+$/, "");
  return `${integerPart}.${fractionRaw}`;
}

export function getCkbAddressMinCellCapacityShannons(toAddress: string): bigint {
  const { cfg } = resolveCkbNetworkConfig(toAddress);
  config.initializeConfig(cfg);

  let recipientLock: ReturnType<typeof helpers.parseAddress>;
  try {
    recipientLock = helpers.parseAddress(toAddress, { config: cfg });
  } catch (error) {
    throw new WithdrawalExecutionError(
      `invalid CKB destination address: ${normalizeErrorMessage(error)}`,
      "permanent",
      { cause: error },
    );
  }

  return helpers.minimalCellCapacity({
    cellOutput: {
      capacity: "0x0",
      lock: recipientLock,
    },
    data: "0x",
  });
}

async function submitCkbTransfer(args: ExecuteWithdrawalArgs): Promise<{ txHash: string }> {
  if (args.asset !== "CKB") {
    throw new WithdrawalExecutionError(
      "on-chain withdrawal supports only CKB asset currently",
      "permanent",
    );
  }

  const { cfg, isTestnet } = resolveCkbNetworkConfig(args.toAddress);
  const amountShannons = parseCkbAmountToShannons(args.amount);
  const privateKey = resolvePrivateKey();
  const feeRateShannonsPerKb = resolveFeeRateShannonsPerKb();
  const rpcUrl = resolveCkbRpcUrl(isTestnet);
  const indexerUrl = resolveIndexerUrl(rpcUrl, isTestnet);

  config.initializeConfig(cfg);

  const recipientMinimumShannons = getCkbAddressMinCellCapacityShannons(args.toAddress);
  const policyMinimumShannons = resolvePolicyMinimumShannons();
  const requiredMinimumShannons =
    policyMinimumShannons > recipientMinimumShannons ? policyMinimumShannons : recipientMinimumShannons;

  if (amountShannons < requiredMinimumShannons) {
    throw new WithdrawalExecutionError(
      `withdrawal amount ${args.amount} CKB is below required minimum ${shannonsToCkbDecimal(requiredMinimumShannons)} CKB`,
      "permanent",
    );
  }

  const fromAddress = helpers.encodeToConfigAddress(
    hd.key.privateKeyToBlake160(privateKey),
    "SECP256K1_BLAKE160",
    { config: cfg },
  );

  const indexer = new Indexer(indexerUrl, rpcUrl);
  let txSkeleton = helpers.TransactionSkeleton({ cellProvider: indexer });
  txSkeleton = await commons.common.transfer(
    txSkeleton,
    [fromAddress],
    args.toAddress,
    BI.from(amountShannons),
    fromAddress,
  );
  txSkeleton = await commons.common.payFeeByFeeRate(
    txSkeleton,
    [fromAddress],
    BI.from(feeRateShannonsPerKb),
  );
  txSkeleton = commons.common.prepareSigningEntries(txSkeleton);

  const signingEntries = txSkeleton.get("signingEntries").toArray();
  if (signingEntries.length === 0) {
    throw new WithdrawalExecutionError("withdrawal transaction has no signing entries", "permanent");
  }

  const signatures = signingEntries.map((entry) => hd.key.signRecoverable(entry.message, privateKey));
  const signedTx = helpers.sealTransaction(txSkeleton, signatures);

  const rpc = new RPC(rpcUrl) as unknown as {
    sendTransaction: (tx: unknown, outputsValidator?: "default" | "passthrough") => Promise<string>;
  };
  const txHash = await rpc.sendTransaction(signedTx, "passthrough");
  if (typeof txHash !== "string" || !txHash) {
    throw new WithdrawalExecutionError("sendTransaction returned empty tx hash", "transient");
  }

  return { txHash };
}

export async function executeCkbOnchainWithdrawal(args: ExecuteWithdrawalArgs): Promise<{ txHash: string }> {
  try {
    return await submitCkbTransfer(args);
  } catch (error) {
    if (error instanceof WithdrawalExecutionError) {
      throw error;
    }

    throw new WithdrawalExecutionError(normalizeErrorMessage(error), classifyUnknownRuntimeError(error), {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
