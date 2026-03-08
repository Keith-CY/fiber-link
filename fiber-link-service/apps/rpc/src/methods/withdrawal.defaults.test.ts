import { beforeEach, describe, expect, it, vi } from "vitest";

async function setupWithdrawalModule() {
  vi.resetModules();

  const db = await import("@fiber-link/db");
  const adapterPkg = await import("@fiber-link/fiber-adapter");

  const withdrawalRepo = db.createInMemoryWithdrawalRepo();
  const ledgerRepo = db.createInMemoryLedgerRepo();
  const liquidityRequestRepo = db.createInMemoryLiquidityRequestRepo();

  vi.spyOn(db, "createDbClient").mockReturnValue({} as never);
  vi.spyOn(db, "createDbWithdrawalRepo").mockReturnValue(withdrawalRepo as never);
  vi.spyOn(db, "createDbLedgerRepo").mockReturnValue(ledgerRepo as never);
  vi.spyOn(db, "createDbLiquidityRequestRepo").mockReturnValue(liquidityRequestRepo as never);
  vi.spyOn(db, "createDbWithdrawalPolicyRepo").mockImplementation(() => {
    throw new Error("policy repo unavailable");
  });
  const provider = vi.fn(async () => ({
    asset: "CKB" as const,
    network: "AGGRON4" as const,
    availableAmount: "0",
  }));
  const createDefaultHotWalletInventoryProvider = vi
    .spyOn(adapterPkg, "createDefaultHotWalletInventoryProvider")
    .mockReturnValue(provider as never);

  const withdrawalModule = await import("./withdrawal");

  return {
    ...withdrawalModule,
    ledgerRepo,
    withdrawalRepo,
    liquidityRequestRepo,
    createDefaultHotWalletInventoryProvider,
  };
}

describe("withdrawal defaults", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = `0x${"11".repeat(32)}`;
  });

  it("uses default hot wallet inventory and liquidity repo for CKB address withdrawals", async () => {
    const {
      requestWithdrawal,
      ledgerRepo,
      withdrawalRepo,
      liquidityRequestRepo,
      createDefaultHotWalletInventoryProvider,
    } = await setupWithdrawalModule();

    await ledgerRepo.creditOnce({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "100",
      refId: "t1",
      idempotencyKey: "credit:t1",
    });

    const result = await requestWithdrawal({
      appId: "app1",
      userId: "u1",
      asset: "CKB",
      amount: "61",
      destination: {
        kind: "CKB_ADDRESS",
        address: "ckt1qyqfth8m4fevfzh5hhd088s78qcdjjp8cehs7z8jhw",
      },
    });

    expect(result.state).toBe("LIQUIDITY_PENDING");
    expect(createDefaultHotWalletInventoryProvider).toHaveBeenCalledTimes(1);
    expect(liquidityRequestRepo.__listForTests?.()).toHaveLength(1);
    expect((await withdrawalRepo.findByIdOrThrow(result.id)).liquidityRequestId).toBeTruthy();
  });
});
