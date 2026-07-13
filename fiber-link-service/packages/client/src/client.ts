import { FiberLinkNetworkError, FiberLinkResponseError, FiberLinkValidationError } from "./errors";

export type FiberLinkClientMode = "signed" | "presigned";

export type FiberLinkClientOptions = {
  /** Base URL of the RPC endpoint (e.g. "https://example.com/fiber-link/rpc" or "/fiber-link/rpc"). */
  endpoint: string;
  /**
   * "signed"    – SDK builds HMAC-signed headers using appId + hmacSecret. For server-side / trusted clients.
   * "presigned" – SDK omits auth headers; the server-side proxy (e.g. Discourse) handles signing.
   */
  mode: FiberLinkClientMode;
  /** Required when mode is "signed". */
  appId?: string;
  /** Required when mode is "signed". */
  hmacSecret?: string;
  timeoutMs?: number;
};

export type TipStatus = "UNPAID" | "SETTLED" | "FAILED";
export type StreamStatus = "LISTENING" | "SETTLED" | "TIMEOUT" | "SSE_ERROR";

export type StreamHandle = { close(): void };
export type StreamEvent = {
  invoice: string;
  status: StreamStatus;
  /** ISO timestamp; present on SETTLED events published by the settlement worker. */
  settledAt?: string;
};

const DEFAULT_TIMEOUT_MS = 15_000;

function buildRequestId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

async function buildSignedHeaders(appId: string, secret: string, payload: string): Promise<Record<string, string>> {
  const ts = String(Math.floor(Date.now() / 1000));
  const nonce = buildRequestId().replace(/-/g, "").slice(0, 16);
  const message = `${ts}.${nonce}.${payload}`;

  let signature: string;
  if (typeof crypto !== "undefined" && crypto.subtle) {
    const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
    signature = Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  } else {
    // Node.js fallback (server-side usage)
    const { createHmac } = await import("node:crypto");
    signature = createHmac("sha256", secret).update(message).digest("hex");
  }

  return {
    "x-app-id": appId,
    "x-ts": ts,
    "x-nonce": nonce,
    "x-signature": signature,
  };
}

export class FiberLinkClient {
  private readonly endpoint: string;
  private readonly mode: FiberLinkClientMode;
  private readonly appId?: string;
  private readonly hmacSecret?: string;
  private readonly timeoutMs: number;

  constructor(options: FiberLinkClientOptions) {
    if (!options.endpoint?.trim()) {
      throw new FiberLinkValidationError("endpoint", "endpoint is required");
    }
    if (options.mode === "signed") {
      if (!options.appId?.trim()) {
        throw new FiberLinkValidationError("appId", "appId is required in signed mode");
      }
      if (!options.hmacSecret?.trim()) {
        throw new FiberLinkValidationError("hmacSecret", "hmacSecret is required in signed mode");
      }
    }
    this.endpoint = options.endpoint.replace(/\/$/, "");
    this.mode = options.mode;
    this.appId = options.appId;
    this.hmacSecret = options.hmacSecret;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async rpcCall<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: buildRequestId(),
      method,
      params,
    });

    const headers: Record<string, string> = { "Content-Type": "application/json" };

    if (this.mode === "signed" && this.appId && this.hmacSecret) {
      const authHeaders = await buildSignedHeaders(this.appId, this.hmacSecret, payload);
      Object.assign(headers, authHeaders);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);

    let response: Response;
    try {
      response = await fetch(this.endpoint, {
        method: "POST",
        headers,
        body: payload,
        signal: controller.signal,
      });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      throw new FiberLinkNetworkError(
        e instanceof Error && e.name === "AbortError" ? `Request timed out after ${this.timeoutMs}ms` : msg,
      );
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok && response.status !== 200) {
      throw new FiberLinkNetworkError(`HTTP ${response.status}`);
    }

    let body: { result?: T; error?: { code?: number; message?: string } } | null;
    try {
      body = (await response.json()) as typeof body;
    } catch {
      throw new FiberLinkResponseError(undefined, "Invalid JSON response from server");
    }

    if (body?.error) {
      throw new FiberLinkResponseError(body.error.code, body.error.message ?? "RPC error");
    }
    if (!body) {
      throw new FiberLinkResponseError(undefined, "Invalid or empty response from server");
    }

    return body.result as T;
  }

  /**
   * Create a tip invoice for a post.
   * Returns `{ invoice, invoiceQrDataUrl? }`.
   */
  async createTip(params: {
    postId: string;
    fromUserId: string;
    toUserId: string;
    amount: string;
    asset?: string;
    message?: string | null;
  }): Promise<{ invoice: string; invoiceQrDataUrl?: string }> {
    if (!params.postId?.trim()) throw new FiberLinkValidationError("postId", "postId is required");
    if (!params.fromUserId?.trim()) throw new FiberLinkValidationError("fromUserId", "fromUserId is required");
    if (!params.toUserId?.trim()) throw new FiberLinkValidationError("toUserId", "toUserId is required");
    if (!params.amount?.trim() || !(Number(params.amount) > 0)) {
      throw new FiberLinkValidationError("amount", "amount must be a positive number");
    }

    return this.rpcCall("tip.create", {
      postId: params.postId,
      fromUserId: params.fromUserId,
      toUserId: params.toUserId,
      amount: params.amount,
      asset: params.asset ?? "CKB",
      message: params.message ?? null,
    });
  }

  /**
   * Poll the settlement status of an invoice.
   * Returns `{ state: "UNPAID" | "SETTLED" | "FAILED" }`.
   */
  async getTipStatus(invoice: string): Promise<{ state: TipStatus }> {
    if (!invoice?.trim()) throw new FiberLinkValidationError("invoice", "invoice is required");
    return this.rpcCall("tip.status", { invoice });
  }

  /**
   * Stream settlement status via Server-Sent Events.
   * Falls back gracefully when `EventSource` is unavailable (e.g., Node.js).
   * Returns a `StreamHandle` with `.close()`, or `null` if SSE is not available.
   *
   * In "signed" mode the configured appId is sent as a query param —
   * `EventSource` cannot set headers — so the server can verify the invoice
   * belongs to this app. In "presigned" mode the server-side proxy injects
   * the `x-app-id` header instead.
   *
   * `onEvent` receives `StreamEvent` objects: LISTENING → SETTLED | TIMEOUT | SSE_ERROR.
   */
  streamTipStatus(invoice: string, onEvent: (event: StreamEvent) => void): StreamHandle | null {
    if (!invoice?.trim()) throw new FiberLinkValidationError("invoice", "invoice is required");

    const appIdParam = this.appId ? `&appId=${encodeURIComponent(this.appId)}` : "";
    const streamUrl = `${this.endpoint}/stream?invoice=${encodeURIComponent(invoice)}${appIdParam}`;

    if (typeof EventSource === "undefined") {
      return null;
    }

    let es: EventSource;
    try {
      es = new EventSource(streamUrl);
    } catch {
      return null;
    }

    es.onmessage = (event: MessageEvent) => {
      try {
        const data = JSON.parse(event.data as string);
        if (data && typeof data === "object" && "status" in data) {
          onEvent(data as StreamEvent);
          if (data.status === "SETTLED" || data.status === "TIMEOUT") {
            es.close();
          }
        }
      } catch {
        // ignore malformed events
      }
    };

    es.onerror = () => {
      es.close();
      onEvent({ invoice, status: "SSE_ERROR" });
    };

    return { close: () => es.close() };
  }
}
