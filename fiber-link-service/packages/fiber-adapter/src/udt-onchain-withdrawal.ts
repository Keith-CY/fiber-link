import { BI, Indexer, RPC, commons, config, hd, helpers } from "@ckb-lumos/lumos";
import {
  WithdrawalExecutionError,
  classifyUnknownRuntimeError,
  normalizeErrorMessage,
  resolveCkbNetworkConfig,
  resolveCkbRpcUrl,
  resolveFeeRateShannonsPerKb,
  resolveIndexerUrl,
  resolvePrivateKey,
  type LumosConfig,
} from "./ckb-onchain-withdrawal";
import type { ExecuteWithdrawalArgs, UdtTypeScript } from "./types";

function normalizeHexLike(input: string): string {
  const normalized = input.trim().toLowerCase();
  if (!/^0x[0-9a-f]+$/.test(normalized) || normalized.length % 2 !== 0) {
    throw new WithdrawalExecutionError(`invalid hex field: ${input}`, "permanent");
  }
  return normalized;
}

function normalizeUdtTypeScript(value: unknown): UdtTypeScript {
  if (!value || typeof value !== "object") {
    throw new WithdrawalExecutionError("USDI UDT type script config must be an object", "permanent");
  }

  const record = value as Record<string, unknown>;
  const codeHash = typeof record.codeHash === "string" ? record.codeHash : record.code_hash;
  const hashType = typeof record.hashType === "string" ? record.hashType : record.hash_type;
  const args = record.args;
  if (typeof codeHash !== "string" || typeof hashType !== "string" || typeof args !== "string") {
    throw new WithdrawalExecutionError(
      "FIBER_USDI_UDT_TYPE_SCRIPT_JSON must include code_hash/hash_type/args",
      "permanent",
    );
  }

  return {
    codeHash: normalizeHexLike(codeHash),
    hashType: hashType.trim(),
    args: normalizeHexLike(args),
  };
}

function resolveUsdiUdtTypeScript(args: ExecuteWithdrawalArgs): UdtTypeScript {
  if (args.udtTypeScript) {
    return normalizeUdtTypeScript(args.udtTypeScript);
  }

  const raw = process.env.FIBER_USDI_UDT_TYPE_SCRIPT_JSON?.trim();
  if (!raw) {
    throw new WithdrawalExecutionError("FIBER_USDI_UDT_TYPE_SCRIPT_JSON is required for USDI on-chain withdrawal", "permanent");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new WithdrawalExecutionError("FIBER_USDI_UDT_TYPE_SCRIPT_JSON must be valid JSON", "permanent");
  }
  return normalizeUdtTypeScript(parsed);
}

function resolveUsdiDecimals(): number {
  const raw = process.env.FIBER_USDI_UDT_DECIMALS?.trim();
  if (!raw) {
    throw new WithdrawalExecutionError("FIBER_USDI_UDT_DECIMALS is required for USDI on-chain withdrawal", "permanent");
  }
  if (!/^\d+$/.test(raw)) {
    throw new WithdrawalExecutionError("FIBER_USDI_UDT_DECIMALS must be a non-negative integer", "permanent");
  }
  return Number(raw);
}

function parseAmountToUdtUnits(amount: string, decimals: number): bigint {
  const trimmed = amount.trim();
  if (!/^\d+(?:\.\d+)?$/.test(trimmed)) {
    throw new WithdrawalExecutionError(`invalid USDI amount: ${amount}`, "permanent");
  }

  const [intPartRaw, fracPartRaw = ""] = trimmed.split(".");
  if (fracPartRaw.length > decimals) {
    throw new WithdrawalExecutionError(
      `USDI amount supports at most ${decimals} decimal places, received: ${amount}`,
      "permanent",
    );
  }

  const intPart = BigInt(intPartRaw);
  const fracPart = fracPartRaw.padEnd(decimals, "0");
  const scale = 10n ** BigInt(decimals);
  const fracValue = fracPart ? BigInt(fracPart) : 0n;
  const amountUnits = intPart * scale + fracValue;
  if (amountUnits <= 0n) {
    throw new WithdrawalExecutionError(`withdrawal amount must be greater than 0, received: ${amount}`, "permanent");
  }
  return amountUnits;
}

