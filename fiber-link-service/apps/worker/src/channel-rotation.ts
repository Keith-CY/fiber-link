import { compareDecimalStrings, formatDecimal, parseDecimal, pow10 } from "@fiber-link/db";
import type {
  AcceptChannelArgs,
  AcceptChannelResult,
  CkbChannelAcceptancePolicy,
  ChannelRecord,
  ListChannelsArgs,
  ListChannelsResult,
  OpenChannelArgs,
  OpenChannelResult,
  ShutdownChannelArgs,
  ShutdownChannelResult,
} from "@fiber-link/fiber-adapter";
import { createLiquidityChannelRotationEvent, type LiquidityChannelRotationEvent } from "./contracts";

export type SelectLegacyChannelInput = {
  minRecoverableAmount: string;
  channels: ChannelRecord[];
};

export type ExecuteChannelRotationInput = SelectLegacyChannelInput & {
  liquidityRequestId: string;
  shortfallAmount: string;
  bootstrapReserve: string;
  closeScript?: Record<string, unknown>;
  listChannels: (args: ListChannelsArgs) => Promise<ListChannelsResult>;
  openChannel: (args: OpenChannelArgs) => Promise<OpenChannelResult>;
  acceptChannel: (args: AcceptChannelArgs) => Promise<AcceptChannelResult>;
  getCkbChannelAcceptancePolicy: () => Promise<CkbChannelAcceptancePolicy>;
  shutdownChannel: (args: ShutdownChannelArgs) => Promise<ShutdownChannelResult>;
  replacementReadyTimeoutMs?: number;
  replacementReadyPollIntervalMs?: number;
};

export type ChannelRotationResult = {
  liquidityRequestId: string;
  legacyChannelId: string;
  replacementChannelId: string;
  expectedRecoveredAmount: string;
  legacyChannelLocalBalance: string;
  replacementFundingAmount: string;
  acceptFundingAmount: string;
  event: LiquidityChannelRotationEvent;
};

const CKB_DECIMALS = 8;
const DEFAULT_REPLACEMENT_READY_TIMEOUT_MS = 120_000;
const DEFAULT_REPLACEMENT_READY_POLL_INTERVAL_MS = 2_000;

function hasPositiveAmount(amount: string): boolean {
  return compareDecimalStrings(amount, "0") > 0;
}

function ckbToShannons(amount: string): string {
  const parsed = parseDecimal(amount);
  if (parsed.scale > CKB_DECIMALS) {
    throw new Error(`CKB amount ${amount} exceeds supported precision of ${CKB_DECIMALS} decimals`);
  }
  return (parsed.value * pow10(CKB_DECIMALS - parsed.scale)).toString();
}

function shannonsToCkb(amount: string): string {
  return formatDecimal(BigInt(amount), CKB_DECIMALS);
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function maxAmount(left: string, right: string): string {
  return compareDecimalStrings(left, right) >= 0 ? left : right;
}

function addAmounts(left: string, right: string): string {
  return (BigInt(left) + BigInt(right)).toString();
}

function computeExpectedRecoveredAmount(input: {
  legacyChannelLocalBalance: string;
  acceptChannelFundingAmount: string;
}): string {
  return shannonsToCkb(addAmounts(input.legacyChannelLocalBalance, input.acceptChannelFundingAmount));
}

function isIgnorableAcceptChannelError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const normalized = error.message.trim().toLowerCase();
  return (
    normalized.includes("already") ||
    normalized.includes("not found") ||
    normalized.includes("no channel with temp id") ||
    normalized.includes("no channel") ||
    normalized.includes("unknown channel")
  );
}

export function computeRequiredOpenFundingAmount(input: {
  targetLocalBalance: string;
  openChannelAutoAcceptMinFundingAmount: string;
  acceptChannelFundingAmount: string;
}): string {
  const targetWithPeerContribution = hasPositiveAmount(input.acceptChannelFundingAmount)
    ? addAmounts(input.targetLocalBalance, input.acceptChannelFundingAmount)
    : input.targetLocalBalance;

  return maxAmount(targetWithPeerContribution, input.openChannelAutoAcceptMinFundingAmount);
}

function isEligibleLegacyChannel(channel: ChannelRecord, minRecoverableAmount: string): boolean {
  return (
    channel.state === "CHANNEL_READY" &&
    channel.pendingTlcCount === 0 &&
    compareDecimalStrings(channel.localBalance, ckbToShannons(minRecoverableAmount)) >= 0
  );
}

