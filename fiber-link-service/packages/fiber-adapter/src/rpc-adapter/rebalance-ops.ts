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

const localSweepRequests = new Map<string, { txHash: string; network: CkbNetwork }>();

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
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.trim().toLowerCase();
  return normalized === "unauthorized" || normalized.includes("method not found") || normalized.includes("unknown method");
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
  localSweepRequests.set(requestId, { txHash: result.txHash, network });
  return {
    state: "PENDING" as const,
    started: true,
    txHash: result.txHash,
    trackingNetwork: network,
  };
}

async function getLocalChainLiquidityStatus(args: GetRebalanceStatusArgs): Promise<GetRebalanceStatusResult | null> {
  const pending = localSweepRequests.get(args.requestId)
    ?? (args.txHash && args.network ? { txHash: args.txHash, network: args.network } : null);
  if (!pending) {
    return null;
  }

  const status = await getCkbTransactionStatus({
    txHash: pending.txHash,
    network: pending.network,
  });

  if (status === "COMMITTED") {
    localSweepRequests.delete(args.requestId);
    return { state: "FUNDED" };
  }
  if (status === "REJECTED") {
    localSweepRequests.delete(args.requestId);
    return { state: "FAILED", error: `local liquidity sweep transaction ${pending.txHash} was rejected` };
  }
  return { state: "PENDING" };
}

export async function ensureChainLiquidity(
  endpoint: string,
  args: EnsureChainLiquidityArgs,
) {
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
    if (isUnsupportedRebalanceRpcError(error) || /invalid amount:/i.test(String(error))) {
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
