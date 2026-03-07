import type { CkbNetwork, GetHotWalletInventoryArgs, HotWalletInventory } from "./types";

const SHANNONS_PER_CKB = 100_000_000n;

export type HotWalletCell = {
  capacity: string;
  data?: string;
};

export type GetHotWalletInventoryDeps = {
  getNativeCells: (network: CkbNetwork) => Promise<readonly HotWalletCell[]>;
  getUsdiCells: (network: CkbNetwork) => Promise<readonly HotWalletCell[]>;
  estimateUsdiFeeShannons?: (network: CkbNetwork, cells: readonly HotWalletCell[]) => Promise<string> | string;
};

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

function shannonsToCkbDecimal(shannons: bigint): string {
  const integerPart = shannons / SHANNONS_PER_CKB;
  const fractionPart = shannons % SHANNONS_PER_CKB;
  if (fractionPart === 0n) {
    return integerPart.toString();
  }

  return `${integerPart}.${fractionPart.toString().padStart(8, "0").replace(/0+$/, "")}`;
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
  const feeShannons = deps.estimateUsdiFeeShannons
    ? parseQuantity(await deps.estimateUsdiFeeShannons(network, usdiCells))
    : 0n;

  return {
    asset,
    network,
    availableAmount: sumXudtAmounts(usdiCells).toString(),
    supportingCkbAmount: shannonsToCkbDecimal(sumCellCapacities(usdiCells) + feeShannons),
  };
}
