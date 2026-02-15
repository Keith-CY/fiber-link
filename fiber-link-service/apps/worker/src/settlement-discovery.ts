import { FiberRpcError, createAdapter } from "@fiber-link/fiber-adapter";
import {
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentRepo,
  type DbClient,
  type LedgerRepo,
  type SettlementFailureReason,
  type TipIntentListCursor,
  type TipIntentRepo,
} from "@fiber-link/db";
import { createSettlementUpdateEvent, type SettlementUpdateEvent } from "./contracts";
import { markSettled } from "./settlement";

type SettlementAdapter = {
  getInvoiceStatus: (input: { invoice: string }) => Promise<{ state: unknown }>;
};

type SettlementLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown) => void;
};

type LatencySummary = {
  count: number;
  p50: number | null;
  p95: number | null;
  max: number | null;
};

const SETTLEMENT_STATES = ["UNPAID", "SETTLED", "FAILED"] as const;
type SettlementState = (typeof SETTLEMENT_STATES)[number];
const SETTLEMENT_STATE_SET: ReadonlySet<string> = new Set(SETTLEMENT_STATES);

export class SettlementStatusContractError extends Error {
  constructor(
    public readonly invoice: string,
    public readonly receivedState: unknown,
  ) {
    super(`invalid settlement status state for invoice ${invoice}: ${String(receivedState)}`);
    this.name = "SettlementStatusContractError";
  }
}

export type SettlementDiscoveryOptions = {
  limit: number;
  appId?: string;
  createdAtFrom?: Date;
  createdAtTo?: Date;
  cursor?: TipIntentListCursor;
  maxRetries?: number;
  retryDelayMs?: number;
  pendingTimeoutMs?: number;
  adapter?: SettlementAdapter;
  tipIntentRepo?: TipIntentRepo;
  ledgerRepo?: LedgerRepo;
  nowMsFn?: () => number;
  logger?: SettlementLogger;
};

export type SettlementDiscoverySummary = {
  scanned: number;
  settledCredits: number;
  settledDuplicates: number;
  failed: number;
  retryScheduled: number;
  terminalFailures: number;
  skippedRetryPending: number;
  stillUnpaid: number;
  errors: number;
  events: SettlementUpdateEvent[];
  nextCursor: TipIntentListCursor | null;
  backlogUnpaidBeforeScan: number;
  backlogUnpaidAfterScan: number;
  detectionLatencyMs: LatencySummary;
};

const defaultLogger: SettlementLogger = {
  info(message, context) {
    console.log(message, context ?? {});
  },
  error(message, error) {
    console.error(message, error);
  },
};

let defaultDb: DbClient | null = null;
let defaultTipIntentRepo: TipIntentRepo | null = null;
let defaultLedgerRepo: LedgerRepo | null = null;
let defaultAdapter: SettlementAdapter | null = null;

function getDefaultDb(): DbClient {
  if (!defaultDb) {
    defaultDb = createDbClient();
  }
  return defaultDb;
}

function getDefaultTipIntentRepo(): TipIntentRepo {
  if (!defaultTipIntentRepo) {
    defaultTipIntentRepo = createDbTipIntentRepo(getDefaultDb());
  }
  return defaultTipIntentRepo;
}

function getDefaultLedgerRepo(): LedgerRepo {
  if (!defaultLedgerRepo) {
    defaultLedgerRepo = createDbLedgerRepo(getDefaultDb());
  }
  return defaultLedgerRepo;
}

function getDefaultAdapter(): SettlementAdapter {
  if (!defaultAdapter) {
    const endpoint = process.env.FIBER_RPC_URL;
    if (!endpoint) {
      throw new Error("FIBER_RPC_URL is required for settlement discovery");
    }
    defaultAdapter = createAdapter({ endpoint });
  }
  return defaultAdapter;
}

