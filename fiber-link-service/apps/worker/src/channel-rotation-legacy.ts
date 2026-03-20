import { compareDecimalStrings } from "@fiber-link/db";
import type {
  AcceptChannelArgs,
  AcceptChannelResult,
  ChannelRecord,
  ListChannelsArgs,
  ListChannelsResult,
} from "@fiber-link/fiber-adapter";

const DEFAULT_ACCEPT_RETRY_INTERVAL = 6;
const STALLED_CHANNEL_STATES = new Set(["AWAITING_TX_SIGNATURES", "AWAITING_CHANNEL_READY"]);

function hasPositiveAmount(amount: string): boolean {
  return compareDecimalStrings(amount, "0") > 0;
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim().toLowerCase();
  }
  return String(error).trim().toLowerCase();
}

export function isIgnorableAcceptChannelError(error: unknown): boolean {
  const normalized = normalizeErrorMessage(error);
  return (
    normalized.includes("already") ||
    normalized.includes("not found") ||
    normalized.includes("no channel with temp id") ||
    normalized.includes("no channel") ||
    normalized.includes("unknown channel")
  );
}

export function selectSeededLegacyChannel(
  channels: ChannelRecord[],
  minimumLocalBalance: string,
): ChannelRecord | null {
  let selected: ChannelRecord | null = null;
  for (const channel of channels) {
    if (
      channel.state !== "CHANNEL_READY" ||
      channel.pendingTlcCount !== 0 ||
      compareDecimalStrings(channel.localBalance, minimumLocalBalance) < 0
    ) {
      continue;
    }
    if (!selected || compareDecimalStrings(channel.localBalance, selected.localBalance) > 0) {
      selected = channel;
    }
  }
  return selected;
}

export type WaitForSeededLegacyChannelReadyInput = {
  peerId: string;
  existingChannelIds: Set<string>;
  listChannels: (args: ListChannelsArgs) => Promise<ListChannelsResult>;
  timeoutMs: number;
  pollIntervalMs: number;
  acceptChannel?: (args: AcceptChannelArgs) => Promise<AcceptChannelResult>;
  temporaryChannelId?: string;
  acceptFundingAmount?: string;
  acceptRetryInterval?: number;
  onObservation?: (channel: Pick<ChannelRecord, "channelId" | "state" | "localBalance">) => void;
  onAcceptRetry?: (event: {
    attempt: number;
    observedState: string;
    temporaryChannelId: string;
    outcome: "accepted" | "ignored_error";
  }) => void;
  delayFn?: (ms: number) => Promise<void>;
};

async function defaultDelay(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForSeededLegacyChannelReady(
  input: WaitForSeededLegacyChannelReadyInput,
): Promise<ChannelRecord> {
  const deadline = Date.now() + input.timeoutMs;
  const delayFn = input.delayFn ?? defaultDelay;
  const acceptRetryInterval = input.acceptRetryInterval ?? DEFAULT_ACCEPT_RETRY_INTERVAL;
  const acceptFundingAmount = input.acceptFundingAmount ?? "0";
  let attempt = 0;
  let lastObserved:
    | {
        channelId: string;
        state: string;
        localBalance: string;
      }
    | null = null;

  while (Date.now() < deadline) {
    attempt += 1;

    const channels = await input.listChannels({
      includeClosed: false,
      peerId: input.peerId,
    });
    const freshChannels = channels.channels.filter((channel) => !input.existingChannelIds.has(channel.channelId));
    const freshest = freshChannels[0];

    if (freshest) {
      lastObserved = {
        channelId: freshest.channelId,
        state: freshest.state,
        localBalance: freshest.localBalance,
      };
      input.onObservation?.(lastObserved);
    }

    const ready = channels.channels.find(
      (channel) =>
        !input.existingChannelIds.has(channel.channelId) &&
        channel.state === "CHANNEL_READY" &&
        channel.pendingTlcCount === 0,
    );
    if (ready) {
      return ready;
    }

    if (
      freshest &&
      input.acceptChannel &&
      input.temporaryChannelId &&
      hasPositiveAmount(acceptFundingAmount) &&
      STALLED_CHANNEL_STATES.has(freshest.state) &&
      attempt % acceptRetryInterval === 0
    ) {
      try {
        await input.acceptChannel({
          temporaryChannelId: input.temporaryChannelId,
          fundingAmount: acceptFundingAmount,
        });
        input.onAcceptRetry?.({
          attempt,
          observedState: freshest.state,
          temporaryChannelId: input.temporaryChannelId,
          outcome: "accepted",
        });
      } catch (error) {
        if (!isIgnorableAcceptChannelError(error)) {
          throw error;
        }
        input.onAcceptRetry?.({
          attempt,
          observedState: freshest.state,
          temporaryChannelId: input.temporaryChannelId,
          outcome: "ignored_error",
        });
      }
    }

    await delayFn(input.pollIntervalMs);
  }

  const detail = lastObserved
    ? `; lastObservedChannel=${lastObserved.channelId} state=${lastObserved.state} localBalance=${lastObserved.localBalance}`
    : "";
  throw new Error(`seeded legacy channel did not reach CHANNEL_READY within ${input.timeoutMs}ms${detail}`);
}
