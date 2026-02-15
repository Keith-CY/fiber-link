import { createAdapter } from "@fiber-link/fiber-adapter";
import {
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentRepo,
  type DbClient,
  type LedgerRepo,
  type TipIntentListCursor,
  type TipIntentRepo,
} from "@fiber-link/db";
import { createSettlementUpdateEvent, type SettlementState, type SettlementUpdateEvent } from "./contracts";
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

export async function runSettlementDiscovery(options: SettlementDiscoveryOptions): Promise<SettlementDiscoverySummary> {
  const tipIntentRepo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  const adapter = options.adapter ?? getDefaultAdapter();
  const nowMsFn = options.nowMsFn ?? Date.now;
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
        settledLatenciesMs.push(Math.max(0, nowMsFn() - intent.createdAt.getTime()));
        continue;
      }

      if (observedState === "FAILED") {
        await tipIntentRepo.updateInvoiceState(intent.invoice, "FAILED");
        summary.failed += 1;
        summary.events.push(
          createSettlementUpdateEvent({
            invoice: intent.invoice,
            previousState,
            observedState,
            nextState: "FAILED",
            outcome: "FAILED_MARKED",
            ledgerCreditApplied: false,
          }),
        );
        continue;
      }

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
      summary.errors += 1;
      logger.error("[worker] settlement discovery item failed", {
        invoice: intent.invoice,
        error: error instanceof Error ? error.message : String(error),
      });
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
