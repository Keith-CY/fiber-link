import {
  addDecimalStrings,
  compareDecimalStrings,
  formatDecimal,
  parseDecimal,
  pow10,
  type Asset,
  type LiquidityRequestRepo,
  type WithdrawalRepo,
} from "@fiber-link/db";
import {
  resolveCkbNetworkConfig,
  type HotWalletInventoryProvider,
  type WithdrawalDestination,
} from "@fiber-link/fiber-adapter";

export type WithdrawalLiquidityDecision =
  | {
      state: "PENDING";
      liquidityRequestId: null;
      liquidityPendingReason: null;
    }
  | {
      state: "LIQUIDITY_PENDING";
      liquidityRequestId: string;
      liquidityPendingReason: string;
    };

export type DecideWithdrawalRequestLiquidityInput = {
  appId: string;
  asset: Asset;
  amount: string;
  destination: WithdrawalDestination;
};

export type DecideWithdrawalRequestLiquidityOptions = {
  repo?: WithdrawalRepo | null;
  hotWalletInventoryProvider?: HotWalletInventoryProvider | null;
  liquidityRequestRepo?: LiquidityRequestRepo | null;
};

export class MissingLiquidityRequestRepoError extends Error {
  constructor() {
    super("liquidityRequestRepo is required when hot wallet liquidity is insufficient");
    this.name = "MissingLiquidityRequestRepoError";
  }
}

const HOT_WALLET_UNDERFUNDED_REASON = "hot wallet underfunded";

function pendingDecision(): WithdrawalLiquidityDecision {
  return {
    state: "PENDING",
    liquidityRequestId: null,
    liquidityPendingReason: null,
  };
}

function resolveCkbNetwork(address: string): "AGGRON4" | "LINA" {
  const { isTestnet } = resolveCkbNetworkConfig(address);
  return isTestnet ? "AGGRON4" : "LINA";
}

function subtractDecimalStrings(left: string, right: string): string {
  const a = parseDecimal(left);
  const b = parseDecimal(right);
  const scale = Math.max(a.scale, b.scale);
  const value = a.value * pow10(scale - a.scale) - b.value * pow10(scale - b.scale);
  return formatDecimal(value, scale);
}

export async function decideWithdrawalRequestLiquidity(
  input: DecideWithdrawalRequestLiquidityInput,
  options: DecideWithdrawalRequestLiquidityOptions = {},
): Promise<WithdrawalLiquidityDecision> {
  if (!options.hotWalletInventoryProvider || input.destination.kind !== "CKB_ADDRESS") {
    return pendingDecision();
  }

  const network = resolveCkbNetwork(input.destination.address);
  const inventory = await options.hotWalletInventoryProvider({
    asset: input.asset,
    network,
  });
  const reserved = options.repo
    ? await options.repo.getActiveCkbAddressReservationTotal({
        appId: input.appId,
        asset: input.asset,
        network,
      })
    : "0";
  const requiredAmount = addDecimalStrings(reserved, input.amount);

  if (compareDecimalStrings(inventory.availableAmount, requiredAmount) >= 0) {
    return pendingDecision();
  }

  if (!options.liquidityRequestRepo) {
    throw new MissingLiquidityRequestRepoError();
  }

  const liquidityRequest =
    (await options.liquidityRequestRepo.findOpenByKey({
      appId: input.appId,
      asset: input.asset,
      network,
      sourceKind: "FIBER_TO_CKB_CHAIN",
    })) ??
    (await options.liquidityRequestRepo.create({
      appId: input.appId,
      asset: input.asset,
      network,
      sourceKind: "FIBER_TO_CKB_CHAIN",
      requiredAmount: subtractDecimalStrings(requiredAmount, inventory.availableAmount),
      metadata: {
        destinationKind: input.destination.kind,
        toAddress: input.destination.address,
        hotWalletAvailableAmount: inventory.availableAmount,
      },
    }));

  return {
    state: "LIQUIDITY_PENDING",
    liquidityRequestId: liquidityRequest.id,
    liquidityPendingReason: HOT_WALLET_UNDERFUNDED_REASON,
  };
}
