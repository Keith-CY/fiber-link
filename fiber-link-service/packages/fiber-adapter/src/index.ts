import { rpcCall } from "./fiber-client";

export type CreateInvoiceArgs = { amount: string; asset: "CKB" | "USDI" };
export type InvoiceState = "UNPAID" | "SETTLED" | "FAILED";

function mapInvoiceState(value: string): InvoiceState {
  if (value === "settled") return "SETTLED";
  if (value === "failed") return "FAILED";
  return "UNPAID";
}

export function createAdapter({ endpoint }: { endpoint: string }) {
  return {
    async createInvoice({ amount, asset }: CreateInvoiceArgs) {
      const result = await rpcCall(endpoint, "create_invoice", { amount, asset });
      if (typeof result?.invoice !== "string" || !result.invoice) {
        throw new Error("create_invoice response is missing 'invoice' string");
      }
      return { invoice: result.invoice };
    },
    async getInvoiceStatus({ invoice }: { invoice: string }) {
      const result = await rpcCall(endpoint, "get_invoice", { invoice });
      if (typeof result?.state !== "string" || !result.state) {
        throw new Error("get_invoice response is missing 'state' string");
      }
      return { state: mapInvoiceState(result.state) };
    },
    async subscribeSettlements(_: { onSettled: (invoice: string) => void }) {
      return { close: () => undefined };
    },
  };
}
