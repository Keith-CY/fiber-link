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
import type { SettlementPublisher } from "./settlement-publisher";

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

  const tipIntent = await tipIntentRepo.findByInvoiceOrThrow(invoice);
  const idempotencyKey = settlementCreditIdempotencyKey(tipIntent.id);

  const credited = await ledgerRepo.creditOnce({
    appId: tipIntent.appId,
    userId: tipIntent.toUserId,
    asset: tipIntent.asset,
    amount: tipIntent.amount,
    refId: tipIntent.id,
    idempotencyKey,
  });

  // Keep invoice state convergent even if credit was already written earlier.
  let settledAt = tipIntent.settledAt;
  if (tipIntent.invoiceState !== "SETTLED") {
    const updated = await tipIntentRepo.updateInvoiceState(invoice, "SETTLED");
    settledAt = updated.settledAt;
  }

  if (options.dispatcher) {
    options.dispatcher
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
  }

  // Publish settlement event for real-time SSE subscribers. Failure is non-blocking.
  if (options.publisher) {
    await options.publisher.publish(invoice, { settledAt }).catch((err) => {
      logger.warn("settlement.publisher_publish_failed", { invoice, error: err });
    });
  }

  return { credited: credited.applied, idempotencyKey };
}
