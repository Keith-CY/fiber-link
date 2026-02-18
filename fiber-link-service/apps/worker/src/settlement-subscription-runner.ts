import type { LedgerRepo, TipIntentRepo } from "@fiber-link/db";
import { markSettled } from "./settlement";
import { defaultWorkerLogger, logWithContract, type WorkerLogger } from "./worker-logging";

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
  logger?: WorkerLogger;
};

export type SettlementSubscriptionRunner = {
  close: () => Promise<void>;
};

export async function startSettlementSubscriptionRunner(
  options: StartSettlementSubscriptionRunnerOptions,
): Promise<SettlementSubscriptionRunner> {
  const logger: WorkerLogger = options.logger ?? defaultWorkerLogger;
  const subscription = await options.adapter.subscribeSettlements({
    onSettled: async (invoice) => {
      try {
        const result = await markSettled(
          { invoice },
          {
            tipIntentRepo: options.tipIntentRepo,
            ledgerRepo: options.ledgerRepo,
          },
        );
        logWithContract(
          logger,
          "info",
          "worker-settlement-subscription",
          "subscription.event",
          "[worker] settlement subscription event",
          {
            invoice,
            credited: result.credited,
            idempotencyKey: result.idempotencyKey,
          },
        );
      } catch (error) {
        logWithContract(
          logger,
          "error",
          "worker-settlement-subscription",
          "subscription.invoice-failed",
          "[worker] settlement subscription invoice handling failed",
          {
            invoice,
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
    onError: (error) => {
      logWithContract(
        logger,
        "error",
        "worker-settlement-subscription",
        "subscription.stream-failed",
        "[worker] settlement subscription stream failed",
        {
          error: error instanceof Error ? error.message : String(error),
        },
      );
    },
  });

  return {
    async close() {
      try {
        await subscription.close();
      } catch (error) {
        logWithContract(
          logger,
          "error",
          "worker-settlement-subscription",
          "subscription.shutdown-failed",
          "[worker] settlement subscription shutdown failed",
          {
            error: error instanceof Error ? error.message : String(error),
          },
        );
      }
    },
  };
}
