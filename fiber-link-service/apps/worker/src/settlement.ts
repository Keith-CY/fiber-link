import {
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentRepo,
  type DbClient,
  type LedgerRepo,
  type TipIntentRepo,
} from "@fiber-link/db";

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
  options: { tipIntentRepo?: TipIntentRepo; ledgerRepo?: LedgerRepo } = {},
) {
  const tipIntentRepo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();

  const tipIntent = await tipIntentRepo.findByInvoiceOrThrow(invoice);
  const idempotencyKey = `settlement:tip_intent:${tipIntent.id}`;

  const credited = await ledgerRepo.creditOnce({
    appId: tipIntent.appId,
    userId: tipIntent.toUserId,
    asset: tipIntent.asset,
    amount: tipIntent.amount,
    refId: tipIntent.id,
    idempotencyKey,
  });

  if (credited.applied) {
    await tipIntentRepo.updateInvoiceState(invoice, "SETTLED");
  }

  return { credited: credited.applied, idempotencyKey };
}
