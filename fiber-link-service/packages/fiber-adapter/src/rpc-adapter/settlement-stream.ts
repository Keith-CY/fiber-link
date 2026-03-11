import { mapInvoiceState } from "./invoice-ops";
import { pickStringCandidate, parseBoolean, parsePositiveInteger } from "./normalize";
import type {
  SettlementSubscriptionConfig,
  SettlementSubscriptionHandle,
  SubscribeSettlementsArgs,
} from "../types";

const DEFAULT_SETTLEMENT_SUBSCRIPTION_RECONNECT_DELAY_MS = 3_000;

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

export function createSettlementSubscriber(
  config: SettlementSubscriptionConfig | undefined,
  resolvedFetch: typeof fetch,
) {
  const subscriptionConfig = resolveSettlementSubscriptionConfig(config);

  return async function subscribeSettlements(args: SubscribeSettlementsArgs): Promise<SettlementSubscriptionHandle> {
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
          const response = await resolvedFetch(subscriptionConfig.url!, {
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
  };
}
