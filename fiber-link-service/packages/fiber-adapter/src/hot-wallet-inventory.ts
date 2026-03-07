import { Indexer, config, hd, helpers } from "@ckb-lumos/lumos";
import { shannonsToCkbDecimal } from "./ckb-onchain-withdrawal";
import type { CkbNetwork, GetHotWalletInventoryArgs, HotWalletInventory } from "./types";

export type HotWalletCell = {
  capacity: string;
  data?: string;
};

export type GetHotWalletInventoryDeps = {
  getNativeCells: (network: CkbNetwork) => Promise<readonly HotWalletCell[]>;
  getUsdiCells: (network: CkbNetwork) => Promise<readonly HotWalletCell[]>;
  getUsdiDecimals: (network: CkbNetwork) => Promise<number> | number;
  estimateUsdiFeeShannons?: (network: CkbNetwork, cells: readonly HotWalletCell[]) => Promise<string> | string;
};

const DEFAULT_TESTNET_CKB_RPC_URL = "https://testnet.ckbapp.dev/";

function resolveWithdrawalPrivateKey(): string {
  const raw = process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error("FIBER_WITHDRAWAL_CKB_PRIVATE_KEY is required for hot wallet inventory");
  }
  const normalized = raw.startsWith("0x") || raw.startsWith("0X") ? `0x${raw.slice(2)}` : `0x${raw}`;
  if (!/^0x[0-9a-fA-F]{64}$/.test(normalized)) {
    throw new Error("FIBER_WITHDRAWAL_CKB_PRIVATE_KEY must be a 32-byte hex private key");
  }
  return normalized.toLowerCase();
}

function resolveCkbRpcUrl(network: CkbNetwork): string {
  const explicit = process.env.FIBER_WITHDRAWAL_CKB_RPC_URL?.trim();
  if (explicit) {
    return explicit;
  }
  if (network === "AGGRON4") {
    return process.env.FIBER_WITHDRAWAL_CKB_RPC_URL_TESTNET?.trim() || DEFAULT_TESTNET_CKB_RPC_URL;
  }
  const mainnetUrl = process.env.FIBER_WITHDRAWAL_CKB_RPC_URL_MAINNET?.trim();
  if (mainnetUrl) {
    return mainnetUrl;
  }
  throw new Error("FIBER_WITHDRAWAL_CKB_RPC_URL is required for mainnet hot wallet inventory");
}

function resolveIndexerUrl(network: CkbNetwork, rpcUrl: string): string {
  const explicit = process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL?.trim();
  if (explicit) {
    return explicit;
  }
  if (network === "AGGRON4") {
    return process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL_TESTNET?.trim() || rpcUrl;
  }
  return process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL_MAINNET?.trim() || rpcUrl;
}

function resolveNetworkConfig(network: CkbNetwork) {
  return network === "AGGRON4" ? config.predefined.AGGRON4 : config.predefined.LINA;
}

function parseQuantity(value: string): bigint {
  const trimmed = value.trim();
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return BigInt(trimmed);
  }
  if (/^[0-9]+$/.test(trimmed)) {
    return BigInt(trimmed);
  }
  throw new Error(`invalid quantity: ${value}`);
}

function normalizeDecimals(value: number): number {
  if (!Number.isInteger(value) || value < 0) {
    throw new Error(`invalid decimals: ${value}`);
  }
  return value;
}

function formatAssetAmount(amount: bigint, decimals: number): string {
  if (decimals === 0) {
    return amount.toString();
  }

  const scale = 10n ** BigInt(decimals);
  const integerPart = amount / scale;
  const fractionPart = amount % scale;
  if (fractionPart === 0n) {
    return integerPart.toString();
  }

  return `${integerPart}.${fractionPart.toString().padStart(decimals, "0").replace(/0+$/, "")}`;
}

function sumCellCapacities(cells: readonly HotWalletCell[]): bigint {
  return cells.reduce((total, cell) => total + parseQuantity(cell.capacity), 0n);
}

function parseXudtAmount(data: string | undefined): bigint {
  if (typeof data !== "string" || !/^0x[0-9a-f]*$/i.test(data)) {
    throw new Error("xUDT cell data must be a hex string");
  }

  const hex = data.slice(2);
  if (hex.length < 32 || hex.length % 2 !== 0) {
    throw new Error("xUDT cell data must contain at least 16 bytes");
  }

  let amount = 0n;
  // xUDT stores the amount in the first 16 bytes as little-endian u128.
  for (let offset = 0; offset < 16; offset += 1) {
    const byteHex = hex.slice(offset * 2, offset * 2 + 2);
    amount += BigInt(`0x${byteHex}`) << BigInt(offset * 8);
  }
  return amount;
}

function sumXudtAmounts(cells: readonly HotWalletCell[]): bigint {
  return cells.reduce((total, cell) => total + parseXudtAmount(cell.data), 0n);
}

export async function getHotWalletInventory(
  { asset, network }: GetHotWalletInventoryArgs,
  deps: GetHotWalletInventoryDeps,
): Promise<HotWalletInventory> {
  if (asset === "CKB") {
    const nativeCells = await deps.getNativeCells(network);
    return {
      asset,
      network,
      availableAmount: shannonsToCkbDecimal(sumCellCapacities(nativeCells)),
    };
  }

  const usdiCells = await deps.getUsdiCells(network);
  if (typeof deps.getUsdiDecimals !== "function") {
    throw new Error("getUsdiDecimals is required for USDI inventory");
  }
  const usdiDecimals = normalizeDecimals(await deps.getUsdiDecimals(network));
  const feeShannons = deps.estimateUsdiFeeShannons
    ? parseQuantity(await deps.estimateUsdiFeeShannons(network, usdiCells))
    : 0n;

  return {
    asset,
    network,
    availableAmount: formatAssetAmount(sumXudtAmounts(usdiCells), usdiDecimals),
    supportingCkbAmount: shannonsToCkbDecimal(sumCellCapacities(usdiCells) + feeShannons),
  };
}

async function collectDefaultNativeCells(network: CkbNetwork): Promise<readonly HotWalletCell[]> {
  const cfg = resolveNetworkConfig(network);
  config.initializeConfig(cfg);
  const privateKey = resolveWithdrawalPrivateKey();
  const rpcUrl = resolveCkbRpcUrl(network);
  const indexerUrl = resolveIndexerUrl(network, rpcUrl);
  const fromAddress = helpers.encodeToConfigAddress(
    hd.key.privateKeyToBlake160(privateKey),
    "SECP256K1_BLAKE160",
    { config: cfg },
  );
  const lock = helpers.parseAddress(fromAddress, { config: cfg });
  const indexer = new Indexer(indexerUrl, rpcUrl);

  const cells: HotWalletCell[] = [];
  for await (const cell of indexer.collector({ lock, type: "empty" }).collect()) {
    cells.push({
      capacity: cell.cellOutput.capacity,
      data: cell.data,
    });
  }
  return cells;
}

export function createDefaultHotWalletInventoryProvider() {
  return async (args: GetHotWalletInventoryArgs): Promise<HotWalletInventory> => {
    if (args.asset !== "CKB") {
      throw new Error("default hot wallet inventory provider currently supports only CKB");
    }

    return getHotWalletInventory(args, {
      getNativeCells: collectDefaultNativeCells,
      getUsdiCells: async () => {
        throw new Error("default hot wallet inventory provider currently supports only CKB");
      },
      getUsdiDecimals: () => {
        throw new Error("default hot wallet inventory provider currently supports only CKB");
      },
    });
  };
}
