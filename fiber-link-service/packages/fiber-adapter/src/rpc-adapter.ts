import { createHash } from "node:crypto";
import { FiberRpcError, rpcCall } from "./fiber-client";
import { executeCkbOnchainWithdrawal } from "./ckb-onchain-withdrawal";
import { executeUdtOnchainWithdrawal } from "./udt-onchain-withdrawal";
import type {
  AcceptChannelArgs,
  AcceptChannelResult,
  Asset,
  CkbChannelAcceptancePolicy,
  ChannelRecord,
  CreateAdapterArgs,
  CreateInvoiceArgs,
  EnsureChainLiquidityArgs,
  EnsureChainLiquidityResult,
  ExecuteWithdrawalArgs,
  FiberAdapter,
  GetRebalanceStatusArgs,
  GetRebalanceStatusResult,
  InvoiceState,
  ListChannelsArgs,
  ListChannelsResult,
  LiquidityCapabilities,
  OpenChannelArgs,
  OpenChannelResult,
  RebalanceStatusState,
  SettlementSubscriptionConfig,
  SettlementSubscriptionHandle,
  ShutdownChannelArgs,
  ShutdownChannelResult,
  SubscribeSettlementsArgs,
  UdtTypeScript,
} from "./types";

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

function mapAssetToCurrency(asset: Asset): string {
  if (asset === "CKB") {
    return mapCkbCurrency();
  }

  const usdiScoped = process.env.FIBER_INVOICE_CURRENCY_USDI;
  if (typeof usdiScoped === "string" && usdiScoped) {
    return usdiScoped;
  }

  // USDI invoices/payments in FNN use the chain currency enum (Fibb/Fibt/Fibd)
  // and carry xUDT identity via udt_type_script.
  return mapCkbCurrency();
}

