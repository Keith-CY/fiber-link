import { FiberRpcError, rpcCall } from "../fiber-client";
import {
  executeCkbOnchainTransfer,
  getCkbTransactionStatus,
  normalizeCkbPrivateKey,
  resolveHotWalletAddress,
} from "../ckb-onchain-withdrawal";
import { toHexQuantity } from "./normalize";
import type {
  CkbNetwork,
  EnsureChainLiquidityArgs,
  EnsureChainLiquidityResult,
  GetRebalanceStatusArgs,
  GetRebalanceStatusResult,
  RebalanceStatusState,
} from "../types";

type LocalSweepState = Exclude<RebalanceStatusState, "IDLE">;

type LocalSweepTracking = {
  txHash: string;
  network: CkbNetwork;
  state: LocalSweepState;
  error?: string;
  unknownStatusChecks: number;
};

const localSweepRequests = new Map<string, LocalSweepTracking>();
const MAX_UNKNOWN_STATUS_CHECKS = 3;

export function hasLocalChainLiquiditySweepSupport(): boolean {
  return Boolean(
    process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY?.trim() &&
      process.env.FIBER_WITHDRAWAL_CKB_PRIVATE_KEY?.trim(),
  );
}

function resolveLocalChainLiquiditySourcePrivateKey(): string {
  const raw = process.env.FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY?.trim();
  if (!raw) {
    throw new Error("FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY is required for local chain liquidity sweep");
  }
  return normalizeCkbPrivateKey(raw, "FIBER_LIQUIDITY_CKB_SOURCE_PRIVATE_KEY");
}

function isUnsupportedRebalanceRpcError(error: unknown): boolean {
  if (error instanceof FiberRpcError && error.code === -32601) {
    return true;
  }
  if (
    typeof error === "object"
    && error !== null
    && "code" in error
    && (error as { code?: unknown }).code === -32601
  ) {
    return true;
  }
  const message = error instanceof Error
    ? error.message
    : typeof error === "object" && error !== null && "message" in error && typeof (error as { message?: unknown }).message === "string"
      ? (error as { message: string }).message
      : String(error);
  const normalized = message.trim().toLowerCase();
  // Fiber nodes have been observed to use these message variants when the rebalance RPC is absent.
  return normalized.includes("method not found") || normalized.includes("unknown method");
}

function mapRebalanceStatus(value: unknown): RebalanceStatusState {
  if (typeof value !== "string") {
    return "IDLE";
  }
  const normalized = value.trim().toLowerCase();
  if (normalized === "funded" || normalized === "completed" || normalized === "satisfied") {
    return "FUNDED";
  }
  if (normalized === "pending" || normalized === "requested" || normalized === "rebalancing") {
    return "PENDING";
  }
  if (normalized === "failed" || normalized === "error") {
    return "FAILED";
  }
  return "IDLE";
}

function parseEnsureChainLiquidityResult(result: Record<string, unknown> | undefined): EnsureChainLiquidityResult {
  const state = mapRebalanceStatus(result?.status ?? result?.state);
  if (state === "IDLE") {
    return {
      state: "PENDING",
      started: Boolean(result?.started),
    };
  }
  return {
    state,
    started: Boolean(result?.started),
    error: typeof result?.error === "string" ? result.error : undefined,
  };
}

function parseGetRebalanceStatusResult(result: Record<string, unknown> | undefined): GetRebalanceStatusResult {
  return {
    state: mapRebalanceStatus(result?.status ?? result?.state),
    error: typeof result?.error === "string" ? result.error : undefined,
  };
}

function toEnsureResult(tracking: LocalSweepTracking, started: boolean): EnsureChainLiquidityResult {
  return {
    state: tracking.state,
    started,
    error: tracking.error,
    recoveryStrategy: "LOCAL_CKB_SWEEP",
    txHash: tracking.txHash,
    trackingNetwork: tracking.network,
  };
}

function toStatusResult(tracking: LocalSweepTracking): GetRebalanceStatusResult {
  return {
    state: tracking.state,
    error: tracking.error,
  };
}