function buildUsdiLumosConfig(baseCfg: LumosConfig, udtTypeScript: UdtTypeScript): LumosConfig {
  const sudtScript = baseCfg.SCRIPTS.SUDT;
  if (!sudtScript) {
    throw new WithdrawalExecutionError("provided CKB network config does not define an SUDT script", "permanent");
  }

  return {
    ...baseCfg,
    SCRIPTS: {
      ...baseCfg.SCRIPTS,
      SUDT: {
        ...sudtScript,
        CODE_HASH: udtTypeScript.codeHash,
        HASH_TYPE: udtTypeScript.hashType,
      },
    },
  };
}

async function submitUdtTransfer(args: ExecuteWithdrawalArgs): Promise<{ txHash: string }> {
  if (args.asset !== "USDI") {
    throw new WithdrawalExecutionError("xUDT on-chain withdrawal supports only USDI asset currently", "permanent");
  }

  if (args.destination.kind !== "CKB_ADDRESS") {
    throw new WithdrawalExecutionError("xUDT on-chain withdrawal requires CKB_ADDRESS destination kind", "permanent");
  }

  const toAddress = args.destination.address;
  const { cfg: baseCfg, isTestnet } = resolveCkbNetworkConfig(toAddress);
  const udtTypeScript = resolveUsdiUdtTypeScript(args);
  const cfg = buildUsdiLumosConfig(baseCfg, udtTypeScript);
  const amountUnits = parseAmountToUdtUnits(args.amount, resolveUsdiDecimals());
  const privateKey = resolvePrivateKey();
  const feeRateShannonsPerKb = resolveFeeRateShannonsPerKb();
  const rpcUrl = resolveCkbRpcUrl(isTestnet);
  const indexerUrl = resolveIndexerUrl(rpcUrl, isTestnet);

  config.initializeConfig(cfg);

  const fromAddress = helpers.encodeToConfigAddress(
    hd.key.privateKeyToBlake160(privateKey),
    "SECP256K1_BLAKE160",
    { config: cfg },
  );

  const indexer = new Indexer(indexerUrl, rpcUrl);
  let txSkeleton = helpers.TransactionSkeleton({ cellProvider: indexer });
  txSkeleton = await commons.sudt.transfer(
    txSkeleton,
    [fromAddress],
    udtTypeScript.args,
    toAddress,
    BI.from(amountUnits),
    fromAddress,
    undefined,
    undefined,
    { config: cfg },
  );
  txSkeleton = await commons.common.payFeeByFeeRate(
    txSkeleton,
    [fromAddress],
    BI.from(feeRateShannonsPerKb),
    undefined,
    { config: cfg },
  );
  txSkeleton = commons.common.prepareSigningEntries(txSkeleton);

  const signingEntries = txSkeleton.get("signingEntries").toArray();
  if (signingEntries.length === 0) {
    throw new WithdrawalExecutionError("withdrawal transaction has no signing entries", "permanent");
  }

  const signatures = signingEntries.map((entry: { message: string }) =>
    hd.key.signRecoverable(entry.message, privateKey),
  );
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

export async function executeUdtOnchainWithdrawal(args: ExecuteWithdrawalArgs): Promise<{ txHash: string }> {
  try {
    return await submitUdtTransfer(args);
  } catch (error) {
    if (error instanceof WithdrawalExecutionError) {
      throw error;
    }

    throw new WithdrawalExecutionError(normalizeErrorMessage(error), classifyUnknownRuntimeError(error), {
      cause: error instanceof Error ? error : undefined,
    });
  }
}
