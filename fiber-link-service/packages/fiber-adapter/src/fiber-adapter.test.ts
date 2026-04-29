import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdapter } from "./index";

async function waitForCondition(condition: () => boolean, timeoutMs = 500) {
  const start = Date.now();
  while (!condition()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("timed out waiting for condition");
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

describe("fiber adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unmock("./udt-onchain-withdrawal");
    vi.unmock("./ckb-onchain-withdrawal");
    vi.resetModules();
    delete process.env.FIBER_INVOICE_CURRENCY;
    delete process.env.FIBER_INVOICE_CURRENCY_CKB;
    delete process.env.FIBER_INVOICE_CURRENCY_USDI;
    delete process.env.FIBER_USDI_UDT_NAME;
    delete process.env.FIBER_USDI_UDT_TYPE_SCRIPT_JSON;
    delete process.env.FIBER_SETTLEMENT_SUBSCRIPTION_ENABLED;
    delete process.env.FIBER_SETTLEMENT_SUBSCRIPTION_URL;
    delete process.env.FIBER_SETTLEMENT_SUBSCRIPTION_RECONNECT_DELAY_MS;
    delete process.env.FIBER_SETTLEMENT_SUBSCRIPTION_AUTH_TOKEN;
    delete process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY;
    delete process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY;
  });

  it("createInvoice calls node rpc and returns invoice string", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: {
            udt_cfg_infos: [
              {
                name: "RUSD",
                script: {
                  code_hash: "0x01",
                  hash_type: "type",
                  args: "0x02",
                },
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { invoice_address: "fiber:USDI:10:real" } }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.createInvoice({ amount: "10", asset: "USDI" });

    expect(result.invoice).toBe("fiber:USDI:10:real");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8119",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: expect.stringContaining("\"method\":\"new_invoice\""),
      }),
    );
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"currency\":\"Fibt\""),
      }),
    );
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"udt_type_script\""),
      }),
    );
  });

  it("createInvoice maps CKB to default invoice currency", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { invoice_address: "fiber:CKB:10:real" } }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.createInvoice({ amount: "10", asset: "CKB" });

    expect(result.invoice).toBe("fiber:CKB:10:real");
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"currency\":\"Fibt\""),
      }),
    );
  });

  it("createInvoice throws when invoice is missing in rpc result", async () => {
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: {
            udt_cfg_infos: [
              {
                name: "RUSD",
                script: {
                  code_hash: "0x01",
                  hash_type: "type",
                  args: "0x02",
                },
              },
            ],
          },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });

    await expect(adapter.createInvoice({ amount: "10", asset: "USDI" })).rejects.toThrow(
      "new_invoice response is missing 'invoice_address' string",
    );
  });

  it("getInvoiceStatus maps settled and failed states", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { invoice: { data: { payment_hash: "0xaaa" } } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { status: "Paid" } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { invoice: { data: { payment_hash: "0xbbb" } } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { status: "Cancelled" } }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const settled = await adapter.getInvoiceStatus({ invoice: "inv-1" });
    const failed = await adapter.getInvoiceStatus({ invoice: "inv-2" });

    expect(settled.state).toBe("SETTLED");
    expect(failed.state).toBe("FAILED");
    expect(fetchSpy).toHaveBeenCalledTimes(4);
  });

  it("getInvoiceStatus throws when status is missing in rpc result", async () => {
    vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { invoice: { data: { payment_hash: "0xaaa" } } } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });

    await expect(adapter.getInvoiceStatus({ invoice: "inv-missing" })).rejects.toThrow(
      "get_invoice response is missing 'status' string",
    );
  });

  it("subscribeSettlements consumes stream events when enabled", async () => {
    const encoded = new TextEncoder().encode('data: {"invoice":"inv-settled","state":"SETTLED"}\n\n');
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoded);
      },
      pull() {
        return new Promise(() => undefined);
      },
    });

    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      body: stream,
    } as Response);
    const settledInvoices: string[] = [];

    const adapter = createAdapter({
      endpoint: "http://localhost:8119",
      settlementSubscription: {
        enabled: true,
        url: "http://localhost:8119/events/settlements",
        reconnectDelayMs: 10,
      },
    });
    const subscription = await adapter.subscribeSettlements({
      onSettled: (invoice) => {
        settledInvoices.push(invoice);
      },
    });

    await waitForCondition(() => settledInvoices.length === 1);
    await subscription.close();

    expect(settledInvoices).toEqual(["inv-settled"]);
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8119/events/settlements",
      expect.objectContaining({
        method: "GET",
      }),
    );
  });

  it("subscribeSettlements remains no-op when subscription config is disabled", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
    } as Response);
    const adapter = createAdapter({
      endpoint: "http://localhost:8119",
      settlementSubscription: {
        enabled: false,
      },
    });
    const subscription = await adapter.subscribeSettlements({
      onSettled: () => {
        throw new Error("must not emit");
      },
    });
    await subscription.close();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("executeWithdrawal parses invoice before send_payment", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { invoice: { data: { payment_hash: "0xparsed-payment" } } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 2, result: { payment_hash: "0xabc123" } }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.executeWithdrawal({
      amount: "10",
      asset: "USDI",
      destination: {
        kind: "PAYMENT_REQUEST",
        paymentRequest: "fiber:invoice:example",
      },
      requestId: "w-1",
    });

    expect(result.txHash).toBe("0xabc123");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"payment_hash\":\"0xparsed-payment\""),
      }),
    );
    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"currency\":\"Fibt\""),
      }),
    );
  });

  it("executeWithdrawal routes USDI CKB_ADDRESS payouts to the xUDT executor", async () => {
    const executeUdtOnchainWithdrawal = vi.fn().mockResolvedValue({ txHash: "0xudt" });
    const executeCkbOnchainWithdrawal = vi.fn().mockResolvedValue({ txHash: "0xckb" });

    vi.doMock("./udt-onchain-withdrawal", () => ({
      executeUdtOnchainWithdrawal,
    }));
    vi.doMock("./ckb-onchain-withdrawal", async () => {
      const actual = await vi.importActual<typeof import("./ckb-onchain-withdrawal")>("./ckb-onchain-withdrawal");
      return {
        ...actual,
        executeCkbOnchainWithdrawal,
      };
    });

    process.env.FIBER_USDI_UDT_TYPE_SCRIPT_JSON = JSON.stringify({
      code_hash: "0x01",
      hash_type: "type",
      args: "0x02",
    });

    const { createAdapter: createAdapterWithMocks } = await import("./index");
    const adapter = createAdapterWithMocks({ endpoint: "http://localhost:8119" });
    const result = await adapter.executeWithdrawal({
      amount: "10",
      asset: "USDI",
      destination: {
        kind: "CKB_ADDRESS",
        address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
      },
      requestId: "w-usdi-chain",
    });

    expect(result).toEqual({ txHash: "0xudt" });
    expect(executeUdtOnchainWithdrawal).toHaveBeenCalledWith({
      amount: "10",
      asset: "USDI",
      destination: {
        kind: "CKB_ADDRESS",
        address: "ckt1qyqwyxfa75whssgkq9ukkdd30d8c7txct0gq5f9mxs",
      },
      requestId: "w-usdi-chain",
      udtTypeScript: {
        codeHash: "0x01",
        hashType: "type",
        args: "0x02",
      },
    });
    expect(executeCkbOnchainWithdrawal).not.toHaveBeenCalled();
  });

  it("ensureChainLiquidity encodes fractional CKB rebalance amounts as shannons hex", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { status: "pending", started: true },
      }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.ensureChainLiquidity({
      requestId: "liq-1",
      asset: "CKB",
      network: "AGGRON4",
      requiredAmount: "85.00016356",
      sourceKind: "FIBER_TO_CKB_CHAIN",
    });

    expect(result).toEqual({
      state: "PENDING",
      started: true,
    });
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"method\":\"rebalance_to_ckb_chain\""),
      }),
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"required_amount\":\"0x1faa3f4e4\""),
      }),
    );
  });

  it("getRebalanceStatus maps funded responses", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: { status: "funded" },
      }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.getRebalanceStatus({
      requestId: "liq-1",
    });

    expect(result).toEqual({
      state: "FUNDED",
    });
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"method\":\"get_rebalance_status\""),
      }),
    );
  });

  it("lists ready channels with local balances", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          channels: [
            {
              channel_id: "0xlegacy",
              state: { state_name: "ChannelReady" },
              local_balance: "123",
              remote_balance: "77",
              remote_pubkey: "0xpeer",
              pending_tlc_count: "0",
            },
          ],
        },
      }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.listChannels({ includeClosed: false });

    expect(result.channels[0]).toMatchObject({
      channelId: "0xlegacy",
      state: "CHANNEL_READY",
      localBalance: "123",
      remotePubkey: "0xpeer",
      pendingTlcCount: 0,
    });
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"method\":\"list_channels\""),
      }),
    );
  });

  it("accepts channel with funding amount and returns new channel id when present", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          new_channel_id: "0xaccepted",
        },
      }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.acceptChannel({
      temporaryChannelId: "0xtemp",
      fundingAmount: "9900000000",
    });

    expect(result).toEqual({ newChannelId: "0xaccepted" });
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"method\":\"accept_channel\""),
      }),
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"temporary_channel_id\":\"0xtemp\""),
      }),
    );
  });

  it("reads CKB channel acceptance policy from node_info", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        jsonrpc: "2.0",
        id: 1,
        result: {
          open_channel_auto_accept_min_ckb_funding_amount: "0x2540be400",
          auto_accept_channel_ckb_funding_amount: "0x24e160300",
        },
      }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.getCkbChannelAcceptancePolicy();

    expect(result).toEqual({
      openChannelAutoAcceptMinFundingAmount: "10000000000",
      acceptChannelFundingAmount: "9900000000",
    });
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"method\":\"node_info\""),
      }),
    );
  });

  it("detects unsupported direct rebalance and falls back cleanly", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32999, message: "Unauthorized" },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { channels: [] },
        }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.getLiquidityCapabilities();

    expect(result.directRebalance).toBe(false);
    expect(result.channelLifecycle).toBe(true);
    expect(result.localCkbSweep).toBe(false);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("reports local CKB liquidity sweep support separately when configured", async () => {
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY =
      "0x2222222222222222222222222222222222222222222222222222222222222222";
    process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY =
      "0x1111111111111111111111111111111111111111111111111111111111111111";

    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          error: { code: -32601, message: "Method not found" },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { channels: [] },
        }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.getLiquidityCapabilities();

    expect(result.directRebalance).toBe(false);
    expect(result.channelLifecycle).toBe(true);
    expect(result.localCkbSweep).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("executeWithdrawal keeps explicit requestId in send_payment", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { invoice: { data: { payment_hash: "0xparsed-payment" } } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 2, result: { payment_hash: "0xabc123" } }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    await adapter.executeWithdrawal({
      amount: "10",
      asset: "USDI",
      destination: {
        kind: "PAYMENT_REQUEST",
        paymentRequest: "fiber:invoice:example",
      },
      requestId: "w-1",
    });

    expect(fetchSpy.mock.calls[1]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"request_id\":\"w-1\""),
      }),
    );
  });

  it("executeWithdrawal generates deterministic fallback requestId", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { invoice: { data: { payment_hash: "0xparsed-payment" } } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 2, result: { payment_hash: "0xabc123" } }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    await adapter.executeWithdrawal({
      amount: "10",
      asset: "USDI",
      destination: {
        kind: "PAYMENT_REQUEST",
        paymentRequest: "fiber:invoice:example",
      },
      requestId: "",
    });

    const first = JSON.parse(fetchSpy.mock.calls[1]?.[1]?.body as string);
    expect(first.params[0].request_id).toMatch(/^fiber:/);

    fetchSpy.mockClear();

    const fetchSpy2 = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { invoice: { data: { payment_hash: "0xparsed-payment" } } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 2, result: { payment_hash: "0xabc123" } }),
      } as Response);

    await adapter.executeWithdrawal({
      amount: "10",
      asset: "USDI",
      destination: {
        kind: "PAYMENT_REQUEST",
        paymentRequest: "fiber:invoice:example",
      },
      requestId: "",
    });
    const second = JSON.parse(fetchSpy2.mock.calls[1]?.[1]?.body as string);
    expect(second.params[0].request_id).toBe(first.params[0].request_id);
  });


  it("executeWithdrawal throws when rpc result has no transaction evidence", async () => {
    vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          jsonrpc: "2.0",
          id: 1,
          result: { invoice: { data: { payment_hash: "0xparsed-payment" } } },
        }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 2, result: {} }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    await expect(
      adapter.executeWithdrawal({
        amount: "10",
        asset: "USDI",
        destination: {
          kind: "PAYMENT_REQUEST",
          paymentRequest: "fiber:invoice:example",
        },
        requestId: "w-1",
      }),
    ).rejects.toThrow("send_payment response is missing transaction evidence");
  });
});