async function ensureLocalChainLiquidity({ requestId, network, requiredAmount }: EnsureChainLiquidityArgs) {
  const destinationAddress = resolveHotWalletAddress(network);
  const result = await executeCkbOnchainTransfer({
    amount: requiredAmount,
    destination: {
      kind: "CKB_ADDRESS",
      address: destinationAddress,
    },
    network,
    privateKey: resolveLocalChainLiquiditySourcePrivateKey(),
    requestId,
  });
  const tracking: LocalSweepTracking = {
    txHash: result.txHash,
    network,
    state: "PENDING",
    unknownStatusChecks: 0,
  };
  localSweepRequests.set(requestId, tracking);
  return toEnsureResult(tracking, true);
}

async function getOrRefreshLocalSweepTracking(args: GetRebalanceStatusArgs): Promise<LocalSweepTracking | null> {
  const cached = localSweepRequests.get(args.requestId);
  if (cached && cached.state !== "PENDING") {
    return cached;
  }

  const tracking = cached
    ?? (args.txHash && args.network
      ? {
          txHash: args.txHash,
          network: args.network,
          state: "PENDING" as const,
          unknownStatusChecks: 0,
        }
      : null);
  if (!tracking) {
    return null;
  }

  const status = await getCkbTransactionStatus({
    txHash: tracking.txHash,
    network: tracking.network,
  });

  if (status === "COMMITTED") {
    const funded: LocalSweepTracking = {
      ...tracking,
      state: "FUNDED",
      error: undefined,
      unknownStatusChecks: 0,
    };
    localSweepRequests.set(args.requestId, funded);
    return funded;
  }
  if (status === "REJECTED") {
    const failed: LocalSweepTracking = {
      ...tracking,
      state: "FAILED",
      error: `local liquidity sweep transaction ${tracking.txHash} was rejected`,
      unknownStatusChecks: 0,
    };
    localSweepRequests.set(args.requestId, failed);
    return failed;
  }

  if (status === "UNKNOWN") {
    const unknownStatusChecks = tracking.unknownStatusChecks + 1;
    const next: LocalSweepTracking = unknownStatusChecks >= MAX_UNKNOWN_STATUS_CHECKS
      ? {
          ...tracking,
          state: "FAILED",
          error: `local liquidity sweep transaction ${tracking.txHash} stayed unknown for ${unknownStatusChecks} consecutive status checks`,
          unknownStatusChecks,
        }
      : {
          ...tracking,
          state: "PENDING",
          error: undefined,
          unknownStatusChecks,
        };
    localSweepRequests.set(args.requestId, next);
    return next;
  }

  const pending: LocalSweepTracking = {
    ...tracking,
    state: "PENDING",
    error: undefined,
    unknownStatusChecks: 0,
  };
  localSweepRequests.set(args.requestId, pending);
  return pending;
}

async function getLocalChainLiquidityStatus(args: GetRebalanceStatusArgs): Promise<GetRebalanceStatusResult | null> {
  const tracking = await getOrRefreshLocalSweepTracking(args);
  if (!tracking) {
    return null;
  }
  return toStatusResult(tracking);
}

export async function ensureChainLiquidity(
  endpoint: string,
  args: EnsureChainLiquidityArgs,
) {
  const tracked = await getOrRefreshLocalSweepTracking({ requestId: args.requestId });
  if (tracked) {
    return toEnsureResult(tracked, false);
  }

  try {
    const result = (await rpcCall(endpoint, "rebalance_to_ckb_chain", {
      request_id: args.requestId,
      asset: args.asset,
      network: args.network,
      required_amount: toHexQuantity(args.requiredAmount),
      source_kind: args.sourceKind,
    })) as Record<string, unknown> | undefined;
    return parseEnsureChainLiquidityResult(result);
  } catch (error) {
    if (!hasLocalChainLiquiditySweepSupport() || args.asset !== "CKB") {
      throw error;
    }
    if (isUnsupportedRebalanceRpcError(error)) {
      return ensureLocalChainLiquidity(args);
    }
    throw error;
  }
}

export async function getRebalanceStatus(
  endpoint: string,
  args: GetRebalanceStatusArgs,
) {
  const localStatus = await getLocalChainLiquidityStatus(args);
  if (localStatus) {
    return localStatus;
  }

  try {
    const result = (await rpcCall(endpoint, "get_rebalance_status", {
      request_id: args.requestId,
    })) as Record<string, unknown> | undefined;
    return parseGetRebalanceStatusResult(result);
  } catch (error) {
    if (hasLocalChainLiquiditySweepSupport() && isUnsupportedRebalanceRpcError(error)) {
      return { state: "IDLE" as const };
    }
    throw error;
  }
}
