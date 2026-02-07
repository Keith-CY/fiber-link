import { tipIntentRepo } from "../../rpc/src/repositories/tip-intent-repo";
import { ledgerRepo } from "./repositories/ledger-repo";

export async function markSettled({ invoice }: { invoice: string }) {
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
