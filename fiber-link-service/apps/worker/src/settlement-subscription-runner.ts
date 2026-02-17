import type { LedgerRepo, TipIntentRepo } from "@fiber-link/db";
import { markSettled } from "./settlement";

type SettlementSubscriptionLogger = {
  info: (message: string, context?: Record<string, unknown>) => void;
  error: (message: string, error?: unknown) => void;
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
};

export type SettlementSubscriptionRunner = {
  close: () => Promise<void>;
};

const defaultLogger: SettlementSubscriptionLogger = {
  info(message, context) {
    console.log(message, context ?? {});
  },
  error(message, error) {
    console.error(message, error);
  },
};

export async function startSettlementSubscriptionRunner(
  options: StartSettlementSubscriptionRunnerOptions,
): Promise<SettlementSubscriptionRunner> {
  const logger = options.logger ?? defaultLogger;
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
        logger.info("[worker] settlement subscription event", {
          invoice,
          credited: result.credited,
          idempotencyKey: result.idempotencyKey,
        });
      } catch (error) {
        logger.error("[worker] settlement subscription invoice handling failed", {
          invoice,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    },
    onError: (error) => {
      logger.error("[worker] settlement subscription stream failed", error);
    },
  });

  return {
    async close() {
      try {
        await subscription.close();
      } catch (error) {
        logger.error("[worker] settlement subscription shutdown failed", error);
      }
    },
  };
}
