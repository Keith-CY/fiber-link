import {
  addDecimalStrings,
  compareDecimalStrings,
  createDbClient,
  createDbLiquidityRequestRepo,
  createDbWithdrawalRepo,
  subtractDecimalStrings,
  toErrorMessage,
  type LiquidityRequestRecord,
  type LiquidityRequestRepo,
  type WithdrawalRecord,
  type WithdrawalRepo,
} from "@fiber-link/db";
import {
  type AcceptChannelArgs,
  type AcceptChannelResult,
  type CkbNetwork,
  type CkbChannelAcceptancePolicy,
  type EnsureChainLiquidityArgs,
  type EnsureChainLiquidityResult,
  type GetRebalanceStatusArgs,
  type GetRebalanceStatusResult,
  type HotWalletInventoryProvider,
  type LiquidityCapabilities,
  type ListChannelsArgs,
  type ListChannelsResult,
  type OpenChannelArgs,
  type OpenChannelResult,
  resolveHotWalletLockScript,
  type ShutdownChannelArgs,
  type ShutdownChannelResult,
} from "@fiber-link/fiber-adapter";
import { executeChannelRotation, selectLegacyChannel } from "./channel-rotation";

export type LiquidityProvider = {
  getLiquidityCapabilities: () => Promise<LiquidityCapabilities>;
  listChannels: (args: ListChannelsArgs) => Promise<ListChannelsResult>;
  openChannel: (args: OpenChannelArgs) => Promise<OpenChannelResult>;
  acceptChannel: (args: AcceptChannelArgs) => Promise<AcceptChannelResult>;
  getCkbChannelAcceptancePolicy: () => Promise<CkbChannelAcceptancePolicy>;
  shutdownChannel: (args: ShutdownChannelArgs) => Promise<ShutdownChannelResult>;
  ensureChainLiquidity: (args: EnsureChainLiquidityArgs) => Promise<EnsureChainLiquidityResult>;
  getRebalanceStatus: (args: GetRebalanceStatusArgs) => Promise<GetRebalanceStatusResult>;
};

