import { rpcCall } from "../fiber-client";
import { toHexQuantity } from "./normalize";
import type {
  EnsureChainLiquidityArgs,
  EnsureChainLiquidityResult,
  GetRebalanceStatusArgs,
  GetRebalanceStatusResult,
  RebalanceStatusState,
} from "../types";

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

export async function ensureChainLiquidity(
  endpoint: string,
  { requestId, asset, network, requiredAmount, sourceKind }: EnsureChainLiquidityArgs,
) {
  const result = (await rpcCall(endpoint, "rebalance_to_ckb_chain", {
    request_id: requestId,
    asset,
    network,
    required_amount: toHexQuantity(requiredAmount),
    source_kind: sourceKind,
  })) as Record<string, unknown> | undefined;
  return parseEnsureChainLiquidityResult(result);
}

export async function getRebalanceStatus(
  endpoint: string,
  { requestId }: GetRebalanceStatusArgs,
) {
  const result = (await rpcCall(endpoint, "get_rebalance_status", {
    request_id: requestId,
  })) as Record<string, unknown> | undefined;
  return parseGetRebalanceStatusResult(result);
}
