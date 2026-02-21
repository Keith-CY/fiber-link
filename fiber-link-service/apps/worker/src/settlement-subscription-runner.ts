import type { LedgerRepo, TipIntentRepo } from "@fiber-link/db";
import { createComponentLogger, type WorkerLogContext } from "./logger";
import { markSettled } from "./settlement";

type QueueOverflowInfo = {
  invoice: string;
  queueLength: number;
  inFlight: number;
  droppedTotal: number;
  policy: "drop_new";
};

type SettlementSubscriptionLogger = {
  info: (event: string, context?: WorkerLogContext) => void;
  error: (event: string, context?: WorkerLogContext) => void;
};

type SettlementSubscriptionHandle = {
  close: () => void | Promise<void>;
};

type SettlementSubscriptionAdapter = {
  subscribeSettlements: (args: {
    onSettled: (invoice: string) => void | Promise<void>;
    onError?: (error: unknown) => void;
  }) => Promise<SettlementSubscriptionHandle>;
};

export type StartSettlementSubscriptionRunnerOptions = {
  adapter: SettlementSubscriptionAdapter;
  tipIntentRepo?: TipIntentRepo;
  ledgerRepo?: LedgerRepo;
  logger?: SettlementSubscriptionLogger;
  concurrency?: number;
  maxPendingEvents?: number;
  recentInvoiceDedupeSize?: number;
  onQueueOverflow?: (info: QueueOverflowInfo) => void;
};

export type SettlementSubscriptionRunner = {
  close: () => Promise<void>;
};

const defaultLogger: SettlementSubscriptionLogger = {
  ...createComponentLogger("settlement-subscription-runner"),
};

function parseIntegerOption({
  name,
  value,
  min,
  fallback,
}: {
  name: string;
  value: number | undefined;
  min: number;
  fallback: number;
}): number {
  if (value === undefined) {
    return fallback;
  }
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`Invalid ${name}: expected integer >= ${min}, received ${String(value)}`);
  }
  return value;
}

export async function startSettlementSubscriptionRunner(
  options: StartSettlementSubscriptionRunnerOptions,
): Promise<SettlementSubscriptionRunner> {
  const logger = options.logger ?? defaultLogger;
  const concurrency = parseIntegerOption({
    name: "concurrency",
    value: options.concurrency,
    min: 1,
    fallback: 1,
  });
  const maxPendingEvents = parseIntegerOption({
    name: "maxPendingEvents",
    value: options.maxPendingEvents,
    min: 0,
    fallback: 1000,
  });
  const recentInvoiceDedupeSize = parseIntegerOption({
    name: "recentInvoiceDedupeSize",
    value: options.recentInvoiceDedupeSize,
    min: 0,
    fallback: 256,
  });

  const queue: string[] = [];
  const activeInvoices = new Set<string>();
  const recentInvoices = new Set<string>();
  const recentOrder: string[] = [];
  let inFlight = 0;
  let closing = false;
  let overflowDropped = 0;
  let deduped = 0;
  let drainingPromise: Promise<void> | null = null;
  let resolveDraining: (() => void) | null = null;

  const markRecent = (invoice: string) => {
    if (recentInvoiceDedupeSize === 0 || recentInvoices.has(invoice)) {
      return;
    }
    recentInvoices.add(invoice);
    recentOrder.push(invoice);
    while (recentOrder.length > recentInvoiceDedupeSize) {
      const removed = recentOrder.shift();
      if (removed) {
        recentInvoices.delete(removed);
      }
    }
  };

  const createDrainingPromise = () => {
    if (drainingPromise) {
      return drainingPromise;
    }
    drainingPromise = new Promise<void>((resolve) => {
      resolveDraining = resolve;
    });
    return drainingPromise;
  };

  const notifyIfDrained = () => {
    if (queue.length === 0 && inFlight === 0 && resolveDraining) {
      const resolve = resolveDraining;
      resolveDraining = null;
      drainingPromise = null;
      resolve();
    }
  };

  const runQueue = () => {
    while (inFlight < concurrency && queue.length > 0) {
      const invoice = queue.shift();
      if (!invoice) {
        continue;
      }
      inFlight += 1;

      void (async () => {
        try {
          const result = await markSettled(
            { invoice },
            {
              tipIntentRepo: options.tipIntentRepo,
              ledgerRepo: options.ledgerRepo,
            },
          );
          logger.info("settlement.subscription.processed", {
            invoice,
            requestId: `settlement:${invoice}`,
            credited: result.credited,
            idempotencyKey: result.idempotencyKey,
          });
        } catch (error) {
          logger.error("settlement.subscription.process_failed", {
            invoice,
            requestId: `settlement:${invoice}`,
            error: error instanceof Error ? error.message : String(error),
          });
        } finally {
          inFlight -= 1;
          activeInvoices.delete(invoice);
          markRecent(invoice);
          notifyIfDrained();
          runQueue();
        }
      })();
    }
  };

  const enqueue = (invoice: string) => {
    if (closing) {
      logger.error("settlement.subscription.ignored_during_shutdown", {
        invoice,
        requestId: `settlement:${invoice}`,
      });
      return;
    }

    if (activeInvoices.has(invoice) || recentInvoices.has(invoice)) {
      deduped += 1;
      logger.info("settlement.subscription.deduped", {
        invoice,
        requestId: `settlement:${invoice}`,
        dedupedTotal: deduped,
      });
      return;
    }

    if (inFlight >= concurrency && queue.length >= maxPendingEvents) {
      overflowDropped += 1;
      const info: QueueOverflowInfo = {
        invoice,
        queueLength: queue.length,
        inFlight,
        droppedTotal: overflowDropped,
        policy: "drop_new",
      };
      options.onQueueOverflow?.(info);
      logger.error("settlement.subscription.queue_overflow", {
        ...info,
        requestId: `settlement:${invoice}`,
        fallback: "polling",
      });
      return;
    }

    queue.push(invoice);
    activeInvoices.add(invoice);
    runQueue();
  };

  const subscription = await options.adapter.subscribeSettlements({
    onSettled: async (invoice) => {
      enqueue(invoice);
    },
    onError: (error) => {
      logger.error("settlement.subscription.stream_failed", { error });
    },
  });

  return {
    async close() {
      closing = true;
      try {
        await subscription.close();
      } catch (error) {
        logger.error("settlement.subscription.shutdown_failed", { error });
      }

      if (queue.length > 0 || inFlight > 0) {
        await createDrainingPromise();
      }
      notifyIfDrained();

      logger.info("settlement.subscription.shutdown_summary", {
        droppedOverflowEvents: overflowDropped,
        dedupedEvents: deduped,
        queueLength: queue.length,
        inFlight,
      });
    },
  };
}
