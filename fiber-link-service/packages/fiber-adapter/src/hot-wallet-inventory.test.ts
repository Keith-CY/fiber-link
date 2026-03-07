import { describe, expect, it } from "vitest";
import { getHotWalletInventory } from "./hot-wallet-inventory";

function ckbToHexShannons(amount: bigint): string {
  return `0x${(amount * 100_000_000n).toString(16)}`;
}

function encodeUdtAmount(amount: bigint): string {
  const bytes = new Uint8Array(16);
  let remaining = amount;
  for (let index = 0; index < bytes.length; index += 1) {
    bytes[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return `0x${Buffer.from(bytes).toString("hex")}`;
}

describe("getHotWalletInventory", () => {
  const deps = {
    getNativeCells: async () => [{ capacity: ckbToHexShannons(120n) }, { capacity: ckbToHexShannons(80n) }],
    getUsdiCells: async () => [
      { capacity: ckbToHexShannons(61n), data: encodeUdtAmount(200n) },
      { capacity: ckbToHexShannons(58n), data: encodeUdtAmount(300n) },
    ],
    estimateUsdiFeeShannons: async () => (1n * 100_000_000n).toString(),
  };

  it("returns spendable native CKB for the platform hot wallet", async () => {
    const inventory = await getHotWalletInventory({ asset: "CKB", network: "AGGRON4" }, deps);
    expect(inventory.availableAmount).toBe("200");
  });

  it("returns USDI liquidity plus required CKB support capacity", async () => {
    const inventory = await getHotWalletInventory({ asset: "USDI", network: "AGGRON4" }, deps);
    expect(inventory.availableAmount).toBe("500");
    expect(inventory.supportingCkbAmount).toBe("120");
  });
});
