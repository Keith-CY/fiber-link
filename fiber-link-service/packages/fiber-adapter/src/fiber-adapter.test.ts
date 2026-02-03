import { describe, it, expect } from "vitest";
import { createAdapter } from "./index";

describe("fiber adapter", () => {
  it("creates invoice", async () => {
    const adapter = createAdapter({ endpoint: "http://localhost:8119" });
    const invoice = await adapter.createInvoice({ amount: "10", asset: "USDI" });
    expect(invoice.invoice).toContain("fiber");
  });
});
