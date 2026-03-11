import { createHash } from "node:crypto";
import { rpcCall } from "../fiber-client";
import { executeCkbOnchainWithdrawal } from "../ckb-onchain-withdrawal";
import { executeUdtOnchainWithdrawal } from "../udt-onchain-withdrawal";
import { pickTxEvidence, toHexQuantity } from "./normalize";
import { mapAssetToCurrency, pickPaymentHash, resolveUsdiUdtScript, toWithdrawalUdtTypeScript } from "./invoice-ops";
import type { Asset, ExecuteWithdrawalArgs } from "../types";

function generateFallbackRequestId({ invoice, amount, asset }: { invoice: string; amount: string; asset: Asset }) {
  return `fiber:${createHash("sha256").update(`${invoice}|${amount}|${asset}`).digest("hex").slice(0, 20)}`;
}

export async function executeWithdrawal(
  endpoint: string,
  { amount, asset, destination, requestId }: ExecuteWithdrawalArgs,
) {
  if (destination.kind === "CKB_ADDRESS") {
    if (asset === "USDI") {
      return executeUdtOnchainWithdrawal({
        amount,
        asset,
        destination,
        requestId,
        udtTypeScript: toWithdrawalUdtTypeScript(await resolveUsdiUdtScript(endpoint)),
      });
    }
    return executeCkbOnchainWithdrawal({ amount, asset, destination, requestId });
  }

  const paymentRequest = destination.paymentRequest;
  const parsed = (await rpcCall(endpoint, "parse_invoice", {
    invoice: paymentRequest,
  })) as Record<string, unknown> | undefined;
  const paymentHash = pickPaymentHash(parsed);
  if (!paymentHash) {
    throw new Error("parse_invoice response is missing 'invoice.data.payment_hash' string");
  }
  const resolvedRequestId =
    requestId?.trim() || generateFallbackRequestId({ invoice: paymentRequest, amount, asset });
  const result = (await rpcCall(endpoint, "send_payment", {
    payment_hash: paymentHash,
    amount: toHexQuantity(amount),
    currency: mapAssetToCurrency(asset),
    request_id: resolvedRequestId,
    invoice: paymentRequest,
  })) as Record<string, unknown> | undefined;
  const txHash = pickTxEvidence(result);
  if (!txHash) {
    throw new Error("send_payment response is missing transaction evidence");
  }
  return { txHash };
}
