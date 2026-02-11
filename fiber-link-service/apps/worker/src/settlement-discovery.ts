import { createAdapter } from "@fiber-link/fiber-adapter";
import {
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentRepo,
  type DbClient,
  type LedgerRepo,
  type TipIntentRepo,
} from "@fiber-link/db";
import { markSettled } from "./settlement";

type SettlementAdapter = {
  getInvoiceStatus: (input: { invoice: string }) => Promise<{ state: "UNPAID" | "SETTLED" | "FAILED" }>;
};

type SettlementLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown) => void;
};

export type SettlementDiscoveryOptions = {
  limit: number;
  appId?: string;
  createdAtFrom?: Date;
  createdAtTo?: Date;
  adapter?: SettlementAdapter;
  tipIntentRepo?: TipIntentRepo;
  ledgerRepo?: LedgerRepo;
  logger?: SettlementLogger;
};

export type SettlementDiscoverySummary = {
  scanned: number;
  settledCredits: number;
  settledDuplicates: number;
  failed: number;
  stillUnpaid: number;
  errors: number;
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

export async function runSettlementDiscovery(options: SettlementDiscoveryOptions): Promise<SettlementDiscoverySummary> {
  const tipIntentRepo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  const adapter = options.adapter ?? getDefaultAdapter();
  const logger = options.logger ?? defaultLogger;

  const intents = await tipIntentRepo.listByInvoiceState("UNPAID", {
    appId: options.appId,
    createdAtFrom: options.createdAtFrom,
    createdAtTo: options.createdAtTo,
    limit: options.limit,
  });

  const summary: SettlementDiscoverySummary = {
    scanned: intents.length,
    settledCredits: 0,
    settledDuplicates: 0,
    failed: 0,
    stillUnpaid: 0,
    errors: 0,
  };

  for (const intent of intents) {
    try {
      const status = await adapter.getInvoiceStatus({ invoice: intent.invoice });
      if (status.state === "SETTLED") {
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
        continue;
      }

      if (status.state === "FAILED") {
        await tipIntentRepo.updateInvoiceState(intent.invoice, "FAILED");
        summary.failed += 1;
        continue;
      }

      summary.stillUnpaid += 1;
    } catch (error) {
      summary.errors += 1;
      logger.error("[worker] settlement discovery item failed", {
        invoice: intent.invoice,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  logger.info("[worker] settlement discovery summary", summary);
  return summary;
}
