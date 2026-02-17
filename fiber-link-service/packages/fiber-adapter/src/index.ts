import { createHash } from "node:crypto";
import { rpcCall } from "./fiber-client";
export { FiberRpcError } from "./fiber-client";

type Asset = "CKB" | "USDI";

export type CreateInvoiceArgs = { amount: string; asset: Asset };
export type InvoiceState = "UNPAID" | "SETTLED" | "FAILED";
export type ExecuteWithdrawalArgs = {
  amount: string;
  asset: Asset;
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

function generateFallbackRequestId({ invoice, amount, asset }: { invoice: string; amount: string; asset: Asset }) {
  // Deterministic fallback keeps retries idempotent when caller-provided requestId is empty.
  // We keep only 20 hex chars (80-bit space): collision risk is low for retries, but non-zero for long-term global dedupe.
  return `fiber:${createHash("sha256").update(`${invoice}|${amount}|${asset}`).digest("hex").slice(0, 20)}`;
}

const DEFAULT_INVOICE_CURRENCY_BY_ASSET: Record<Asset, string> = {
  CKB: "Fibt",
  USDI: "USDI",
};

function mapAssetToCurrency(asset: Asset): string {
  const assetScoped = process.env[`FIBER_INVOICE_CURRENCY_${asset}`];
  if (typeof assetScoped === "string" && assetScoped) {
    return assetScoped;
  }

  const globalCurrency = process.env.FIBER_INVOICE_CURRENCY;
  if (typeof globalCurrency === "string" && globalCurrency) {
    return globalCurrency;
  }

  return DEFAULT_INVOICE_CURRENCY_BY_ASSET[asset];
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
      const parsed = (await rpcCall(endpoint, "parse_invoice", {
        invoice: toAddress,
      })) as Record<string, unknown> | undefined;
      const paymentHash = pickPaymentHash(parsed);
      if (!paymentHash) {
        throw new Error("parse_invoice response is missing 'invoice.data.payment_hash' string");
      }
      const resolvedRequestId = requestId?.trim() || generateFallbackRequestId({ invoice: toAddress, amount, asset });
      const result = (await rpcCall(endpoint, "send_payment", {
        payment_hash: paymentHash,
        amount: toHexQuantity(amount),
        currency: mapAssetToCurrency(asset),
        request_id: resolvedRequestId,
      })) as Record<string, unknown> | undefined;
      const txHash = pickTxEvidence(result);
      if (!txHash) {
        throw new Error("send_payment response is missing transaction evidence");
      }
      return { txHash };
    }

  };
}
