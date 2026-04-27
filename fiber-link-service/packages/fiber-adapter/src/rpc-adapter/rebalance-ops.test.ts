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
    rpcCallMock.mockReset();
    executeTransferMock.mockReset();
    getTransactionStatusMock.mockReset();
    resolveHotWalletAddressMock.mockReset();
    normalizeCkbPrivateKeyMock.mockReset();
    normalizeCkbPrivateKeyMock.mockImplementation((value: string) => value);

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
      requiredAmount: "62",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    expect(result).toEqual({
      state: "PENDING",
      started: true,
      txHash: "0xsweep",
      trackingNetwork: "AGGRON4",
    });
    expect(resolveHotWalletAddressMock).toHaveBeenCalledWith("AGGRON4");
    expect(executeTransferMock).toHaveBeenCalledWith({
      amount: "62",
      destination: { kind: "CKB_ADDRESS", address: "ckt1qhotwallet" },
      network: "AGGRON4",
      privateKey: "0x2222222222222222222222222222222222222222222222222222222222222222",
      requestId: "liq-1",
    });
  });

  it("does not fall back to a local sweep for invalid amount errors", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce(new Error("invalid amount: below channel minimum"));

    const { ensureChainLiquidity } = await import("./rebalance-ops");

    await expect(
      ensureChainLiquidity("http://fnn:8227", {
        requestId: "liq-invalid-amount",
        asset: "CKB",
        network: "AGGRON4",
        requiredAmount: "1",
        sourceKind: "FIBER_TO_CKB_CHAIN",
      }),
    ).rejects.toThrow("invalid amount: below channel minimum");
    expect(executeTransferMock).not.toHaveBeenCalled();
  });

  it("does not hide unauthorized rebalance status errors as unsupported rpc", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce(new Error("unauthorized"));

    const { getRebalanceStatus } = await import("./rebalance-ops");

    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-auth" })).rejects.toThrow("unauthorized");
  });

  it("reuses an in-flight local sweep instead of submitting a duplicate transfer", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });
    getTransactionStatusMock.mockResolvedValueOnce("PENDING");

    const { ensureChainLiquidity } = await import("./rebalance-ops");

    await expect(
      ensureChainLiquidity("http://fnn:8227", {
        requestId: "liq-duplicate",
        asset: "CKB",
        network: "AGGRON4",
        requiredAmount: "62",
        sourceKind: "FIBER_TO_CKB_CHAIN",
      }),
    ).resolves.toEqual({
      state: "PENDING",
      started: true,
      txHash: "0xsweep",
      trackingNetwork: "AGGRON4",
    });

    await expect(
      ensureChainLiquidity("http://fnn:8227", {
        requestId: "liq-duplicate",
        asset: "CKB",
        network: "AGGRON4",
        requiredAmount: "62",
        sourceKind: "FIBER_TO_CKB_CHAIN",
      }),
    ).resolves.toEqual({
      state: "PENDING",
      started: false,
      txHash: "0xsweep",
      trackingNetwork: "AGGRON4",
    });

    expect(executeTransferMock).toHaveBeenCalledTimes(1);
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
      requiredAmount: "62",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-1" })).resolves.toEqual({
      state: "PENDING",
    });
    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-1" })).resolves.toEqual({
      state: "FUNDED",
    });
  });

  it("can resume local sweep status tracking from persisted tx metadata", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    getTransactionStatusMock.mockResolvedValueOnce("COMMITTED");

    const { getRebalanceStatus } = await import("./rebalance-ops");

    await expect(
      getRebalanceStatus("http://fnn:8227", {
        requestId: "liq-restart",
        txHash: "0xpersisted",
        network: "AGGRON4",
      }),
    ).resolves.toEqual({ state: "FUNDED" });
    expect(getTransactionStatusMock).toHaveBeenCalledWith({
      txHash: "0xpersisted",
      network: "AGGRON4",
    });
  });

  it("keeps terminal local sweep status visible for repeated polls in the same process", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });
    getTransactionStatusMock.mockResolvedValueOnce("COMMITTED").mockResolvedValueOnce("COMMITTED");

    const { ensureChainLiquidity, getRebalanceStatus } = await import("./rebalance-ops");

    await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-terminal",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "62",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-terminal" })).resolves.toEqual({
      state: "FUNDED",
    });
    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-terminal" })).resolves.toEqual({
      state: "FUNDED",
    });
  });
});
