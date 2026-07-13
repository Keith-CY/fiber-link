import { zodToJsonSchema } from "zod-to-json-schema";
import type { ZodTypeAny } from "zod";
import { z } from "zod";
import {
  DashboardAnalyticsParamsSchema,
  DashboardAnalyticsResultSchema,
  DashboardSummaryParamsSchema,
  DashboardSummaryResultSchema,
  NotificationChannelCreateParamsSchema,
  NotificationChannelCreateResultSchema,
  NotificationChannelListParamsSchema,
  NotificationChannelListResultSchema,
  RpcErrorCode,
  TipCreateParamsSchema,
  TipCreateResultSchema,
  TipSettledFeedParamsSchema,
  TipSettledFeedResultSchema,
  TipStatusParamsSchema,
  TipStatusResultSchema,
  WithdrawalQuoteParamsSchema,
  WithdrawalQuoteResultSchema,
  WithdrawalRequestParamsSchema,
  WithdrawalRequestResultSchema,
} from "./contracts";

const HealthPingParamsSchema = z.object({}).passthrough().describe("Ignored; any params are accepted.");
const HealthPingResultSchema = z.object({ status: z.literal("ok") });

type MethodSchemaEntry = {
  params: ZodTypeAny;
  result: ZodTypeAny;
  description: string;
  aliasOf?: string;
};

// Keep in sync with the dispatch table in rpc.ts (registerRpc) and the bounded
// metrics label set in metrics.ts; rpc-schema.test.ts enforces the parity.
const METHOD_SCHEMAS: Record<string, MethodSchemaEntry> = {
  "health.ping": {
    params: HealthPingParamsSchema,
    result: HealthPingResultSchema,
    description: "Liveness probe over signed JSON-RPC; returns { status: \"ok\" }.",
  },
  "tip.create": {
    params: TipCreateParamsSchema,
    result: TipCreateResultSchema,
    description: "Create a Fiber payment invoice for tipping a post.",
  },
  "tip.status": {
    params: TipStatusParamsSchema,
    result: TipStatusResultSchema,
    description: "Poll the settlement state of a tip invoice.",
  },
  "tip.get": {
    params: TipStatusParamsSchema,
    result: TipStatusResultSchema,
    description: "Alias of tip.status.",
    aliasOf: "tip.status",
  },
  "tip.settled_feed": {
    params: TipSettledFeedParamsSchema,
    result: TipSettledFeedResultSchema,
    description: "Cursor-paginated feed of settled tips for the authenticated app.",
  },
  "dashboard.summary": {
    params: DashboardSummaryParamsSchema,
    result: DashboardSummaryResultSchema,
    description: "Per-user dashboard summary (balances, tips, withdrawals).",
  },
  "dashboard.analytics": {
    params: DashboardAnalyticsParamsSchema,
    result: DashboardAnalyticsResultSchema,
    description: "Aggregated tipping analytics for the authenticated app.",
  },
  "withdrawal.quote": {
    params: WithdrawalQuoteParamsSchema,
    result: WithdrawalQuoteResultSchema,
    description: "Quote a withdrawal (policy checks, liquidity, fees) without executing it.",
  },
  "withdrawal.request": {
    params: WithdrawalRequestParamsSchema,
    result: WithdrawalRequestResultSchema,
    description: "Request an asynchronous withdrawal to a payment request or CKB address.",
  },
  "notification.channel.create": {
    params: NotificationChannelCreateParamsSchema,
    result: NotificationChannelCreateResultSchema,
    description: "Register a webhook notification channel for the authenticated app.",
  },
  "notification.channel.list": {
    params: NotificationChannelListParamsSchema as unknown as ZodTypeAny,
    result: NotificationChannelListResultSchema,
    description: "List the authenticated app's notification channels.",
  },
};

function toJsonSchema(schema: ZodTypeAny, name: string): unknown {
  // $refStrategy none inlines shared schemas so each method document is
  // self-contained for integrators.
  return zodToJsonSchema(schema, { name, $refStrategy: "none" });
}

/**
 * Build the machine-readable description of the public JSON-RPC surface from
 * the same zod contracts the server validates against. The committed artifact
 * lives at docs/rpc-schema.json; regenerate it with `bun run schema:generate`
 * in apps/rpc. rpc-schema.test.ts fails when the artifact drifts.
 */
export function buildRpcSchemaDocument() {
  const methods: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(METHOD_SCHEMAS)) {
    methods[name] = {
      description: entry.description,
      ...(entry.aliasOf ? { aliasOf: entry.aliasOf } : {}),
      params: toJsonSchema(entry.params, `${name}.params`),
      result: toJsonSchema(entry.result, `${name}.result`),
    };
  }

  return {
    name: "fiber-link-rpc",
    description:
      "Machine-readable description of the Fiber Link JSON-RPC surface, generated from the zod contracts in apps/rpc/src/contracts.ts.",
    schemaVersion: 1,
    transport: {
      endpoint: "POST /rpc",
      protocol: "JSON-RPC 2.0",
      authentication:
        "HMAC-SHA256 request signing via x-app-id, x-ts, x-nonce, and x-signature headers; see docs and @fiber-link/client for the signing scheme.",
      streaming:
        "GET /rpc/stream?invoice=... serves Server-Sent Events for settlement updates (LISTENING, SETTLED, TIMEOUT).",
    },
    errorCodes: RpcErrorCode,
    methods,
  };
}

export function knownSchemaMethods(): string[] {
  return Object.keys(METHOD_SCHEMAS);
}