export function selectLegacyChannel(input: SelectLegacyChannelInput): ChannelRecord | null {
  let selected: ChannelRecord | null = null;
  for (const channel of input.channels) {
    if (!isEligibleLegacyChannel(channel, input.minRecoverableAmount)) {
      continue;
    }
    if (!selected || compareDecimalStrings(channel.localBalance, selected.localBalance) > 0) {
      selected = channel;
    }
  }
  return selected;
}

async function waitForReplacementChannelReady(input: {
  peerId: string;
  existingChannelIds: Set<string>;
  listChannels: (args: ListChannelsArgs) => Promise<ListChannelsResult>;
  timeoutMs: number;
  pollIntervalMs: number;
}): Promise<ChannelRecord> {
  const deadline = Date.now() + input.timeoutMs;

  while (Date.now() < deadline) {
    const result = await input.listChannels({
      includeClosed: false,
      peerId: input.peerId,
    });

    const readyReplacement = result.channels.find(
      (channel) =>
        !input.existingChannelIds.has(channel.channelId) &&
        channel.state === "CHANNEL_READY" &&
        channel.pendingTlcCount === 0,
    );
    if (readyReplacement) {
      return readyReplacement;
    }

    await delay(input.pollIntervalMs);
  }

  throw new Error(`replacement channel did not reach CHANNEL_READY with peer ${input.peerId}`);
}

export async function executeChannelRotation(input: ExecuteChannelRotationInput): Promise<ChannelRotationResult> {
  if (!hasPositiveAmount(input.bootstrapReserve)) {
    throw new Error("bootstrap reserve must be greater than zero before opening a replacement channel");
  }

  const legacyChannel = selectLegacyChannel({
    minRecoverableAmount: input.minRecoverableAmount,
    channels: input.channels,
  });
  if (!legacyChannel) {
    throw new Error(
      `no eligible legacy channel found for liquidity request ${input.liquidityRequestId} with shortfall ${input.shortfallAmount}`,
    );
  }
  if (!legacyChannel.remotePubkey) {
    throw new Error(`legacy channel ${legacyChannel.channelId} is missing remotePubkey`);
  }

  const existingChannelIds = new Set(
    input.channels
      .filter((channel) => channel.remotePubkey === legacyChannel.remotePubkey)
      .map((channel) => channel.channelId),
  );

  const acceptancePolicy = await input.getCkbChannelAcceptancePolicy();
  const replacementFundingAmount = computeRequiredOpenFundingAmount({
    targetLocalBalance: ckbToShannons(input.bootstrapReserve),
    openChannelAutoAcceptMinFundingAmount: acceptancePolicy.openChannelAutoAcceptMinFundingAmount,
    acceptChannelFundingAmount: acceptancePolicy.acceptChannelFundingAmount,
  });
  const openResult = await input.openChannel({
    peerId: legacyChannel.remotePubkey,
    fundingAmount: replacementFundingAmount,
  });
  const acceptFundingAmount = acceptancePolicy.acceptChannelFundingAmount;
  if (hasPositiveAmount(acceptFundingAmount)) {
    try {
      await input.acceptChannel({
        temporaryChannelId: openResult.temporaryChannelId,
        fundingAmount: acceptFundingAmount,
      });
    } catch (error) {
      if (!isIgnorableAcceptChannelError(error)) {
        throw error;
      }
    }
  }
  const readyReplacement = await waitForReplacementChannelReady({
    peerId: legacyChannel.remotePubkey,
    existingChannelIds,
    listChannels: input.listChannels,
    timeoutMs: input.replacementReadyTimeoutMs ?? DEFAULT_REPLACEMENT_READY_TIMEOUT_MS,
    pollIntervalMs: input.replacementReadyPollIntervalMs ?? DEFAULT_REPLACEMENT_READY_POLL_INTERVAL_MS,
  });
  await input.shutdownChannel({
    channelId: legacyChannel.channelId,
    closeScript: input.closeScript,
  });
  const expectedRecoveredAmount = computeExpectedRecoveredAmount({
    legacyChannelLocalBalance: legacyChannel.localBalance,
    acceptChannelFundingAmount: acceptFundingAmount,
  });

  const event = createLiquidityChannelRotationEvent({
    liquidityRequestId: input.liquidityRequestId,
    legacyChannelId: legacyChannel.channelId,
    replacementChannelId: readyReplacement.channelId,
    expectedRecoveredAmount,
  });

  return {
    liquidityRequestId: input.liquidityRequestId,
    legacyChannelId: legacyChannel.channelId,
    replacementChannelId: readyReplacement.channelId,
    expectedRecoveredAmount,
    legacyChannelLocalBalance: shannonsToCkb(legacyChannel.localBalance),
    replacementFundingAmount: shannonsToCkb(replacementFundingAmount),
    acceptFundingAmount: shannonsToCkb(acceptFundingAmount),
    event,
  };
}
