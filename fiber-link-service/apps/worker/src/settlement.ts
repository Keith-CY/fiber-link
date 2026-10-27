import {
  type DbClient,
  type LedgerRepo,
  type TipIntentRepo,
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentRepo,
  settlementCreditIdempotencyKey,
} from "@fiber-link/db";
import type { NotificationDispatcher } from "@fiber-link/notifications";
import { createComponentLogger } from "./logger";
import { getDefaultNotificationDispatcher } from "./notification-dispatcher";
import type { SettlementPublisher } from "./settlement-publisher";

import { settlementCreditedTotal } from "./metrics";

const logger = createComponentLogger("settlement");

let defaultDb: DbClient | null = null;
let defaultTipIntentRepo: TipIntentRepo | null = null;
let defaultLedgerRepo: LedgerRepo | null = null;

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

export async function markSettled(
  { invoice }: { invoice: string },
  options: {
    tipIntentRepo?: TipIntentRepo;
    ledgerRepo?: LedgerRepo;
    dispatcher?: NotificationDispatcher;
    publisher?: SettlementPublisher;
  } = {},
) {
  const tipIntentRepo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  // Default to the shared dispatcher so TIP_SETTLED webhooks fire on the
  // production settlement paths (discovery + subscription runner), which
  // never passed an explicit dispatcher. Falls back to a no-op without
  // DATABASE_URL, so unit tests keep their existing behavior.
  const dispatcher = options.dispatcher ?? getDefaultNotificationDispatcher();

  // Credit and SETTLED transition commit together, so a concurrent pending
  // timeout can neither leave a credited intent FAILED nor overwrite SETTLED.
  const { record: tipIntent, credited } = await tipIntentRepo.markSettledWithCredit(
    invoice,
    { now: new Date() },
    { ledgerRepo },
  );
  const idempotencyKey = settlementCreditIdempotencyKey(tipIntent.id);
  const settledAt = tipIntent.settledAt;

  if (credited) {
    settlementCreditedTotal.inc();
  }

  dispatcher
    .dispatchTipSettledEvent({
      type: "TIP_SETTLED",
      occurredAt: new Date(),
      appId: tipIntent.appId,
      toUserId: tipIntent.toUserId,
      fromUserId: tipIntent.fromUserId,
      postId: tipIntent.postId,
      invoice,
      asset: tipIntent.asset,
      amount: String(tipIntent.amount),
    })
    .catch((e) => logger.warn("settlement.tip_settled_notification_failed", { invoice, error: e }));

  // Publish settlement event for real-time SSE subscribers. Failure is non-blocking.
  if (options.publisher) {
    await options.publisher.publish(invoice, { settledAt }).catch((err) => {
      logger.warn("settlement.publisher_publish_failed", { invoice, error: err });
    });
  }

  return { credited, idempotencyKey };
}