function summarizeLatency(values: number[]): LatencySummary {
  if (values.length === 0) {
    return {
      count: 0,
      p50: null,
      p95: null,
      max: null,
    };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const percentile = (p: number) => {
    const index = Math.ceil(p * sorted.length) - 1;
    return sorted[Math.max(0, Math.min(index, sorted.length - 1))];
  };

  return {
    count: sorted.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    max: sorted[sorted.length - 1] ?? null,
  };
}

function parseSettlementState(invoice: string, state: unknown): SettlementState {
  if (typeof state === "string" && SETTLEMENT_STATE_SET.has(state)) {
    return state as SettlementState;
  }
  throw new SettlementStatusContractError(invoice, state);
}

const TERMINAL_RPC_ERROR_CODES = new Set([-32600, -32601, -32602]);
const TRANSIENT_RPC_ERROR_CODES = new Set([-32603]);
const TRANSIENT_MESSAGE_PATTERN = /(timeout|temporar|busy|unavailable|connect|network|throttle|rate limit|econn)/i;

type SettlementErrorDecision =
  | { kind: "TRANSIENT"; reason: "RETRY_TRANSIENT_ERROR"; message: string }
  | { kind: "TERMINAL"; reason: SettlementFailureReason; message: string };

function mapFailureReasonToOutcome(
  reason: SettlementFailureReason,
):
  | "FAILED_UPSTREAM_REPORTED"
  | "FAILED_PENDING_TIMEOUT"
  | "FAILED_CONTRACT_MISMATCH"
  | "FAILED_RETRY_EXHAUSTED"
  | "FAILED_TERMINAL_ERROR" {
  if (reason === "FAILED_UPSTREAM_REPORTED") return "FAILED_UPSTREAM_REPORTED";
  if (reason === "FAILED_PENDING_TIMEOUT") return "FAILED_PENDING_TIMEOUT";
  if (reason === "FAILED_CONTRACT_MISMATCH") return "FAILED_CONTRACT_MISMATCH";
  if (reason === "FAILED_RETRY_EXHAUSTED") return "FAILED_RETRY_EXHAUSTED";
  return "FAILED_TERMINAL_ERROR";
}

function classifySettlementError(error: unknown): SettlementErrorDecision {
  if (error instanceof SettlementStatusContractError) {
    return {
      kind: "TERMINAL",
      reason: "FAILED_CONTRACT_MISMATCH",
      message: error.message,
    };
  }

  const fiberRpcCtor: unknown = FiberRpcError;
  const isFiberRpcError =
    typeof fiberRpcCtor === "function" && error instanceof (fiberRpcCtor as typeof FiberRpcError);

  if (isFiberRpcError) {
    const rpcError = error as FiberRpcError;
    if (typeof rpcError.code === "number") {
      if (TERMINAL_RPC_ERROR_CODES.has(rpcError.code)) {
        return {
          kind: "TERMINAL",
          reason: "FAILED_TERMINAL_ERROR",
          message: rpcError.message,
        };
      }
      if (TRANSIENT_RPC_ERROR_CODES.has(rpcError.code) || (rpcError.code <= -32000 && rpcError.code >= -32099)) {
        return {
          kind: "TRANSIENT",
          reason: "RETRY_TRANSIENT_ERROR",
          message: rpcError.message,
        };
      }
    }

    return {
      kind: "TRANSIENT",
      reason: "RETRY_TRANSIENT_ERROR",
      message: rpcError.message,
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  if (TRANSIENT_MESSAGE_PATTERN.test(message)) {
    return {
      kind: "TRANSIENT",
      reason: "RETRY_TRANSIENT_ERROR",
      message,
    };
  }

  return {
    kind: "TRANSIENT",
    reason: "RETRY_TRANSIENT_ERROR",
    message,
  };
}

export async function runSettlementDiscovery(options: SettlementDiscoveryOptions): Promise<SettlementDiscoverySummary> {
  const tipIntentRepo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  const adapter = options.adapter ?? getDefaultAdapter();
  const nowMsFn = options.nowMsFn ?? Date.now;
  const maxRetries = options.maxRetries ?? 3;
  const retryDelayMs = options.retryDelayMs ?? 60_000;
  const pendingTimeoutMs = options.pendingTimeoutMs ?? 30 * 60_000;
  const logger = options.logger ?? defaultLogger;

  const baseQueryOptions = {
    appId: options.appId,
    createdAtFrom: options.createdAtFrom,
    createdAtTo: options.createdAtTo,
    limit: options.limit,
  };

  const backlogUnpaidBeforeScan = await tipIntentRepo.countByInvoiceState("UNPAID", baseQueryOptions);

  let intents = await tipIntentRepo.listByInvoiceState("UNPAID", {
    ...baseQueryOptions,
    after: options.cursor,
  });
  if (options.cursor && intents.length === 0) {
    intents = await tipIntentRepo.listByInvoiceState("UNPAID", baseQueryOptions);
  }

  const summary: SettlementDiscoverySummary = {
    scanned: intents.length,
    settledCredits: 0,
    settledDuplicates: 0,
    failed: 0,
    retryScheduled: 0,
    terminalFailures: 0,
    skippedRetryPending: 0,
    stillUnpaid: 0,
    errors: 0,
    events: [],
    nextCursor: null,
    backlogUnpaidBeforeScan,
    backlogUnpaidAfterScan: backlogUnpaidBeforeScan,
    detectionLatencyMs: {
      count: 0,
      p50: null,
      p95: null,
      max: null,
    },
  };
  const settledLatenciesMs: number[] = [];

  for (const intent of intents) {
    const previousState = intent.invoiceState as SettlementState;
    const nowMs = nowMsFn();
    const now = new Date(nowMs);

    if (intent.settlementNextRetryAt && intent.settlementNextRetryAt.getTime() > nowMs) {
      summary.skippedRetryPending += 1;
      continue;
    }

    try {
      const status = await adapter.getInvoiceStatus({ invoice: intent.invoice });
      const observedState = parseSettlementState(intent.invoice, status?.state);

      if (observedState === "SETTLED") {
        const result = await markSettled(
          { invoice: intent.invoice },
          {
            tipIntentRepo,
            ledgerRepo,
          },
        );
        await tipIntentRepo.clearSettlementFailure(intent.invoice, { now });
        if (result.credited) {
          summary.settledCredits += 1;
        } else {
          summary.settledDuplicates += 1;
        }
        summary.events.push(
          createSettlementUpdateEvent({
            invoice: intent.invoice,
            previousState,
            observedState,
            nextState: "SETTLED",
            outcome: result.credited ? "SETTLED_CREDIT_APPLIED" : "SETTLED_DUPLICATE",
            ledgerCreditApplied: result.credited,
          }),
        );
        settledLatenciesMs.push(Math.max(0, nowMs - intent.createdAt.getTime()));
        continue;
      }

      if (observedState === "FAILED") {
        await tipIntentRepo.markSettlementTerminalFailure(intent.invoice, {
          now,
          reason: "FAILED_UPSTREAM_REPORTED",
          error: "upstream invoice state reported FAILED",
        });
        summary.failed += 1;
        summary.terminalFailures += 1;
        const event = createSettlementUpdateEvent({
          invoice: intent.invoice,
          previousState,
          observedState,
          nextState: "FAILED",
          outcome: "FAILED_UPSTREAM_REPORTED",
          ledgerCreditApplied: false,
          failureClass: "TERMINAL",
          error: "upstream invoice state reported FAILED",
        });
        summary.events.push(event);
        logger.info("[worker] settlement audit", event);
        continue;
      }

      if (nowMs - intent.createdAt.getTime() >= pendingTimeoutMs) {
        const timeoutMessage = `invoice remained UNPAID past timeout (${pendingTimeoutMs}ms)`;
        await tipIntentRepo.markSettlementTerminalFailure(intent.invoice, {
          now,
          reason: "FAILED_PENDING_TIMEOUT",
          error: timeoutMessage,
        });
        summary.failed += 1;
        summary.terminalFailures += 1;
        const event = createSettlementUpdateEvent({
          invoice: intent.invoice,
          previousState,
          observedState,
          nextState: "FAILED",
          outcome: "FAILED_PENDING_TIMEOUT",
          ledgerCreditApplied: false,
          failureClass: "TERMINAL",
          error: timeoutMessage,
        });
        summary.events.push(event);
        logger.info("[worker] settlement audit", event);
        continue;
      }

      await tipIntentRepo.clearSettlementFailure(intent.invoice, { now });
      summary.stillUnpaid += 1;
      summary.events.push(
        createSettlementUpdateEvent({
          invoice: intent.invoice,
          previousState,
          observedState,
          nextState: "UNPAID",
          outcome: "NO_CHANGE",
          ledgerCreditApplied: false,
        }),
      );
    } catch (error) {
      const decision = classifySettlementError(error);
      try {
        if (decision.kind === "TRANSIENT") {
          const nextRetryCount = intent.settlementRetryCount + 1;
          if (nextRetryCount > maxRetries) {
            await tipIntentRepo.markSettlementTerminalFailure(intent.invoice, {
              now,
              reason: "FAILED_RETRY_EXHAUSTED",
              error: decision.message,
            });
            summary.failed += 1;
            summary.terminalFailures += 1;
            const event = createSettlementUpdateEvent({
              invoice: intent.invoice,
              previousState,
              observedState: "UNPAID",
              nextState: "FAILED",
              outcome: "FAILED_RETRY_EXHAUSTED",
              ledgerCreditApplied: false,
              failureClass: "TERMINAL",
              retryCount: nextRetryCount,
              error: decision.message,
            });
            summary.events.push(event);
            logger.info("[worker] settlement audit", event);
            continue;
          }

          const nextRetryAt = new Date(nowMs + retryDelayMs);
          await tipIntentRepo.markSettlementRetryPending(intent.invoice, {
            now,
            nextRetryAt,
            error: decision.message,
          });
          summary.retryScheduled += 1;
          const event = createSettlementUpdateEvent({
            invoice: intent.invoice,
            previousState,
            observedState: "UNPAID",
            nextState: "UNPAID",
            outcome: "RETRY_SCHEDULED_TRANSIENT",
            ledgerCreditApplied: false,
            failureClass: "TRANSIENT",
            retryCount: nextRetryCount,
            nextRetryAt: nextRetryAt.toISOString(),
            error: decision.message,
          });
          summary.events.push(event);
          logger.info("[worker] settlement audit", event);
          continue;
        }

        await tipIntentRepo.markSettlementTerminalFailure(intent.invoice, {
          now,
          reason: decision.reason,
          error: decision.message,
        });
        summary.failed += 1;
        summary.terminalFailures += 1;
        const event = createSettlementUpdateEvent({
          invoice: intent.invoice,
          previousState,
          observedState: "UNPAID",
          nextState: "FAILED",
          outcome: mapFailureReasonToOutcome(decision.reason),
          ledgerCreditApplied: false,
          failureClass: "TERMINAL",
          error: decision.message,
        });
        summary.events.push(event);
        logger.info("[worker] settlement audit", event);
      } catch (handlerError) {
        summary.errors += 1;
        logger.error("[worker] settlement discovery item failed", {
          invoice: intent.invoice,
          error: handlerError instanceof Error ? handlerError.message : String(handlerError),
          originalError: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }

  if (intents.length > 0) {
    const last = intents[intents.length - 1];
    summary.nextCursor = {
      createdAt: last.createdAt,
      id: last.id,
    };
  }

  summary.backlogUnpaidAfterScan = await tipIntentRepo.countByInvoiceState("UNPAID", baseQueryOptions);
  summary.detectionLatencyMs = summarizeLatency(settledLatenciesMs);

  logger.info("[worker] settlement discovery summary", summary);
  return summary;
}
