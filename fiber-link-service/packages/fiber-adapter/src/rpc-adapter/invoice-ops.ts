import { FiberRpcError, rpcCall } from "../fiber-client";
import { toHexQuantity, normalizeOptionalName } from "./normalize";
import type {
  Asset,
  CreateInvoiceArgs,
  InvoiceState,
  UdtTypeScript,
} from "../types";

type RpcUdtTypeScript = {
  code_hash: string;
  hash_type: string;
  args: string;
};

function mapInvoiceState(value: string): InvoiceState {
  const normalized = value.trim().toLowerCase();
  if (normalized === "paid" || normalized === "settled") return "SETTLED";
  if (normalized === "cancelled" || normalized === "expired" || normalized === "failed") return "FAILED";
  return "UNPAID";
}

function mapCkbCurrency(): string {
  const ckbScoped = process.env.FIBER_INVOICE_CURRENCY_CKB;
  if (typeof ckbScoped === "string" && ckbScoped) {
    return ckbScoped;
  }

  const globalCurrency = process.env.FIBER_INVOICE_CURRENCY;
  if (typeof globalCurrency === "string" && globalCurrency) {
    return globalCurrency;
  }

  return "Fibt";
}

export function mapAssetToCurrency(asset: Asset): string {
  if (asset === "CKB") {
    return mapCkbCurrency();
  }

  const usdiScoped = process.env.FIBER_INVOICE_CURRENCY_USDI;
  if (typeof usdiScoped === "string" && usdiScoped) {
    return usdiScoped;
  }

  return mapCkbCurrency();
}

function isUdtTypeScript(value: unknown): value is RpcUdtTypeScript {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.code_hash === "string" &&
    !!candidate.code_hash &&
    typeof candidate.hash_type === "string" &&
    !!candidate.hash_type &&
    typeof candidate.args === "string" &&
    !!candidate.args
  );
}

async function rpcCallWithoutParams(endpoint: string, method: string): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params: [] }),
  });

  if (!response.ok) {
    throw new FiberRpcError(`Fiber RPC HTTP ${response.status}`);
  }

  const payload = await response.json();
  if (payload?.error) {
    throw new FiberRpcError(payload.error.message ?? "Fiber RPC error", payload.error.code, payload.error.data);
  }

  return payload?.result;
}

function pickUsdiUdtScript(nodeInfo: unknown): RpcUdtTypeScript | null {
  if (!nodeInfo || typeof nodeInfo !== "object") {
    return null;
  }

  const infosRaw = (nodeInfo as Record<string, unknown>).udt_cfg_infos;
  if (!Array.isArray(infosRaw) || infosRaw.length === 0) {
    return null;
  }
  const infos = infosRaw.filter((item) => item && typeof item === "object") as Array<Record<string, unknown>>;
  if (infos.length === 0) {
    return null;
  }

  const preferredName = normalizeOptionalName(process.env.FIBER_USDI_UDT_NAME);
  const preferred = preferredName
    ? infos.find((item) => normalizeOptionalName(item.name) === preferredName)
    : infos.find((item) => {
        const name = normalizeOptionalName(item.name);
        return name === "usdi" || name === "rusd";
      });

  const selected = preferred ?? infos[0];
  const script = selected?.script;
  if (!isUdtTypeScript(script)) {
    return null;
  }
  return script;
}

export async function resolveUsdiUdtScript(endpoint: string): Promise<RpcUdtTypeScript> {
  const envJson = process.env.FIBER_USDI_UDT_TYPE_SCRIPT_JSON;
  if (typeof envJson === "string" && envJson.trim()) {
    let parsed: unknown;
    try {
      parsed = JSON.parse(envJson);
    } catch {
      throw new Error("FIBER_USDI_UDT_TYPE_SCRIPT_JSON must be valid JSON");
    }
    if (!isUdtTypeScript(parsed)) {
      throw new Error("FIBER_USDI_UDT_TYPE_SCRIPT_JSON must include code_hash/hash_type/args");
    }
    return parsed;
  }

  const nodeInfo = await rpcCallWithoutParams(endpoint, "node_info");
  const script = pickUsdiUdtScript(nodeInfo);
  if (!script) {
    throw new Error("node_info does not expose a usable USDI udt_type_script");
  }
  return script;
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

export function toWithdrawalUdtTypeScript(script: RpcUdtTypeScript): UdtTypeScript {
  return {
    codeHash: script.code_hash,
    hashType: script.hash_type,
    args: script.args,
  };
}

export function toRpcUdtTypeScript(script: UdtTypeScript): RpcUdtTypeScript {
  return {
    code_hash: script.codeHash,
    hash_type: script.hashType,
    args: script.args,
  };
}

export async function createInvoice(endpoint: string, { amount, asset }: CreateInvoiceArgs) {
  const payload: Record<string, unknown> = {
    amount: toHexQuantity(amount),
    currency: mapAssetToCurrency(asset),
  };
  if (asset === "USDI") {
    payload.udt_type_script = await resolveUsdiUdtScript(endpoint);
  }

  const result = (await rpcCall(endpoint, "new_invoice", payload)) as Record<string, unknown> | undefined;
  if (typeof result?.invoice_address !== "string" || !result.invoice_address) {
    throw new Error("new_invoice response is missing 'invoice_address' string");
  }
  return { invoice: result.invoice_address };
}

export async function getInvoiceStatus(endpoint: string, { invoice }: { invoice: string }) {
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
}

export { rpcCallWithoutParams, mapInvoiceState, pickPaymentHash };
