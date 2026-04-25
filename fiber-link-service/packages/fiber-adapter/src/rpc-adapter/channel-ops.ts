import { FiberRpcError, rpcCall } from "../fiber-client";
import { hasLocalChainLiquiditySweepSupport } from "./rebalance-ops";
import { normalizeRpcAmount, normalizeRpcInteger, pickRequiredAmount, pickStringCandidate, pickTxEvidence, toHexQuantity } from "./normalize";
import { rpcCallWithoutParams, toRpcUdtTypeScript } from "./invoice-ops";
import type {
  AcceptChannelArgs,
  AcceptChannelResult,
  ChannelRecord,
  CkbChannelAcceptancePolicy,
  LiquidityCapabilities,
  ListChannelsArgs,
  ListChannelsResult,
  OpenChannelArgs,
  OpenChannelResult,
  ShutdownChannelArgs,
  ShutdownChannelResult,
} from "../types";

function normalizeRpcChannelState(value: unknown): string {
  const candidate =
    typeof value === "string"
      ? value
      : value && typeof value === "object" && typeof (value as Record<string, unknown>).state_name === "string"
        ? ((value as Record<string, unknown>).state_name as string)
        : "";
  const normalized = candidate.trim();
  if (!normalized) {
    return "UNKNOWN";
  }
  if (normalized === "ChannelReady" || normalized === "CHANNEL_READY") {
    return "CHANNEL_READY";
  }
  if (normalized === "Closed" || normalized === "CLOSED") {
    return "CLOSED";
  }
  return normalized;
}

function parseChannelRecord(value: unknown): ChannelRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }
  const raw = value as Record<string, unknown>;
  const channelId = pickStringCandidate(raw.channel_id) ?? pickStringCandidate(raw.channelId);
  if (!channelId) {
    return null;
  }
  return {
    channelId,
    state: normalizeRpcChannelState(raw.state),
    localBalance: normalizeRpcAmount(raw.local_balance ?? raw.localBalance),
    remoteBalance: normalizeRpcAmount(raw.remote_balance ?? raw.remoteBalance),
    remotePubkey:
      pickStringCandidate(raw.remote_pubkey) ??
      pickStringCandidate(raw.remotePubkey) ??
      pickStringCandidate(raw.peer_id) ??
      pickStringCandidate(raw.peerId),
    pendingTlcCount: normalizeRpcInteger(raw.pending_tlc_count ?? raw.pendingTlcCount),
  };
}

function parseCkbChannelAcceptancePolicy(result: Record<string, unknown> | undefined): CkbChannelAcceptancePolicy {
  return {
    openChannelAutoAcceptMinFundingAmount: pickRequiredAmount(
      result,
      "open_channel_auto_accept_min_ckb_funding_amount",
    ),
    acceptChannelFundingAmount: pickRequiredAmount(result, "auto_accept_channel_ckb_funding_amount"),
  };
}

function isUnsupportedRpcMethodError(error: unknown): boolean {
  if (!(error instanceof FiberRpcError)) {
    return false;
  }
  if (error.code === -32601) {
    return true;
  }

  const message = error.message.trim().toLowerCase();
  return message === "unauthorized" || message.includes("method not found") || message.includes("unknown method");
}

async function probeDirectRebalanceSupport(endpoint: string): Promise<boolean> {
  try {
    await rpcCall(endpoint, "get_rebalance_status", {
      request_id: "__capability_probe__",
    });
    return true;
  } catch (error) {
    if (isUnsupportedRpcMethodError(error)) {
      return false;
    }
    throw error;
  }
}

async function probeChannelLifecycleSupport(endpoint: string): Promise<boolean> {
  try {
    await rpcCall(endpoint, "list_channels", {});
    return true;
  } catch (error) {
    if (isUnsupportedRpcMethodError(error)) {
      return false;
    }
    throw error;
  }
}

export async function listChannels(
  endpoint: string,
  { includeClosed = false, peerId }: ListChannelsArgs,
): Promise<ListChannelsResult> {
  const payload: Record<string, unknown> = {};
  if (includeClosed) {
    payload.include_closed = true;
  }
  if (peerId?.trim()) {
    payload.peer_id = peerId.trim();
  }

  const result = (await rpcCall(endpoint, "list_channels", payload)) as Record<string, unknown> | undefined;
  const rawChannels = Array.isArray(result?.channels) ? result.channels : [];
  const channels = rawChannels
    .map(parseChannelRecord)
    .filter((channel): channel is ChannelRecord => channel !== null)
    .filter((channel) => includeClosed || channel.state !== "CLOSED");
  return { channels };
}

export async function openChannel(
  endpoint: string,
  { peerId, fundingAmount, fundingUdtTypeScript, tlcFeeProportionalMillionths }: OpenChannelArgs,
): Promise<OpenChannelResult> {
  const payload: Record<string, unknown> = {
    peer_id: peerId,
    funding_amount: toHexQuantity(fundingAmount),
  };
  if (fundingUdtTypeScript) {
    payload.funding_udt_type_script = toRpcUdtTypeScript(fundingUdtTypeScript);
  }
  if (tlcFeeProportionalMillionths) {
    payload.tlc_fee_proportional_millionths = tlcFeeProportionalMillionths;
  }

  const result = (await rpcCall(endpoint, "open_channel", payload)) as Record<string, unknown> | undefined;
  const temporaryChannelId = pickStringCandidate(result?.temporary_channel_id);
  if (!temporaryChannelId) {
    throw new Error("open_channel response is missing 'temporary_channel_id' string");
  }
  return { temporaryChannelId };
}

export async function acceptChannel(
  endpoint: string,
  { temporaryChannelId, fundingAmount }: AcceptChannelArgs,
): Promise<AcceptChannelResult> {
  const result = (await rpcCall(endpoint, "accept_channel", {
    temporary_channel_id: temporaryChannelId,
    funding_amount: toHexQuantity(fundingAmount),
  })) as Record<string, unknown> | undefined;
  const newChannelId = pickStringCandidate(result?.new_channel_id);
  return newChannelId ? { newChannelId } : {};
}

export async function getCkbChannelAcceptancePolicy(
  endpoint: string,
): Promise<CkbChannelAcceptancePolicy> {
  const result = (await rpcCallWithoutParams(endpoint, "node_info")) as Record<string, unknown> | undefined;
  return parseCkbChannelAcceptancePolicy(result);
}

export async function shutdownChannel(
  endpoint: string,
  { channelId, closeScript, feeRate, force }: ShutdownChannelArgs,
): Promise<ShutdownChannelResult> {
  const payload: Record<string, unknown> = {
    channel_id: channelId,
  };
  if (closeScript) {
    payload.close_script = closeScript;
  }
  if (feeRate) {
    payload.fee_rate = feeRate;
  }
  if (force !== undefined) {
    payload.force = force;
  }

  const result = (await rpcCall(endpoint, "shutdown_channel", payload)) as Record<string, unknown> | undefined;
  const txHash = pickTxEvidence(result) ?? undefined;
  return txHash ? { txHash } : {};
}

export async function getLiquidityCapabilities(endpoint: string): Promise<LiquidityCapabilities> {
  const [directRebalance, channelLifecycle] = await Promise.all([
    probeDirectRebalanceSupport(endpoint),
    probeChannelLifecycleSupport(endpoint),
  ]);
  return {
    directRebalance,
    channelLifecycle,
    localCkbSweep: hasLocalChainLiquiditySweepSupport(),
  };
}
