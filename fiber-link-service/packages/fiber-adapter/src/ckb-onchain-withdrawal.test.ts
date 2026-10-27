import { afterEach, describe, expect, it, vi } from "vitest";

describe("executeCkbOnchainWithdrawal", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;
    delete process.env.FIBER_WITHDRAWAL_CKB_FEE_RATE_SHANNONS_PER_KB;
    delete process.env.FIBER_WITHDRAWAL_CKB_MIN_SHANNONS;
    delete process.env.FIBER_WITHDRAWAL_CKB_RPC_URL;
    delete process.env.FIBER_WITHDRAWAL_CKB_RPC_URL_TESTNET;
    delete process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL;
    delete process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL_TESTNET;
  });

  async function setupLumosMocks(transferImpl?: () => unknown) {
    const mocks = {
      sendTransaction: vi.fn(),
      transfer: vi.fn(),
      payFeeByFeeRate: vi.fn(),
      prepareSigningEntries: vi.fn(),
      initializeConfig: vi.fn(),
      parseAddress: vi.fn(),
      minimalCellCapacity: vi.fn(),
      encodeToConfigAddress: vi.fn(),
      privateKeyToBlake160: vi.fn(),
      signRecoverable: vi.fn(),
      sealTransaction: vi.fn(),
      transactionSkeleton: vi.fn(),
      biFrom: vi.fn((value: bigint) => value),
      ckbHash: vi.fn(),
      packRawTransaction: vi.fn(),
    };

    vi.doMock("@ckb-lumos/lumos/codec", () => ({
      blockchain: { RawTransaction: { pack: mocks.packRawTransaction } },
    }));

    vi.doMock("@ckb-lumos/lumos", () => {
      class MockIndexer {}

      class MockRPC {
        sendTransaction = mocks.sendTransaction;
      }

      return {
        BI: { from: mocks.biFrom },
        Indexer: MockIndexer,
        RPC: MockRPC,
        commons: {
          common: {
            transfer: mocks.transfer,
            payFeeByFeeRate: mocks.payFeeByFeeRate,
            prepareSigningEntries: mocks.prepareSigningEntries,
          },
        },
        config: {
          predefined: {
            AGGRON4: { PREFIX: "ckt" },
            LINA: { PREFIX: "ckb" },
          },
          initializeConfig: mocks.initializeConfig,
        },
        hd: {
          key: {
            privateKeyToBlake160: mocks.privateKeyToBlake160,
            signRecoverable: mocks.signRecoverable,
          },
        },
        helpers: {
          parseAddress: mocks.parseAddress,
          minimalCellCapacity: mocks.minimalCellCapacity,
          encodeToConfigAddress: mocks.encodeToConfigAddress,
          TransactionSkeleton: mocks.transactionSkeleton,
          sealTransaction: mocks.sealTransaction,
        },
        utils: { ckbHash: mocks.ckbHash },
      };
    });

    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = `0x${"11".repeat(32)}`;

    const signingEntries = [{ message: "0xmessage" }];
    const txSkeleton = {
      get: vi.fn().mockReturnValue({
        toArray: () => signingEntries,
      }),
    };
    const signedTx = { tx: "signed" };

    mocks.transactionSkeleton.mockReturnValue(txSkeleton);
    if (transferImpl) {
      mocks.transfer.mockImplementation(async () => transferImpl());
    } else {
      mocks.transfer.mockResolvedValue(txSkeleton);
    }
    mocks.payFeeByFeeRate.mockResolvedValue(txSkeleton);
    mocks.prepareSigningEntries.mockReturnValue(txSkeleton);
    mocks.parseAddress.mockReturnValue({ code_hash: "0x1", hash_type: "type", args: "0x2" });
    mocks.minimalCellCapacity.mockReturnValue(1n);
    mocks.privateKeyToBlake160.mockReturnValue("0xblake160");
    mocks.encodeToConfigAddress.mockReturnValue("ckt1from");
    mocks.signRecoverable.mockReturnValue("0xsig");
    mocks.sealTransaction.mockReturnValue(signedTx);
    mocks.packRawTransaction.mockReturnValue(new Uint8Array([1]));
    mocks.ckbHash.mockReturnValue("0xtxhash");
    mocks.sendTransaction.mockResolvedValue("0xtxhash");

    const mod = await import("./ckb-onchain-withdrawal");
    return { ...mod, mocks, signedTx };
  }

  it("submits signed tx with rpc.sendTransaction", async () => {
    const { executeCkbOnchainWithdrawal, mocks, signedTx } = await setupLumosMocks();

    const result = await executeCkbOnchainWithdrawal({
      amount: "61",
      asset: "CKB",
      destination: {
        kind: "CKB_ADDRESS",
        address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
      },
      requestId: "w-ckb-1",
    });

    expect(result).toEqual({ txHash: "0xtxhash" });
    expect(mocks.sendTransaction).toHaveBeenCalledWith(signedTx, "passthrough");
  });

  it("maps upstream JSON-RPC internal errors to transient execution kind", async () => {
    const { executeCkbOnchainWithdrawal } = await setupLumosMocks(() => {
      throw { code: -32603, message: "internal error" };
    });

    await expect(
      executeCkbOnchainWithdrawal({
        amount: "61",
        asset: "CKB",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
        },
        requestId: "w-ckb-2",
      }),
    ).rejects.toMatchObject({
      kind: "transient",
    });
  });

  it("maps upstream JSON-RPC invalid params errors to permanent execution kind", async () => {
    const { executeCkbOnchainWithdrawal } = await setupLumosMocks(() => {
      throw { code: -32602, message: "invalid params" };
    });

    await expect(
      executeCkbOnchainWithdrawal({
        amount: "61",
        asset: "CKB",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
        },
        requestId: "w-ckb-3",
      }),
    ).rejects.toMatchObject({
      kind: "permanent",
    });
  });

  it("persists the locally computed tx hash before broadcasting", async () => {
    const { executeCkbOnchainWithdrawal, mocks, signedTx } = await setupLumosMocks();
    const order: string[] = [];
    const beforeBroadcast = vi.fn(async (txHash: string) => {
      order.push(`persist:${txHash}`);
    });
    mocks.sendTransaction.mockImplementation(async () => {
      order.push("send");
      return "0xtxhash";
    });

    await executeCkbOnchainWithdrawal({
      amount: "61",
      asset: "CKB",
      destination: {
        kind: "CKB_ADDRESS",
        address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
      },
      requestId: "w-ckb-4",
      beforeBroadcast,
    });

    expect(mocks.packRawTransaction).toHaveBeenCalledWith(signedTx);
    expect(order).toEqual(["persist:0xtxhash", "send"]);
  });

  it("does not broadcast when persisting the tx hash fails", async () => {
    const { executeCkbOnchainWithdrawal, mocks } = await setupLumosMocks();

    await expect(
      executeCkbOnchainWithdrawal({
        amount: "61",
        asset: "CKB",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
        },
        requestId: "w-ckb-5",
        beforeBroadcast: async () => {
          throw Object.assign(new Error("connect ECONNREFUSED db"), { code: "ECONNREFUSED" });
        },
      }),
    ).rejects.toMatchObject({ kind: "transient" });
    expect(mocks.sendTransaction).not.toHaveBeenCalled();
  });

  it("treats a broadcast timeout as transient, not permanent", async () => {
    const { executeCkbOnchainWithdrawal, mocks } = await setupLumosMocks();
    // lumos RPC aborts the fetch on timeout; the node may still have accepted the tx.
    mocks.sendTransaction.mockRejectedValue(
      Object.assign(new Error("The user aborted a request."), { name: "AbortError" }),
    );

    await expect(
      executeCkbOnchainWithdrawal({
        amount: "61",
        asset: "CKB",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
        },
        requestId: "w-ckb-6",
        beforeBroadcast: async () => {},
      }),
    ).rejects.toMatchObject({ kind: "transient" });
  });

  it("keeps an explicit node rejection of the broadcast permanent", async () => {
    const { executeCkbOnchainWithdrawal, mocks } = await setupLumosMocks();
    // lumos RPC surfaces a JSON-RPC error response as ResponseException(JSON.stringify(error)).
    mocks.sendTransaction.mockRejectedValue(
      Object.assign(
        new Error(JSON.stringify({ code: -1104, message: "PoolRejectedTransactionByMinFeeRate", data: null })),
        { code: 204 },
      ),
    );

    await expect(
      executeCkbOnchainWithdrawal({
        amount: "61",
        asset: "CKB",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
        },
        requestId: "w-ckb-7",
        beforeBroadcast: async () => {},
      }),
    ).rejects.toMatchObject({ kind: "permanent" });
  });
});
