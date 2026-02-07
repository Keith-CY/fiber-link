import { afterEach, describe, expect, it, vi } from "vitest";
import { createAdapter } from "./index";

describe("fiber adapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("createInvoice calls node rpc and returns invoice string", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: { invoice: "fiber:USDI:10:real" } }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const result = await adapter.createInvoice({ amount: "10", asset: "USDI" });

    expect(result.invoice).toBe("fiber:USDI:10:real");
    expect(fetchSpy).toHaveBeenCalledWith(
      "http://localhost:8119",
      expect.objectContaining({
        method: "POST",
        headers: { "content-type": "application/json" },
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
      "create_invoice response is missing 'invoice' string",
    );
  });

  it("getInvoiceStatus maps settled and failed states", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { state: "settled" } }),
      } as Response)
      .mockResolvedValueOnce({
        ok: true,
        json: async () => ({ jsonrpc: "2.0", id: 1, result: { state: "failed" } }),
      } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const settled = await adapter.getInvoiceStatus({ invoice: "inv-1" });
    const failed = await adapter.getInvoiceStatus({ invoice: "inv-2" });

    expect(settled.state).toBe("SETTLED");
    expect(failed.state).toBe("FAILED");
    expect(fetchSpy).toHaveBeenCalledTimes(2);
  });

  it("getInvoiceStatus throws when state is missing in rpc result", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue({
      ok: true,
      json: async () => ({ jsonrpc: "2.0", id: 1, result: {} }),
    } as Response);

    const adapter = createAdapter({ endpoint: "http://localhost:8119" });

    await expect(adapter.getInvoiceStatus({ invoice: "inv-missing" })).rejects.toThrow(
      "get_invoice response is missing 'state' string",
    );
  });
});
