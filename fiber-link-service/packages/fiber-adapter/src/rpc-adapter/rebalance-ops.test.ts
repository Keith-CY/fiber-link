import { afterEach, describe, expect, it, vi } from "vitest";

const rpcCallMock = vi.fn();
const executeTransferMock = vi.fn();
const getTransactionStatusMock = vi.fn();
const resolveHotWalletAddressMock = vi.fn();
const normalizeCkbPrivateKeyMock = vi.fn((value: string) => value);

class MockFiberRpcError extends Error {
  code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

vi.mock("../fiber-client", () => ({
  FiberRpcError: MockFiberRpcError,
  rpcCall: rpcCallMock,
}));

vi.mock("../ckb-onchain-withdrawal", () => ({
  executeCkbOnchainTransfer: executeTransferMock,
  getCkbTransactionStatus: getTransactionStatusMock,
  normalizeCkbPrivateKey: normalizeCkbPrivateKeyMock,
  resolveHotWalletAddress: resolveHotWalletAddressMock,
}));

describe("rebalance-ops local CKB liquidity fallback", () => {
  const originalSourceKey = process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY;
  const originalWithdrawalKey = process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;

  afterEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    if (originalSourceKey === undefined) {
      delete process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY;
    } else {
      process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY = originalSourceKey;
    }

    if (originalWithdrawalKey === undefined) {
      delete process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;
    } else {
      process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = originalWithdrawalKey;
    }
  });

  it("reports local direct rebalance support when source and hot-wallet keys are configured", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    const mod = await import("./rebalance-ops");

    expect(mod.hasLocalChainLiquiditySweepSupport()).toBe(true);
  });

  it("falls back to a local sweep into the hot wallet when rebalance rpc is unsupported", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    const result = await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-1",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "62.5",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    expect(result).toEqual({ state: "PENDING", started: true });
    expect(resolveHotWalletAddressMock).toHaveBeenCalledWith("AGGRON4");
    expect(executeTransferMock).toHaveBeenCalledWith({
      amount: "62.5",
      destination: { kind: "CKB_ADDRESS", address: "ckt1qhotwallet" },
      network: "AGGRON4",
      privateKey: "0x2222222222222222222222222222222222222222222222222222222222222222",
      requestId: "liq-1",
    });
  });

  it("tracks local sweep transaction status by request id", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });
    getTransactionStatusMock.mockResolvedValueOnce("PENDING").mockResolvedValueOnce("COMMITTED");

    const { ensureChainLiquidity, getRebalanceStatus } = await import("./rebalance-ops");
    await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-1",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "62.5",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-1" })).resolves.toEqual({
      state: "PENDING",
    });
    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-1" })).resolves.toEqual({
      state: "FUNDED",
    });
  });
});