function normalizeOptionalName(input: unknown): string {
  if (typeof input !== "string") {
    return "";
  }
  return input.trim().toLowerCase();
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

async function resolveUsdiUdtScript(endpoint: string): Promise<RpcUdtTypeScript> {
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

function toWithdrawalUdtTypeScript(script: RpcUdtTypeScript): UdtTypeScript {
  return {
    codeHash: script.code_hash,
    hashType: script.hash_type,
    args: script.args,
  };
}

function toRpcUdtTypeScript(script: UdtTypeScript): RpcUdtTypeScript {
  return {
    code_hash: script.codeHash,
    hash_type: script.hashType,
    args: script.args,
  };
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

function mapRebalanceStatus(value: unknown): RebalanceStatusState {
  if (typeof value !== "string") {
    return "IDLE";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "funded" || normalized === "completed" || normalized === "satisfied") {
    return "FUNDED";
  }
  if (normalized === "pending" || normalized === "requested" || normalized === "rebalancing") {
    return "PENDING";
  }
  if (normalized === "failed" || normalized === "error") {
    return "FAILED";
  }
  return "IDLE";
}

function parseEnsureChainLiquidityResult(result: Record<string, unknown> | undefined): EnsureChainLiquidityResult {
  const state = mapRebalanceStatus(result?.status ?? result?.state);
  if (state === "IDLE") {
    return {
      state: "PENDING",
      started: Boolean(result?.started),
    };
  }
  return {
    state,
    started: Boolean(result?.started),
    error: typeof result?.error === "string" ? result.error : undefined,
  };
}

function parseGetRebalanceStatusResult(result: Record<string, unknown> | undefined): GetRebalanceStatusResult {
  return {
    state: mapRebalanceStatus(result?.status ?? result?.state),
    error: typeof result?.error === "string" ? result.error : undefined,
  };
}

function normalizeRpcChannelState(value: unknown): string {
  const candidate =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof (value as Record<string, unknown>).state_name === "string"
        ? ((value as Record<string, unknown>).state_name as string)
        : "";
  const normalized = candidate.trim();
  if (!normalized) {
    return "UNKNOWN";
  }
  if (normalized === "ChannelReady" || normalized === "CHANNEL_READY") {
    return "CHANNEL_READY";
  }
  if (normalized === "Closed" || normalized === "CLOSED") {
    return "CLOSED";
  }
  return normalized;
}

function normalizeRpcAmount(value: unknown): string {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  if (typeof value !== "string") {
    return "0";
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return "0";
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return BigInt(trimmed).toString(10);
  }
  return trimmed;
}

function pickRequiredAmount(result: Record<string, unknown> | undefined, key: string): string {
  const normalized = normalizeRpcAmount(result?.[key]);
  if (normalized === "0") {
    return "0";
  }
  return normalized;
}

function normalizeRpcInteger(value: unknown): number {
  if (typeof value === "number" && Number.isInteger(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return 0;
  }
  const trimmed = value.trim();
  if (!trimmed) {
    return 0;
  }
  if (/^0x[0-9a-f]+$/i.test(trimmed)) {
    return Number(BigInt(trimmed));
  }
  const parsed = Number(trimmed);
  return Number.isInteger(parsed) ? parsed : 0;
}

function parseChannelRecord(value: unknown): ChannelRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const channelId = pickStringCandidate(raw.channel_id) ?? pickStringCandidate(raw.channelId);
  if (!channelId) {
    return null;
  }
  return {
    channelId,
    state: normalizeRpcChannelState(raw.state),
    localBalance: normalizeRpcAmount(raw.local_balance ?? raw.localBalance),
    remoteBalance: normalizeRpcAmount(raw.remote_balance ?? raw.remoteBalance),
    remotePubkey:
      pickStringCandidate(raw.remote_pubkey) ??
      pickStringCandidate(raw.remotePubkey) ??
      pickStringCandidate(raw.peer_id) ??
      pickStringCandidate(raw.peerId),
    pendingTlcCount: normalizeRpcInteger(raw.pending_tlc_count ?? raw.pendingTlcCount),
  };
}

function parseCkbChannelAcceptancePolicy(result: Record<string, unknown> | undefined): CkbChannelAcceptancePolicy {
  return {
    openChannelAutoAcceptMinFundingAmount: pickRequiredAmount(
      result,
      "open_channel_auto_accept_min_ckb_funding_amount",
    ),
    acceptChannelFundingAmount: pickRequiredAmount(result, "auto_accept_channel_ckb_funding_amount"),
  };
}

function isUnsupportedRpcMethodError(error: unknown): boolean {
  if (!(error instanceof FiberRpcError)) {
    return false;
  }
  if (error.code === -32601) {
    return true;
  }

  const message = error.message.trim().toLowerCase();
  return message === "unauthorized" || message.includes("method not found") || message.includes("unknown method");
}

async function probeDirectRebalanceSupport(endpoint: string): Promise<boolean> {
  try {
    await rpcCall(endpoint, "get_rebalance_status", {
      request_id: "__capability_probe__",
    });
    return true;
  } catch (error) {
    if (isUnsupportedRpcMethodError(error)) {
      return false;
    }
    throw error;
  }
}

async function probeChannelLifecycleSupport(endpoint: string): Promise<boolean> {
  try {
    await rpcCall(endpoint, "list_channels", {});
    return true;
  } catch (error) {
    if (isUnsupportedRpcMethodError(error)) {
      return false;
    }
    throw error;
  }
}

const DEFAULT_SETTLEMENT_SUBSCRIPTION_RECONNECT_DELAY_MS = 3_000;

function parseBoolean(input: string | undefined): boolean | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  const normalized = input.trim().toLowerCase();
  if (!normalized) {
    return undefined;
  }
  if (normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on") {
    return true;
  }
  if (normalized === "0" || normalized === "false" || normalized === "no" || normalized === "off") {
    return false;
  }
  return undefined;
}

function parsePositiveInteger(input: string | undefined): number | undefined {
  if (typeof input !== "string") {
    return undefined;
  }
  if (!/^[0-9]+$/.test(input)) {
    return undefined;
  }
  const parsed = Number(input);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return undefined;
  }
  return parsed;
}

function pickStringCandidate(value: unknown): string | null {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  return null;
}

function pickInvoiceFromEventShape(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const event = value as Record<string, unknown>;
  const nestedCandidates = [
    event.result as Record<string, unknown> | undefined,
    event.data as Record<string, unknown> | undefined,
    event.payload as Record<string, unknown> | undefined,
    event.event as Record<string, unknown> | undefined,
    event.notification as Record<string, unknown> | undefined,
  ];
  const directCandidates = [
    event.invoice,
    event.invoice_address,
    event.invoiceAddress,
    nestedCandidates[0]?.invoice,
    nestedCandidates[0]?.invoice_address,
    nestedCandidates[1]?.invoice,
    nestedCandidates[1]?.invoice_address,
    nestedCandidates[2]?.invoice,
    nestedCandidates[2]?.invoice_address,
  ];

  for (const candidate of directCandidates) {
    const invoice = pickStringCandidate(candidate);
    if (invoice) {
      return invoice;
    }
  }
  return null;
}

function pickStateFromEventShape(value: unknown): string | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const event = value as Record<string, unknown>;
  const nestedCandidates = [
    event.result as Record<string, unknown> | undefined,
    event.data as Record<string, unknown> | undefined,
    event.payload as Record<string, unknown> | undefined,
    event.event as Record<string, unknown> | undefined,
    event.notification as Record<string, unknown> | undefined,
  ];
  const directCandidates = [
    event.state,
    event.status,
    nestedCandidates[0]?.state,
    nestedCandidates[0]?.status,
    nestedCandidates[1]?.state,
    nestedCandidates[1]?.status,
    nestedCandidates[2]?.state,
    nestedCandidates[2]?.status,
  ];

  for (const candidate of directCandidates) {
    const state = pickStringCandidate(candidate);
    if (state) {
      return state;
    }
  }
  return null;
}

