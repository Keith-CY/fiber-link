import {
  addDecimalStrings,
  compareDecimalStrings,
  formatDecimal,
  type LiquidityRequestMetadata,
  parseDecimal,
  pow10,
  type Asset,
  type LiquidityRequestRepo,
  type WithdrawalRepo,
} from "@fiber-link/db";
import {
  getDefaultCkbChangeCellCapacityShannons,
  resolveCkbNetworkConfig,
  shannonsToCkbDecimal,
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
const DEFAULT_CKB_LIQUIDITY_BUFFER = "0";

type CkbHotWalletTarget = {
  targetAvailableAmount: string;
  feeBufferAmount: string;
  postTxReserveAmount: string;
  changeReserveAmount: string;
  effectivePostTxReserveAmount: string;
  warmBufferAmount: string;
};

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

function parseNonNegativeAmountEnv(name: string, fallback: string): string {
  const raw = process.env[name];
  const value = raw === undefined || raw.trim() === "" ? fallback : raw.trim();
  const parsed = parseDecimal(value);
  if (parsed.value < 0n) {
    throw new Error(`${name} must be a non-negative decimal`);
  }
  return formatDecimal(parsed.value, parsed.scale);
}

function resolveCkbHotWalletTarget(requiredAmount: string, network: "AGGRON4" | "LINA"): CkbHotWalletTarget {
  const feeBufferAmount = parseNonNegativeAmountEnv(
    "FIBER_WITHDRAWAL_CKB_LIQUIDITY_FEE_BUFFER",
    DEFAULT_CKB_LIQUIDITY_BUFFER,
  );
  const postTxReserveAmount = parseNonNegativeAmountEnv(
    "FIBER_WITHDRAWAL_CKB_LIQUIDITY_POST_TX_RESERVE",
    DEFAULT_CKB_LIQUIDITY_BUFFER,
  );
  const warmBufferAmount = parseNonNegativeAmountEnv(
    "FIBER_WITHDRAWAL_CKB_LIQUIDITY_WARM_BUFFER",
    DEFAULT_CKB_LIQUIDITY_BUFFER,
  );
  const changeReserveAmount = shannonsToCkbDecimal(getDefaultCkbChangeCellCapacityShannons(network));
  const effectivePostTxReserveAmount =
    compareDecimalStrings(postTxReserveAmount, changeReserveAmount) >= 0
      ? postTxReserveAmount
      : changeReserveAmount;

  let targetAvailableAmount = requiredAmount;
  targetAvailableAmount = addDecimalStrings(targetAvailableAmount, feeBufferAmount);
  targetAvailableAmount = addDecimalStrings(targetAvailableAmount, effectivePostTxReserveAmount);
  targetAvailableAmount = addDecimalStrings(targetAvailableAmount, warmBufferAmount);

  return {
    targetAvailableAmount,
    feeBufferAmount,
    postTxReserveAmount,
    changeReserveAmount,
    effectivePostTxReserveAmount,
    warmBufferAmount,
  };
}

function resolveHotWalletRequirement(
  input: DecideWithdrawalRequestLiquidityInput,
  reservedAmount: string,
  network: "AGGRON4" | "LINA",
): {
  targetAvailableAmount: string;
  metadata: LiquidityRequestMetadata | null;
} {
  const requiredAvailableAmount = addDecimalStrings(reservedAmount, input.amount);
  if (!(input.asset === "CKB" && input.destination.kind === "CKB_ADDRESS")) {
    return {
      targetAvailableAmount: requiredAvailableAmount,
      metadata: null,
    };
  }

  const target = resolveCkbHotWalletTarget(requiredAvailableAmount, network);
  return {
    targetAvailableAmount: target.targetAvailableAmount,
    metadata: {
      requiredAvailableAmount,
      targetAvailableAmount: target.targetAvailableAmount,
      feeBufferAmount: target.feeBufferAmount,
      postTxReserveAmount: target.postTxReserveAmount,
      changeReserveAmount: target.changeReserveAmount,
      effectivePostTxReserveAmount: target.effectivePostTxReserveAmount,
      warmBufferAmount: target.warmBufferAmount,
    },
  };
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
  const requirement = resolveHotWalletRequirement(input, reserved, network);

  if (compareDecimalStrings(inventory.availableAmount, requirement.targetAvailableAmount) >= 0) {
    return pendingDecision();
  }

  if (!options.liquidityRequestRepo) {
    throw new MissingLiquidityRequestRepoError();
  }

  const requestedRebalanceAmount = subtractDecimalStrings(requirement.targetAvailableAmount, inventory.availableAmount);

  const liquidityRequest = await options.liquidityRequestRepo.ensureOpen({
    appId: input.appId,
    asset: input.asset,
    network,
    sourceKind: "FIBER_TO_CKB_CHAIN",
    requiredAmount: requestedRebalanceAmount,
    metadata: {
      destinationKind: input.destination.kind,
      toAddress: input.destination.address,
      hotWalletAvailableAmount: inventory.availableAmount,
      requestedRebalanceAmount,
      ...(requirement.metadata ?? {}),
    },
  });

  return {
    state: "LIQUIDITY_PENDING",
    liquidityRequestId: liquidityRequest.id,
    liquidityPendingReason: HOT_WALLET_UNDERFUNDED_REASON,
  };
}
