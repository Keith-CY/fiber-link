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
      return { invoice: String(result?.invoice ?? "") };
    },
    async getInvoiceStatus({ invoice }: { invoice: string }) {
      const result = await rpcCall(endpoint, "get_invoice", { invoice });
      return { state: mapInvoiceState(String(result?.state ?? "")) };
    },
    async subscribeSettlements(_: { onSettled: (invoice: string) => void }) {
      return { close: () => undefined };
    },
  };
}
