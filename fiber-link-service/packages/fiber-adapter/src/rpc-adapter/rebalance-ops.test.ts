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
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    const mod = await import("./rebalance-ops");

    expect(mod.hasLocalChainLiquiditySweepSupport()).toBe(true);
  });

  it("encodes fractional CKB rebalance amounts as shannons hex before calling Fiber RPC", async () => {
    rpcCallMock.mockResolvedValueOnce({ status: "pending", started: true });

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    const result = await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-fractional-rpc",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "85.00016356",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    expect(result).toEqual({
      state: "PENDING",
      started: true,
    });
    expect(rpcCallMock).toHaveBeenCalledWith(
      "http://fnn:8227",
      "rebalance_to_ckb_chain",
      expect.objectContaining({
        request_id: "liq-fractional-rpc",
        required_amount: "0x1faa3f4e4",
      }),
    );
  });

  it("falls back to a local sweep into the hot wallet when rebalance rpc is unsupported", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    const result = await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-1",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "61.5",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    expect(result).toEqual({
      state: "PENDING",
      started: true,
      recoveryStrategy: "LOCAL_CKB_SWEEP",
      txHash: "0xsweep",
      trackingNetwork: "AGGRON4",
    });
    expect(resolveHotWalletAddressMock).toHaveBeenCalledWith("AGGRON4");
    expect(executeTransferMock).toHaveBeenCalledWith({
      amount: "61.5",
      destination: { kind: "CKB_ADDRESS", address: "ckt1qhotwallet" },
      network: "AGGRON4",
      privateKey: "0x2222222222222222222222222222222222222222222222222222222222222222",
      requestId: "liq-1",
    });
  });

  it("does not fall back to a local sweep for invalid amount errors", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

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
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce(new Error("unauthorized"));

    const { getRebalanceStatus } = await import("./rebalance-ops");

    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-auth" })).rejects.toThrow("unauthorized");
  });

  it("reuses an in-flight local sweep instead of submitting a duplicate transfer", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

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
      recoveryStrategy: "LOCAL_CKB_SWEEP",
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
      recoveryStrategy: "LOCAL_CKB_SWEEP",
      txHash: "0xsweep",
      trackingNetwork: "AGGRON4",
    });

    expect(executeTransferMock).toHaveBeenCalledTimes(1);
  });

  it("tracks local sweep transaction status by request id", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

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
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

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

  it("fails a local sweep after repeated unknown transaction status checks", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });
    getTransactionStatusMock
      .mockResolvedValueOnce("UNKNOWN")
      .mockResolvedValueOnce("UNKNOWN")
      .mockResolvedValueOnce("UNKNOWN");

    const { ensureChainLiquidity, getRebalanceStatus } = await import("./rebalance-ops");

    await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-unknown",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "62",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-unknown" })).resolves.toEqual({
      state: "PENDING",
    });
    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-unknown" })).resolves.toEqual({
      state: "PENDING",
    });
    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-unknown" })).resolves.toEqual({
      state: "FAILED",
      error: "local liquidity sweep transaction 0xsweep stayed unknown for 3 consecutive status checks",
    });
  });

  it("keeps terminal local sweep status visible for repeated polls in the same process", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

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

  it("recognizes a FiberRpcError instance with code -32601 as unsupported", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce(new MockFiberRpcError(-32601, "rpc method missing"));
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    const result = await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-rpc-error-instance",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "62",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    expect(result).toMatchObject({ recoveryStrategy: "LOCAL_CKB_SWEEP", txHash: "0xsweep" });
  });

  it("recognizes an unsupported rpc from a message-only error object", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    // Plain object without a `code`, exercising the message-extraction branch.
    rpcCallMock.mockRejectedValueOnce({ message: "unknown method: rebalance_to_ckb_chain" });
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    const result = await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-msg-only",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "62",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    expect(result).toMatchObject({ recoveryStrategy: "LOCAL_CKB_SWEEP" });
  });

  it("maps a failed rebalance status from the Fiber RPC result", async () => {
    rpcCallMock.mockResolvedValueOnce({ status: "failed", error: "insufficient inbound", started: true });

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    await expect(
      ensureChainLiquidity("http://fnn:8227", {
        requestId: "liq-failed-status",
        asset: "CKB",
        network: "AGGRON4",
        requiredAmount: "62",
        sourceKind: "FIBER_TO_CKB_CHAIN",
      }),
    ).resolves.toEqual({ state: "FAILED", started: true, error: "insufficient inbound" });
  });

  it("treats an unrecognized rebalance status as pending", async () => {
    rpcCallMock.mockResolvedValueOnce({ status: "who-knows" });

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    await expect(
      ensureChainLiquidity("http://fnn:8227", {
        requestId: "liq-idle-status",
        asset: "CKB",
        network: "AGGRON4",
        requiredAmount: "62",
        sourceKind: "FIBER_TO_CKB_CHAIN",
      }),
    ).resolves.toEqual({ state: "PENDING", started: false });
  });

  it("treats a result with no status field as pending", async () => {
    rpcCallMock.mockResolvedValueOnce({});

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    await expect(
      ensureChainLiquidity("http://fnn:8227", {
        requestId: "liq-no-status",
        asset: "CKB",
        network: "AGGRON4",
        requiredAmount: "62",
        sourceKind: "FIBER_TO_CKB_CHAIN",
      }),
    ).resolves.toEqual({ state: "PENDING", started: false });
  });

  it("rethrows a non-Error, non-object rpc rejection unchanged", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    // A primitive rejection exercises the String(error) normalization fallback.
    rpcCallMock.mockRejectedValueOnce("boom");

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    await expect(
      ensureChainLiquidity("http://fnn:8227", {
        requestId: "liq-primitive-error",
        asset: "CKB",
        network: "AGGRON4",
        requiredAmount: "62",
        sourceKind: "FIBER_TO_CKB_CHAIN",
      }),
    ).rejects.toBe("boom");
    expect(executeTransferMock).not.toHaveBeenCalled();
  });

  it("encodes non-CKB rebalance amounts as plain hex and rethrows rpc failures without local fallback", async () => {
    delete process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY;
    delete process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });

    const { ensureChainLiquidity } = await import("./rebalance-ops");
    await expect(
      ensureChainLiquidity("http://fnn:8227", {
        requestId: "liq-usdi",
        asset: "USDI",
        network: "AGGRON4",
        requiredAmount: "100",
        sourceKind: "FIBER_TO_CKB_CHAIN",
      }),
    ).rejects.toMatchObject({ code: -32601 });

    expect(rpcCallMock).toHaveBeenCalledWith(
      "http://fnn:8227",
      "rebalance_to_ckb_chain",
      expect.objectContaining({ required_amount: "0x64" }),
    );
    expect(executeTransferMock).not.toHaveBeenCalled();
  });

  it("reports IDLE from get_rebalance_status when the rpc is unsupported and local sweep is available", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });

    const { getRebalanceStatus } = await import("./rebalance-ops");
    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-no-local-tracking" })).resolves.toEqual({
      state: "IDLE",
    });
  });

  it("marks a local sweep failed when its transaction is rejected on chain", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = "0x1111111111111111111111111111111111111111111111111111111111111111";

    rpcCallMock.mockRejectedValueOnce({ code: -32601, message: "Method not found" });
    resolveHotWalletAddressMock.mockReturnValue("ckt1qhotwallet");
    executeTransferMock.mockResolvedValue({ txHash: "0xsweep" });
    getTransactionStatusMock.mockResolvedValueOnce("REJECTED");

    const { ensureChainLiquidity, getRebalanceStatus } = await import("./rebalance-ops");
    await ensureChainLiquidity("http://fnn:8227", {
      requestId: "liq-rejected",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "62",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    await expect(getRebalanceStatus("http://fnn:8227", { requestId: "liq-rejected" })).resolves.toEqual({
      state: "FAILED",
      error: "local liquidity sweep transaction 0xsweep was rejected",
    });
  });
});
