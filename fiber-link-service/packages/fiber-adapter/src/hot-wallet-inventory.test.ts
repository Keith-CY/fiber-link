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
    getUsdiDecimals: async () => 0,
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

  it("formats USDI availableAmount as a canonical decimal asset-unit string when decimals are configured", async () => {
    const inventory = await getHotWalletInventory(
      { asset: "USDI", network: "AGGRON4" },
      {
        ...deps,
        getUsdiDecimals: async () => 2,
        getUsdiCells: async () => [{ capacity: ckbToHexShannons(61n), data: encodeUdtAmount(550n) }],
      },
    );

    expect(inventory.availableAmount).toBe("5.5");
    expect(inventory.supportingCkbAmount).toBe("62");
  });

  it("uses zero supporting fee when estimateUsdiFeeShannons is omitted", async () => {
    const { estimateUsdiFeeShannons: _estimateUsdiFeeShannons, ...depsWithoutFee } = deps;
    const inventory = await getHotWalletInventory({ asset: "USDI", network: "AGGRON4" }, depsWithoutFee);

    expect(inventory.availableAmount).toBe("500");
    expect(inventory.supportingCkbAmount).toBe("119");
  });

  it("throws when USDI decimals dependency is missing", async () => {
    const { getUsdiDecimals: _getUsdiDecimals, ...depsWithoutDecimals } = deps;

    await expect(
      getHotWalletInventory(
        { asset: "USDI", network: "AGGRON4" },
        depsWithoutDecimals as Parameters<typeof getHotWalletInventory>[1],
      ),
    ).rejects.toThrow("getUsdiDecimals is required for USDI inventory");
  });

  it("throws when USDI decimals are negative", async () => {
    await expect(
      getHotWalletInventory(
        { asset: "USDI", network: "AGGRON4" },
        {
          ...deps,
          getUsdiDecimals: async () => -1,
        },
      ),
    ).rejects.toThrow("invalid decimals: -1");
  });

  it("throws when USDI decimals are not integers", async () => {
    await expect(
      getHotWalletInventory(
        { asset: "USDI", network: "AGGRON4" },
        {
          ...deps,
          getUsdiDecimals: async () => 1.5,
        },
      ),
    ).rejects.toThrow("invalid decimals: 1.5");
  });

  it("throws when a cell capacity is malformed", async () => {
    await expect(
      getHotWalletInventory(
        { asset: "CKB", network: "AGGRON4" },
        {
          ...deps,
          getNativeCells: async () => [{ capacity: "not-a-quantity" }],
        },
      ),
    ).rejects.toThrow("invalid quantity: not-a-quantity");
  });

  it("throws when xUDT data is malformed", async () => {
    await expect(
      getHotWalletInventory(
        { asset: "USDI", network: "AGGRON4" },
        {
          ...deps,
          getUsdiCells: async () => [{ capacity: ckbToHexShannons(61n), data: "0x01" }],
        },
      ),
    ).rejects.toThrow("xUDT cell data must contain at least 16 bytes");
  });
});
