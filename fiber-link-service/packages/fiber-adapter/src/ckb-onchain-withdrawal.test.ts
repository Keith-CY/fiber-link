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

  it("submits signed tx with rpc.sendTransaction", async () => {
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
    };

    vi.doMock("@ckb-lumos/lumos", () => {
      class MockIndexer {
        constructor(_indexerUrl: string, _rpcUrl: string) {}
      }

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
      };
    });

    const { executeCkbOnchainWithdrawal } = await import("./ckb-onchain-withdrawal");

    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = `0x${"11".repeat(32)}`;

    const signingEntries = [{ message: "0xmessage" }];
    const txSkeleton = {
      get: vi.fn().mockReturnValue({
        toArray: () => signingEntries,
      }),
    };
    const signedTx = { tx: "signed" };

    mocks.transactionSkeleton.mockReturnValue(txSkeleton);
    mocks.transfer.mockResolvedValue(txSkeleton);
    mocks.payFeeByFeeRate.mockResolvedValue(txSkeleton);
    mocks.prepareSigningEntries.mockReturnValue(txSkeleton);
    mocks.parseAddress.mockReturnValue({ code_hash: "0x1", hash_type: "type", args: "0x2" });
    mocks.minimalCellCapacity.mockReturnValue(1n);
    mocks.privateKeyToBlake160.mockReturnValue("0xblake160");
    mocks.encodeToConfigAddress.mockReturnValue("ckt1from");
    mocks.signRecoverable.mockReturnValue("0xsig");
    mocks.sealTransaction.mockReturnValue(signedTx);
    mocks.sendTransaction.mockResolvedValue("0xtxhash");

    const result = await executeCkbOnchainWithdrawal({
      amount: "61",
      asset: "CKB",
      toAddress: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
      requestId: "w-ckb-1",
    });

    expect(result).toEqual({ txHash: "0xtxhash" });
    expect(mocks.sendTransaction).toHaveBeenCalledWith(signedTx, "passthrough");
  });
});
