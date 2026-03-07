import {
  addDecimalStrings,
  compareDecimalStrings,
  createDbClient,
  createDbLiquidityRequestRepo,
  createDbWithdrawalRepo,
  type LiquidityRequestRecord,
  type LiquidityRequestRepo,
  type WithdrawalRecord,
  type WithdrawalRepo,
} from "@fiber-link/db";
import {
  type CkbNetwork,
  type EnsureChainLiquidityArgs,
  type EnsureChainLiquidityResult,
  type GetRebalanceStatusArgs,
  type GetRebalanceStatusResult,
  type HotWalletInventoryProvider,
} from "@fiber-link/fiber-adapter";

export type LiquidityProvider = {
  ensureChainLiquidity: (args: EnsureChainLiquidityArgs) => Promise<EnsureChainLiquidityResult>;
  getRebalanceStatus: (args: GetRebalanceStatusArgs) => Promise<GetRebalanceStatusResult>;
};

export type RunLiquidityBatchOptions = {
  now?: Date;
  repo?: WithdrawalRepo;
  liquidityRequestRepo?: LiquidityRequestRepo;
  liquidityProvider: LiquidityProvider;
  inventoryProvider: HotWalletInventoryProvider;
};

function sortWithdrawalsForPromotion(withdrawals: WithdrawalRecord[]) {
  return [...withdrawals].sort((left, right) => {
    const createdAtDiff = left.createdAt.getTime() - right.createdAt.getTime();
    if (createdAtDiff !== 0) {
      return createdAtDiff;
    }
    return left.id.localeCompare(right.id);
  });
}

async function promoteCoveredWithdrawals(
  request: LiquidityRequestRecord,
  options: {
    now: Date;
    repo: WithdrawalRepo;
    inventoryProvider: HotWalletInventoryProvider;
  },
) {
  const pending = (await options.repo.listLiquidityPending()).filter(
    (item) => item.liquidityRequestId === request.id,
  );
  if (pending.length === 0) {
    return 0;
  }

  const inventory = await options.inventoryProvider({
    asset: request.asset,
    network: request.network as CkbNetwork,
  });
  let reserved = await options.repo.getActiveCkbAddressReservationTotal({
    appId: request.appId,
    asset: request.asset,
    network: request.network as CkbNetwork,
  });
  let promoted = 0;

  for (const withdrawal of sortWithdrawalsForPromotion(pending)) {
    const required = addDecimalStrings(reserved, withdrawal.amount);
    if (compareDecimalStrings(inventory.availableAmount, required) < 0) {
      break;
    }
    await options.repo.markPendingFromLiquidity(withdrawal.id, options.now);
    reserved = required;
    promoted += 1;
  }

  return promoted;
}

export async function runLiquidityBatch(options: RunLiquidityBatchOptions) {
  const now = options.now ?? new Date();
  const repo = options.repo ?? createDbWithdrawalRepo(createDbClient());
  const liquidityRequestRepo = options.liquidityRequestRepo ?? createDbLiquidityRequestRepo(createDbClient());

  const openRequests = await liquidityRequestRepo.listOpen();
  let rebalanceStarted = 0;
  let funded = 0;
  let promoted = 0;

  for (const request of openRequests) {
    let inventory = await options.inventoryProvider({
      asset: request.asset,
      network: request.network as CkbNetwork,
    });

    if (compareDecimalStrings(inventory.availableAmount, request.requiredAmount) < 0) {
      const status = await options.liquidityProvider.getRebalanceStatus({
        requestId: request.id,
      });

      if (status.state === "IDLE") {
        const ensureResult = await options.liquidityProvider.ensureChainLiquidity({
          requestId: request.id,
          asset: request.asset,
          network: request.network as CkbNetwork,
          requiredAmount: request.requiredAmount,
          sourceKind: "FIBER_TO_CKB_CHAIN",
        });
        if (ensureResult.started) {
          rebalanceStarted += 1;
        }
      }

      inventory = await options.inventoryProvider({
        asset: request.asset,
        network: request.network as CkbNetwork,
      });
      if (compareDecimalStrings(inventory.availableAmount, request.requiredAmount) < 0) {
        continue;
      }
    }

    await liquidityRequestRepo.markFunded(request.id, {
      fundedAmount: inventory.availableAmount,
      now,
    });
    funded += 1;
    promoted += await promoteCoveredWithdrawals(request, {
      now,
      repo,
      inventoryProvider: options.inventoryProvider,
    });
  }

  return {
    scanned: openRequests.length,
    rebalanceStarted,
    funded,
    promoted,
  };
}