export type RunLiquidityBatchOptions = {
  now?: Date;
  repo?: WithdrawalRepo;
  liquidityRequestRepo?: LiquidityRequestRepo;
  liquidityProvider: LiquidityProvider;
  fallbackMode?: "none" | "channel_rotation";
  channelRotationBootstrapReserve?: string;
  channelRotationMinRecoverableAmount?: string;
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

function getMetadataString(metadata: LiquidityRequestRecord["metadata"], key: string): string | null {
  if (!metadata || typeof metadata[key] !== "string") {
    return null;
  }
  return metadata[key] as string;
}

function getTargetAvailableAmount(request: LiquidityRequestRecord): string {
  return getMetadataString(request.metadata, "targetAvailableAmount") ?? request.requiredAmount;
}

function getActualRecoveredAmount(request: LiquidityRequestRecord, fundedAmount: string): string | null {
  const previousHotWalletAvailableAmount = getMetadataString(request.metadata, "hotWalletAvailableAmount");
  if (!previousHotWalletAvailableAmount) {
    return null;
  }
  if (compareDecimalStrings(fundedAmount, previousHotWalletAvailableAmount) < 0) {
    return null;
  }
  return subtractDecimalStrings(fundedAmount, previousHotWalletAvailableAmount);
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
  const fallbackMode = options.fallbackMode ?? "none";
  const channelRotationBootstrapReserve = options.channelRotationBootstrapReserve ?? "0";
  const channelRotationMinRecoverableAmount = options.channelRotationMinRecoverableAmount ?? "0";

  const openRequests = await liquidityRequestRepo.listOpen();
  const capabilities = await options.liquidityProvider.getLiquidityCapabilities();
  let rebalanceStarted = 0;
  let funded = 0;
  let promoted = 0;
  let channelRotationStarted = 0;
  let channelRotationCompleted = 0;
  let channelRotationFailed = 0;

  for (const request of openRequests) {
    const targetAvailableAmount = getTargetAvailableAmount(request);
    let inventory = await options.inventoryProvider({
      asset: request.asset,
      network: request.network as CkbNetwork,
    });

    if (compareDecimalStrings(inventory.availableAmount, targetAvailableAmount) < 0) {
      if (capabilities.directRebalance) {
        const status = await options.liquidityProvider.getRebalanceStatus({
          requestId: request.id,
        });
        const remainingRequiredAmount = subtractDecimalStrings(targetAvailableAmount, inventory.availableAmount);
        if (status.state === "IDLE") {
          const ensureResult = await options.liquidityProvider.ensureChainLiquidity({
            requestId: request.id,
            asset: request.asset,
            network: request.network as CkbNetwork,
            requiredAmount: remainingRequiredAmount,
            sourceKind: "FIBER_TO_CKB_CHAIN",
          });
          if (ensureResult.started) {
            rebalanceStarted += 1;
          }
        }
      } else if (
        !capabilities.directRebalance &&
        fallbackMode === "channel_rotation" &&
        capabilities.channelLifecycle &&
        request.state !== "REBALANCING"
      ) {
        const remainingRequiredAmount = subtractDecimalStrings(targetAvailableAmount, inventory.availableAmount);
        const channelsResult = await options.liquidityProvider.listChannels({
          includeClosed: false,
        });
        const legacyChannel = selectLegacyChannel({
          minRecoverableAmount: channelRotationMinRecoverableAmount,
          channels: channelsResult.channels,
        });

        let fallbackError: string | null = null;
        if (compareDecimalStrings(channelRotationBootstrapReserve, "0") <= 0) {
          fallbackError = "bootstrap reserve must be greater than zero before opening a replacement channel";
        } else if (!legacyChannel) {
          fallbackError = `no eligible legacy channel found for liquidity request ${request.id}`;
        }

        if (fallbackError) {
            await liquidityRequestRepo.ensureOpen({
              appId: request.appId,
              asset: request.asset,
              network: request.network,
              sourceKind: request.sourceKind,
              requiredAmount: request.requiredAmount,
              metadata: {
                ...(request.metadata ?? {}),
                recoveryStrategy: "CHANNEL_ROTATION",
                lastRotationError: fallbackError,
              },
            });
        } else {
          channelRotationStarted += 1;
          try {
            const hotWalletLock = resolveHotWalletLockScript(request.network as CkbNetwork);
            const rotation = await executeChannelRotation({
              liquidityRequestId: request.id,
              shortfallAmount: remainingRequiredAmount,
              bootstrapReserve: channelRotationBootstrapReserve,
              minRecoverableAmount: channelRotationMinRecoverableAmount,
              closeScript: {
                code_hash: hotWalletLock.codeHash,
                hash_type: hotWalletLock.hashType,
                args: hotWalletLock.args,
              },
              channels: channelsResult.channels,
              listChannels: options.liquidityProvider.listChannels,
              openChannel: options.liquidityProvider.openChannel,
              acceptChannel: options.liquidityProvider.acceptChannel,
              getCkbChannelAcceptancePolicy: options.liquidityProvider.getCkbChannelAcceptancePolicy,
              shutdownChannel: options.liquidityProvider.shutdownChannel,
            });
            await liquidityRequestRepo.markRebalancing(request.id, {
              now,
              metadata: {
                ...(request.metadata ?? {}),
                recoveryStrategy: "CHANNEL_ROTATION",
                legacyChannelId: rotation.legacyChannelId,
                replacementChannelId: rotation.replacementChannelId,
                expectedRecoveredAmount: rotation.expectedRecoveredAmount,
                legacyChannelLocalBalance: rotation.legacyChannelLocalBalance,
                replacementFundingAmount: rotation.replacementFundingAmount,
                acceptFundingAmount: rotation.acceptFundingAmount,
                lastRotationError: null,
              },
            });
            channelRotationCompleted += 1;
          } catch (error) {
            channelRotationFailed += 1;
            await liquidityRequestRepo.ensureOpen({
              appId: request.appId,
              asset: request.asset,
              network: request.network,
              sourceKind: request.sourceKind,
              requiredAmount: request.requiredAmount,
              metadata: {
                ...(request.metadata ?? {}),
                recoveryStrategy: "CHANNEL_ROTATION",
                lastRotationError: toErrorMessage(error),
              },
            });
          }
        }
      }

      inventory = await options.inventoryProvider({
        asset: request.asset,
        network: request.network as CkbNetwork,
      });
      if (compareDecimalStrings(inventory.availableAmount, targetAvailableAmount) < 0) {
        continue;
      }
    }

    const actualRecoveredAmount = getActualRecoveredAmount(request, inventory.availableAmount);
    await liquidityRequestRepo.markFunded(request.id, {
      fundedAmount: inventory.availableAmount,
      now,
      metadata: actualRecoveredAmount
        ? {
            actualRecoveredAmount,
          }
        : undefined,
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
    channelRotationStarted,
    channelRotationCompleted,
    channelRotationFailed,
  };
}
