import {
  addDecimalStrings,
  compareDecimalStrings,
  InsufficientFundsError,
  subtractDecimalStrings,
  type LedgerRepo,
  type WithdrawalRepo,
} from "@fiber-link/db";
import {
  resolveFeeRateShannonsPerKb,
  shannonsToCkbDecimal,
} from "@fiber-link/fiber-adapter";
import type { RequestWithdrawalInput } from "./withdrawal-policy";

function clampNonNegative(left: string, right: string): string {
  const result = subtractDecimalStrings(left, right);
  return compareDecimalStrings(result, "0") < 0 ? "0" : result;
}

export function estimateNetworkFee(input: RequestWithdrawalInput): string {
  if (input.destination.kind !== "CKB_ADDRESS") {
    return "0";
  }

  if (input.asset === "CKB") {
    return shannonsToCkbDecimal(resolveFeeRateShannonsPerKb());
  }

  return "0";
}

export function computeReceiveAmount(amount: string, networkFee: string): string {
  return clampNonNegative(amount, networkFee);
}

export function computeSpendableBalance(availableBalance: string, lockedBalance: string): string {
  return clampNonNegative(availableBalance, lockedBalance);
}

export async function assertSufficientCreatorBalance(
  input: RequestWithdrawalInput,
  deps: { repo: WithdrawalRepo; ledgerRepo: LedgerRepo },
) {
  const [balance, pending] = await Promise.all([
    deps.ledgerRepo.getBalance({
      appId: input.appId,
      userId: input.userId,
      asset: input.asset,
    }),
    deps.repo.getPendingTotal({
      appId: input.appId,
      userId: input.userId,
      asset: input.asset,
    }),
  ]);

  const nextReservedTotal = addDecimalStrings(pending, input.amount);
  if (compareDecimalStrings(nextReservedTotal, balance) > 0) {
    throw new InsufficientFundsError(input.appId, input.userId, input.asset, input.amount);
  }
}
