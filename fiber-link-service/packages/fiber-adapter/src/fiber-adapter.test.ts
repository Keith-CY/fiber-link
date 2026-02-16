import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdapter } from "./index";

describe("fiber adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.FIBER_INVOICE_CURRENCY;
    delete process.env.FIBER_INVOICE_CURRENCY_CKB;
    delete process.env.FIBER_INVOICE_CURRENCY_USDI;
  });

  it("createInvoice calls node rpc and returns invoice string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { invoice_address: "fiber:USDI:10:real" } }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.createInvoice({ amount: "10", asset: "USDI" });

    expect(result.invoice).toBe("fiber:USDI:10:real");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8119",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
        body: expect.stringContaining("\"method\":\"new_invoice\""),
      }),
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"currency\":\"USDI\""),
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
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
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

  it("executeWithdrawal calls send_payment and returns txHash evidence", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { payment_hash: "0xabc123" } }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.executeWithdrawal({
      amount: "10",
      asset: "USDI",
      toAddress: "fiber:invoice:example",
      requestId: "w-1",
    });

    expect(result.txHash).toBe("0xabc123");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8119",
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("\"method\":\"send_payment\""),
      }),
    );
    expect(fetchSpy.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        body: expect.stringContaining("\"request_id\":\"w-1\""),
      }),
    );
  });

  it("executeWithdrawal throws when rpc result has no transaction evidence", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    await expect(
      adapter.executeWithdrawal({
        amount: "10",
        asset: "USDI",
        toAddress: "fiber:invoice:example",
        requestId: "w-1",
      }),
    ).rejects.toThrow("send_payment response is missing transaction evidence");
  });
});