function collectSettledInvoices(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => collectSettledInvoices(item));
  }
  if (!value || typeof value !== "object") {
    return [];
  }

  const record = value as Record<string, unknown>;
  const invoice = pickInvoiceFromEventShape(record);
  const state = pickStateFromEventShape(record);
  const invoices: string[] = [];
  if (invoice) {
    if (!state || mapInvoiceState(state) === "SETTLED") {
      invoices.push(invoice);
    }
  }

  const nested = [record.events, record.result, record.data, record.payload, record.event, record.notification];
  for (const node of nested) {
    if (node && typeof node === "object") {
      invoices.push(...collectSettledInvoices(node));
    }
  }
  return Array.from(new Set(invoices));
}

async function dispatchSettledInvoices(
  payload: string,
  args: SubscribeSettlementsArgs,
): Promise<void> {
  const trimmed = payload.trim();
  if (!trimmed || trimmed === "[DONE]") {
    return;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return;
  }

  const invoices = collectSettledInvoices(parsed);
  for (const invoice of invoices) {
    try {
      await args.onSettled(invoice);
    } catch (error) {
      args.onError?.(error);
    }
  }
}

async function consumeSettlementStream(
  stream: ReadableStream<Uint8Array>,
  args: SubscribeSettlementsArgs,
  signal: AbortSignal,
) {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const pendingSseData: string[] = [];

  function waitForAbort(): Promise<never> {
    return new Promise((_, reject) => {
      if (signal.aborted) {
        reject(new Error("settlement subscription aborted"));
        return;
      }
      signal.addEventListener(
        "abort",
        () => {
          reject(new Error("settlement subscription aborted"));
        },
        { once: true },
      );
    });
  }

  async function flushSseData() {
    if (pendingSseData.length === 0) {
      return;
    }
    const payload = pendingSseData.join("\n");
    pendingSseData.length = 0;
    await dispatchSettledInvoices(payload, args);
  }

  async function processLine(rawLine: string) {
    const line = rawLine.replace(/\r$/, "");
    const trimmed = line.trim();

    if (trimmed === "") {
      await flushSseData();
      return;
    }
    if (line.startsWith(":")) {
      return;
    }
    if (line.startsWith("data:")) {
      pendingSseData.push(line.slice("data:".length).trimStart());
      return;
    }

    await flushSseData();
    await dispatchSettledInvoices(trimmed, args);
  }

  while (!signal.aborted) {
    let readResult: ReadableStreamReadResult<Uint8Array>;
    try {
      readResult = await Promise.race([reader.read(), waitForAbort()]);
    } catch (error) {
      if (signal.aborted) {
        try {
          await reader.cancel();
        } catch {
          // Ignore stream cancellation failures during shutdown.
        }
        break;
      }
      throw error;
    }

    const { value, done } = readResult;
    if (done) {
      break;
    }
    buffer += decoder.decode(value, { stream: true });
    let lineBreakIndex = buffer.indexOf("\n");
    while (lineBreakIndex >= 0) {
      const line = buffer.slice(0, lineBreakIndex);
      buffer = buffer.slice(lineBreakIndex + 1);
      await processLine(line);
      lineBreakIndex = buffer.indexOf("\n");
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    await processLine(buffer);
  } else {
    await flushSseData();
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function resolveSettlementSubscriptionConfig(config: SettlementSubscriptionConfig | undefined) {
  const enabled = config?.enabled ?? parseBoolean(process.env.FIBER_SETTLEMENT_SUBSCRIPTION_ENABLED) ?? false;
  const url = config?.url ?? process.env.FIBER_SETTLEMENT_SUBSCRIPTION_URL ?? null;
  const reconnectDelayMs =
    config?.reconnectDelayMs ??
    parsePositiveInteger(process.env.FIBER_SETTLEMENT_SUBSCRIPTION_RECONNECT_DELAY_MS) ??
    DEFAULT_SETTLEMENT_SUBSCRIPTION_RECONNECT_DELAY_MS;
  const authToken = config?.authToken ?? process.env.FIBER_SETTLEMENT_SUBSCRIPTION_AUTH_TOKEN ?? null;
  return {
    enabled,
    url,
    reconnectDelayMs,
    authToken,
  };
}

export function createAdapter({ endpoint, settlementSubscription, fetchFn }: CreateAdapterArgs): FiberAdapter {
  const resolvedFetch = fetchFn ?? fetch;
  const subscriptionConfig = resolveSettlementSubscriptionConfig(settlementSubscription);

  return {
    async createInvoice({ amount, asset }: CreateInvoiceArgs) {
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
    async subscribeSettlements(args: SubscribeSettlementsArgs): Promise<SettlementSubscriptionHandle> {
      if (!subscriptionConfig.enabled) {
        return { close: () => undefined };
      }
      if (!subscriptionConfig.url) {
        throw new Error("FIBER_SETTLEMENT_SUBSCRIPTION_URL is required when settlement subscription is enabled");
      }

      const controller = new AbortController();
      let closed = false;
      const runner = (async () => {
        while (!closed) {
          try {
            const headers: Record<string, string> = {
              accept: "text/event-stream, application/x-ndjson, application/json",
            };
            if (subscriptionConfig.authToken) {
              headers.authorization = `Bearer ${subscriptionConfig.authToken}`;
            }
            const response = await resolvedFetch(subscriptionConfig.url, {
              method: "GET",
              headers,
              signal: controller.signal,
            });

            if (!response.ok) {
              throw new Error(`settlement subscription request failed with HTTP ${response.status}`);
            }
            if (!response.body) {
              throw new Error("settlement subscription response body is missing");
            }

            await consumeSettlementStream(response.body, args, controller.signal);
          } catch (error) {
            if (closed || controller.signal.aborted) {
              break;
            }
            args.onError?.(error);
            await delay(subscriptionConfig.reconnectDelayMs);
          }
        }
      })();

      return {
        async close() {
          if (closed) {
            return;
          }
          closed = true;
          controller.abort();
          await runner;
        },
      };
    },
    async executeWithdrawal({ amount, asset, destination, requestId }: ExecuteWithdrawalArgs) {
      if (destination.kind === "CKB_ADDRESS") {
        if (asset === "USDI") {
          return executeUdtOnchainWithdrawal({
            amount,
            asset,
            destination,
            requestId,
            udtTypeScript: toWithdrawalUdtTypeScript(await resolveUsdiUdtScript(endpoint)),
          });
        }
        return executeCkbOnchainWithdrawal({ amount, asset, destination, requestId });
      }

      const paymentRequest = destination.paymentRequest;
      const parsed = (await rpcCall(endpoint, "parse_invoice", {
        invoice: paymentRequest,
      })) as Record<string, unknown> | undefined;
      const paymentHash = pickPaymentHash(parsed);
      if (!paymentHash) {
        throw new Error("parse_invoice response is missing 'invoice.data.payment_hash' string");
      }
      const resolvedRequestId =
        requestId?.trim() || generateFallbackRequestId({ invoice: paymentRequest, amount, asset });
      const result = (await rpcCall(endpoint, "send_payment", {
        payment_hash: paymentHash,
        amount: toHexQuantity(amount),
        currency: mapAssetToCurrency(asset),
        request_id: resolvedRequestId,
        invoice: paymentRequest,
      })) as Record<string, unknown> | undefined;
      const txHash = pickTxEvidence(result);
      if (!txHash) {
        throw new Error("send_payment response is missing transaction evidence");
      }
      return { txHash };
    },
    async getLiquidityCapabilities(): Promise<LiquidityCapabilities> {
      const [directRebalance, channelLifecycle] = await Promise.all([
        probeDirectRebalanceSupport(endpoint),
        probeChannelLifecycleSupport(endpoint),
      ]);
      return {
        directRebalance,
        channelLifecycle,
      };
    },
    async listChannels({ includeClosed = false, peerId }: ListChannelsArgs): Promise<ListChannelsResult> {
      const payload: Record<string, unknown> = {};
      if (includeClosed) {
        payload.include_closed = true;
      }
      if (peerId?.trim()) {
        payload.peer_id = peerId.trim();
      }

      const result = (await rpcCall(endpoint, "list_channels", payload)) as Record<string, unknown> | undefined;
      const rawChannels = Array.isArray(result?.channels) ? result.channels : [];
      const channels = rawChannels
        .map(parseChannelRecord)
        .filter((channel): channel is ChannelRecord => channel !== null)
        .filter((channel) => includeClosed || channel.state !== "CLOSED");
      return { channels };
    },
    async openChannel({
      peerId,
      fundingAmount,
      fundingUdtTypeScript,
      tlcFeeProportionalMillionths,
    }: OpenChannelArgs): Promise<OpenChannelResult> {
      const payload: Record<string, unknown> = {
        peer_id: peerId,
        funding_amount: toHexQuantity(fundingAmount),
      };
      if (fundingUdtTypeScript) {
        payload.funding_udt_type_script = toRpcUdtTypeScript(fundingUdtTypeScript);
      }
      if (tlcFeeProportionalMillionths) {
        payload.tlc_fee_proportional_millionths = tlcFeeProportionalMillionths;
      }

      const result = (await rpcCall(endpoint, "open_channel", payload)) as Record<string, unknown> | undefined;
      const temporaryChannelId = pickStringCandidate(result?.temporary_channel_id);
      if (!temporaryChannelId) {
        throw new Error("open_channel response is missing 'temporary_channel_id' string");
      }
      return { temporaryChannelId };
    },
    async acceptChannel({ temporaryChannelId, fundingAmount }: AcceptChannelArgs): Promise<AcceptChannelResult> {
      const result = (await rpcCall(endpoint, "accept_channel", {
        temporary_channel_id: temporaryChannelId,
        funding_amount: toHexQuantity(fundingAmount),
      })) as Record<string, unknown> | undefined;
      const newChannelId = pickStringCandidate(result?.new_channel_id);
      return newChannelId ? { newChannelId } : {};
    },
    async getCkbChannelAcceptancePolicy(): Promise<CkbChannelAcceptancePolicy> {
      const result = (await rpcCallWithoutParams(endpoint, "node_info")) as Record<string, unknown> | undefined;
      return parseCkbChannelAcceptancePolicy(result);
    },
    async shutdownChannel({ channelId, closeScript, feeRate, force }: ShutdownChannelArgs): Promise<ShutdownChannelResult> {
      const payload: Record<string, unknown> = {
        channel_id: channelId,
      };
      if (closeScript) {
        payload.close_script = closeScript;
      }
      if (feeRate) {
        payload.fee_rate = feeRate;
      }
      if (force !== undefined) {
        payload.force = force;
      }

      const result = (await rpcCall(endpoint, "shutdown_channel", payload)) as Record<string, unknown> | undefined;
      const txHash = pickTxEvidence(result) ?? undefined;
      return txHash ? { txHash } : {};
    },
    async ensureChainLiquidity({ requestId, asset, network, requiredAmount, sourceKind }: EnsureChainLiquidityArgs) {
      const result = (await rpcCall(endpoint, "rebalance_to_ckb_chain", {
        request_id: requestId,
        asset,
        network,
        required_amount: toHexQuantity(requiredAmount),
        source_kind: sourceKind,
      })) as Record<string, unknown> | undefined;
      return parseEnsureChainLiquidityResult(result);
    },
    async getRebalanceStatus({ requestId }: GetRebalanceStatusArgs) {
      const result = (await rpcCall(endpoint, "get_rebalance_status", {
        request_id: requestId,
      })) as Record<string, unknown> | undefined;
      return parseGetRebalanceStatusResult(result);
    },
  };
}
