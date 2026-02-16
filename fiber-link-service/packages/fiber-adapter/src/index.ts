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
  const normalized = value.trim().toLowerCase();
  if (normalized === "paid" || normalized === "settled") return "SETTLED";
  if (normalized === "cancelled" || normalized === "expired" || normalized === "failed") return "FAILED";
  return "UNPAID";
}

function toHexQuantity(value: string): string {
  if (/^0x[0-9a-f]+$/i.test(value)) {
    return value.toLowerCase();
  }
  if (!/^[0-9]+$/.test(value)) {
    throw new Error(`invalid amount: ${value}`);
  }
  return `0x${BigInt(value).toString(16)}`;
}

function mapAssetToCurrency(_: "CKB" | "USDI"): string {
  return process.env.FIBER_INVOICE_CURRENCY ?? "Fibt";
}

function pickPaymentHash(result: Record<string, unknown> | undefined): string | null {
  const invoice = result?.invoice as Record<string, unknown> | undefined;
  const data = invoice?.data as Record<string, unknown> | undefined;
  const hash = data?.payment_hash;
  if (typeof hash === "string" && hash) {
    return hash;
  }
  return null;
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
      const result = (await rpcCall(endpoint, "new_invoice", {
        amount: toHexQuantity(amount),
        currency: mapAssetToCurrency(asset),
      })) as Record<string, unknown> | undefined;
      if (typeof result?.invoice_address !== "string" || !result.invoice_address) {
        throw new Error("new_invoice response is missing 'invoice_address' string");
      }
      return { invoice: result.invoice_address };
    },
    async getInvoiceStatus({ invoice }: { invoice: string }) {
      const parsed = (await rpcCall(endpoint, "parse_invoice", {
        invoice,
      })) as Record<string, unknown> | undefined;
      const paymentHash = pickPaymentHash(parsed);
      if (!paymentHash) {
        throw new Error("parse_invoice response is missing 'invoice.data.payment_hash' string");
      }

      const result = (await rpcCall(endpoint, "get_invoice", {
        payment_hash: paymentHash,
      })) as Record<string, unknown> | undefined;
      if (typeof result?.status !== "string" || !result.status) {
        throw new Error("get_invoice response is missing 'status' string");
      }
      return { state: mapInvoiceState(result.status) };
    },
    async subscribeSettlements(_: { onSettled: (invoice: string) => void }) {
      return { close: () => undefined };
    },
    async executeWithdrawal({ amount, asset, toAddress, requestId }: ExecuteWithdrawalArgs) {
      void asset;
      void requestId;
      // Current executor uses Fiber payment RPC; toAddress is treated as a payment request string.
      const result = (await rpcCall(endpoint, "send_payment", {
        invoice: toAddress,
        amount: toHexQuantity(amount),
      })) as Record<string, unknown> | undefined;
      const txHash = pickTxEvidence(result);
      if (!txHash) {
        throw new Error("send_payment response is missing transaction evidence");
      }
      return { txHash };
    },
  };
}
