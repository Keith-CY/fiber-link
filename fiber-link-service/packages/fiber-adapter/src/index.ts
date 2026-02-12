import { rpcCall } from "./fiber-client";
export { FiberRpcError } from "./fiber-client";

export type CreateInvoiceArgs = { amount: string; asset: "CKB" | "USDI" };
export type InvoiceState = "UNPAID" | "SETTLED" | "FAILED";
export type ExecuteWithdrawalArgs = {
  amount: string;
  asset: "CKB" | "USDI";
  toAddress: string;
  requestId: string;
};

function mapInvoiceState(value: string): InvoiceState {
  if (value === "settled") return "SETTLED";
  if (value === "failed") return "FAILED";
  return "UNPAID";
}

function pickTxEvidence(result: Record<string, unknown> | undefined): string | null {
  const candidates = [result?.tx_hash, result?.txHash, result?.payment_hash, result?.paymentHash, result?.hash];
  for (const value of candidates) {
    if (typeof value === "string" && value) {
      return value;
    }
  }
  return null;
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
    async executeWithdrawal({ amount, asset, toAddress, requestId }: ExecuteWithdrawalArgs) {
      // Current executor uses Fiber payment RPC; toAddress is treated as a payment request string.
      const result = (await rpcCall(endpoint, "send_payment", {
        invoice: toAddress,
        amount,
        asset,
        request_id: requestId,
      })) as Record<string, unknown> | undefined;
      const txHash = pickTxEvidence(result);
      if (!txHash) {
        throw new Error("send_payment response is missing transaction evidence");
      }
      return { txHash };
    },
  };
}
