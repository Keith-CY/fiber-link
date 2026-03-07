import { afterEach, describe, expect, it, vi } from "vitest";

describe("executeUdtOnchainWithdrawal", () => {
  afterEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    delete process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;
    delete process.env.FIBER_WITHDRAWAL_CKB_FEE_RATE_SHANNONS_PER_KB;
    delete process.env.FIBER_WITHDRAWAL_CKB_RPC_URL;
    delete process.env.FIBER_WITHDRAWAL_CKB_RPC_URL_TESTNET;
    delete process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL;
    delete process.env.FIBER_WITHDRAWAL_CKB_INDEXER_URL_TESTNET;
    delete process.env.FIBER_USDI_UDT_TYPE_SCRIPT_JSON;
    delete process.env.FIBER_USDI_UDT_DECIMALS;
  });

  async function setupLumosMocks(transferImpl?: () => unknown) {
    const mocks = {
      sendTransaction: vi.fn(),
      sudtTransfer: vi.fn(),
      payFeeByFeeRate: vi.fn(),
      prepareSigningEntries: vi.fn(),
      initializeConfig: vi.fn(),
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
          sudt: {
            transfer: mocks.sudtTransfer,
          },
          common: {
            payFeeByFeeRate: mocks.payFeeByFeeRate,
            prepareSigningEntries: mocks.prepareSigningEntries,
          },
        },
        config: {
          predefined: {
            AGGRON4: {
              PREFIX: "ckt",
              SCRIPTS: {
                SUDT: {
                  CODE_HASH: "0xdefault",
                  HASH_TYPE: "type",
                  TX_HASH: "0xdep",
                  INDEX: "0x0",
                  DEP_TYPE: "code",
                },
              },
            },
            LINA: {
              PREFIX: "ckb",
              SCRIPTS: {
                SUDT: {
                  CODE_HASH: "0xmainnet",
                  HASH_TYPE: "type",
                  TX_HASH: "0xdep-mainnet",
                  INDEX: "0x0",
                  DEP_TYPE: "code",
                },
              },
            },
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
          encodeToConfigAddress: mocks.encodeToConfigAddress,
          TransactionSkeleton: mocks.transactionSkeleton,
          sealTransaction: mocks.sealTransaction,
        },
      };
    });

    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY = `0x${"11".repeat(32)}`;
    process.env.FIBER_USDI_UDT_DECIMALS = "2";
    process.env.FIBER_USDI_UDT_TYPE_SCRIPT_JSON = JSON.stringify({
      code_hash: `0x${"22".repeat(32)}`,
      hash_type: "type",
      args: `0x${"33".repeat(32)}`,
    });

    const signingEntries = [{ message: "0xmessage" }];
    const txSkeleton = {
      get: vi.fn().mockReturnValue({
        toArray: () => signingEntries,
      }),
    };
    const signedTx = { tx: "signed" };

    mocks.transactionSkeleton.mockReturnValue(txSkeleton);
    if (transferImpl) {
      mocks.sudtTransfer.mockImplementation(async () => transferImpl());
    } else {
      mocks.sudtTransfer.mockResolvedValue(txSkeleton);
    }
    mocks.payFeeByFeeRate.mockResolvedValue(txSkeleton);
    mocks.prepareSigningEntries.mockReturnValue(txSkeleton);
    mocks.privateKeyToBlake160.mockReturnValue("0xblake160");
    mocks.encodeToConfigAddress.mockReturnValue("ckt1from");
    mocks.signRecoverable.mockReturnValue("0xsig");
    mocks.sealTransaction.mockReturnValue(signedTx);
    mocks.sendTransaction.mockResolvedValue("0xtxhash");

    const mod = await import("./udt-onchain-withdrawal");
    return { ...mod, mocks, signedTx, txSkeleton };
  }

  it("sends USDI xUDT to a creator CKB address", async () => {
    const { executeUdtOnchainWithdrawal, mocks, signedTx, txSkeleton } = await setupLumosMocks();

    const result = await executeUdtOnchainWithdrawal({
      amount: "25",
      asset: "USDI",
      destination: {
        kind: "CKB_ADDRESS",
        address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
      },
      requestId: "w1",
    });

    expect(result).toEqual({ txHash: "0xtxhash" });
    expect(mocks.sudtTransfer).toHaveBeenCalledWith(
      txSkeleton,
      ["ckt1from"],
      `0x${"33".repeat(32)}`,
      "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
      2500n,
      "ckt1from",
      undefined,
      undefined,
      expect.objectContaining({
        config: expect.objectContaining({
          SCRIPTS: expect.objectContaining({
            SUDT: expect.objectContaining({
              CODE_HASH: `0x${"22".repeat(32)}`,
              HASH_TYPE: "type",
            }),
          }),
        }),
      }),
    );
    expect(mocks.sendTransaction).toHaveBeenCalledWith(signedTx, "passthrough");
  });

  it("rejects USDI on-chain withdrawals when decimals config is missing", async () => {
    const { executeUdtOnchainWithdrawal } = await setupLumosMocks();
    delete process.env.FIBER_USDI_UDT_DECIMALS;

    await expect(
      executeUdtOnchainWithdrawal({
        amount: "25",
        asset: "USDI",
        destination: {
          kind: "CKB_ADDRESS",
          address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
        },
        requestId: "w1",
      }),
    ).rejects.toMatchObject({
      kind: "permanent",
      message: "FIBER_USDI_UDT_DECIMALS is required for USDI on-chain withdrawal",
    });
  });
});
