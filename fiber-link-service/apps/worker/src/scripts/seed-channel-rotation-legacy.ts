import { createHash } from "node:crypto";
import { compareDecimalStrings, formatDecimal, parseDecimal, pow10 } from "@fiber-link/db";
import { createAdapter, type ChannelRecord } from "@fiber-link/fiber-adapter";
import { computeRequiredOpenFundingAmount } from "../channel-rotation";

const CKB_DECIMALS = 8;
const DEFAULT_P2P_PORT = "8228";
const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_POLL_INTERVAL_MS = 2_000;

type Options = {
  primaryEndpoint: string;
  peerEndpoint: string;
  primaryP2pIp: string;
  peerP2pIp: string;
  primaryP2pPort: string;
  peerP2pPort: string;
  requiredAmountCkb: string;
  minRecoverableAmountCkb: string;
  readyTimeoutMs: number;
  pollIntervalMs: number;
};

class RpcError extends Error {
  constructor(message: string, readonly code?: number, readonly data?: unknown) {
    super(message);
    this.name = "RpcError";
  }
}

function usage(): never {
  console.error(`Usage: bun run apps/worker/src/scripts/seed-channel-rotation-legacy.ts \\
  --primary-endpoint <url> \\
  --peer-endpoint <url> \\
  --primary-p2p-ip <ip> \\
  --peer-p2p-ip <ip> \\
  --required-amount-ckb <amount> \\
  [--min-recoverable-amount-ckb <amount>] \\
  [--primary-p2p-port <port>] \\
  [--peer-p2p-port <port>] \\
  [--ready-timeout-ms <ms>] \\
  [--poll-interval-ms <ms>]`);
  process.exit(64);
}

function parseArgs(argv: string[]): Options {
  const options: Partial<Options> = {
    primaryP2pPort: DEFAULT_P2P_PORT,
    peerP2pPort: DEFAULT_P2P_PORT,
    readyTimeoutMs: DEFAULT_TIMEOUT_MS,
    pollIntervalMs: DEFAULT_POLL_INTERVAL_MS,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const value = argv[index + 1];
    switch (arg) {
      case "--primary-endpoint":
        options.primaryEndpoint = value;
        index += 1;
        break;
      case "--peer-endpoint":
        options.peerEndpoint = value;
        index += 1;
        break;
      case "--primary-p2p-ip":
        options.primaryP2pIp = value;
        index += 1;
        break;
      case "--peer-p2p-ip":
        options.peerP2pIp = value;
        index += 1;
        break;
      case "--primary-p2p-port":
        options.primaryP2pPort = value;
        index += 1;
        break;
      case "--peer-p2p-port":
        options.peerP2pPort = value;
        index += 1;
        break;
      case "--required-amount-ckb":
        options.requiredAmountCkb = value;
        index += 1;
        break;
      case "--min-recoverable-amount-ckb":
        options.minRecoverableAmountCkb = value;
        index += 1;
        break;
      case "--ready-timeout-ms":
        options.readyTimeoutMs = Number(value);
        index += 1;
        break;
      case "--poll-interval-ms":
        options.pollIntervalMs = Number(value);
        index += 1;
        break;
      case "-h":
      case "--help":
        usage();
        break;
      default:
        usage();
    }
  }

  const requiredFields = [
    options.primaryEndpoint,
    options.peerEndpoint,
    options.primaryP2pIp,
    options.peerP2pIp,
    options.requiredAmountCkb,
  ];
  if (requiredFields.some((value) => !value)) {
    usage();
  }
  if (
    !Number.isInteger(options.readyTimeoutMs) ||
    (options.readyTimeoutMs ?? 0) <= 0 ||
    !Number.isInteger(options.pollIntervalMs) ||
    (options.pollIntervalMs ?? 0) <= 0
  ) {
    throw new Error("ready-timeout-ms and poll-interval-ms must be positive integers");
  }

  return {
    primaryEndpoint: options.primaryEndpoint!,
    peerEndpoint: options.peerEndpoint!,
    primaryP2pIp: options.primaryP2pIp!,
    peerP2pIp: options.peerP2pIp!,
    primaryP2pPort: options.primaryP2pPort!,
    peerP2pPort: options.peerP2pPort!,
    requiredAmountCkb: options.requiredAmountCkb!,
    minRecoverableAmountCkb: options.minRecoverableAmountCkb ?? options.requiredAmountCkb!,
    readyTimeoutMs: options.readyTimeoutMs!,
    pollIntervalMs: options.pollIntervalMs!,
  };
}

async function rpcCall(endpoint: string, method: string, params: unknown[] = []): Promise<unknown> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!response.ok) {
    throw new RpcError(`Fiber RPC HTTP ${response.status}`);
  }
  const payload = await response.json();
  if (payload?.error) {
    throw new RpcError(payload.error.message ?? "Fiber RPC error", payload.error.code, payload.error.data);
  }
  return payload?.result;
}

function pickRequiredString(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`node_info is missing ${key}`);
  }
  return value.trim();
}

function ckbToShannons(amount: string): string {
  const parsed = parseDecimal(amount);
  if (parsed.scale > CKB_DECIMALS) {
    throw new Error(`CKB amount ${amount} exceeds ${CKB_DECIMALS} decimals`);
  }
  return (parsed.value * pow10(CKB_DECIMALS - parsed.scale)).toString();
}

function shannonsToCkb(amount: string): string {
  return formatDecimal(BigInt(amount), CKB_DECIMALS);
}

function maxAmount(left: string, right: string): string {
  return compareDecimalStrings(left, right) >= 0 ? left : right;
}

function hasPositiveAmount(amount: string): boolean {
  return compareDecimalStrings(amount, "0") > 0;
}

function encodeBase58(buffer: Buffer): string {
  const alphabet = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let num = BigInt(`0x${buffer.toString("hex")}`);
  let output = "";
  while (num > 0n) {
    const remainder = Number(num % 58n);
    output = alphabet[remainder] + output;
    num /= 58n;
  }
  let leadingZeroes = 0;
  for (const byte of buffer) {
    if (byte === 0) {
      leadingZeroes += 1;
      continue;
    }
    break;
  }
  return `${"1".repeat(leadingZeroes)}${output}`;
}

function derivePeerIdFromNodeId(nodeIdHex: string): string {
  const normalized = nodeIdHex.startsWith("0x") ? nodeIdHex.slice(2) : nodeIdHex;
  const pubkey = Buffer.from(normalized, "hex");
  if (pubkey.length !== 33) {
    throw new Error(`unexpected node_id length: ${nodeIdHex}`);
  }
  const digest = createHash("sha256").update(pubkey).digest();
  return encodeBase58(Buffer.concat([Buffer.from([0x12, 0x20]), digest]));
}

function normalizeErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return error.message.trim().toLowerCase();
  }
  return String(error).trim().toLowerCase();
}

function isIgnorableConnectError(error: unknown): boolean {
  const normalized = normalizeErrorMessage(error);
  return (
    normalized.includes("already connected") ||
    normalized.includes("session already exists") ||
    normalized.includes("already exists")
  );
}

function isIgnorableAcceptError(error: unknown): boolean {
  const normalized = normalizeErrorMessage(error);
  return (
    normalized.includes("already") ||
    normalized.includes("not found") ||
    normalized.includes("no channel with temp id") ||
    normalized.includes("no channel") ||
    normalized.includes("unknown channel")
  );
}

async function connectPeer(endpoint: string, address: string) {
  try {
    await rpcCall(endpoint, "connect_peer", [{ address }]);
  } catch (error) {
    if (!isIgnorableConnectError(error)) {
      throw error;
    }
  }
}

function findEligibleChannel(channels: ChannelRecord[], minimumLocalBalance: string): ChannelRecord | null {
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

async function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForNewReadyChannel(args: {
  peerId: string;
  existingChannelIds: Set<string>;
  endpoint: string;
  timeoutMs: number;
  pollIntervalMs: number;
}) {
  const adapter = createAdapter({ endpoint: args.endpoint });
  const deadline = Date.now() + args.timeoutMs;
  let lastObserved:
    | {
        channelId: string;
        state: string;
        localBalance: string;
      }
    | null = null;
  while (Date.now() < deadline) {
    const channels = await adapter.listChannels({
      includeClosed: false,
      peerId: args.peerId,
    });
    const freshChannels = channels.channels.filter((channel) => !args.existingChannelIds.has(channel.channelId));
    const freshest = freshChannels[0];
    if (freshest) {
      lastObserved = {
        channelId: freshest.channelId,
        state: freshest.state,
        localBalance: freshest.localBalance,
      };
      console.error(
        JSON.stringify({
          step: "wait_for_ready",
          observedChannelId: freshest.channelId,
          observedState: freshest.state,
          observedLocalBalance: freshest.localBalance,
        }),
      );
    }
    const ready = channels.channels.find(
      (channel) =>
        !args.existingChannelIds.has(channel.channelId) &&
        channel.state === "CHANNEL_READY" &&
        channel.pendingTlcCount === 0,
    );
    if (ready) {
      return ready;
    }
    await delay(args.pollIntervalMs);
  }
  const detail = lastObserved
    ? `; lastObservedChannel=${lastObserved.channelId} state=${lastObserved.state} localBalance=${lastObserved.localBalance}`
    : "";
  throw new Error(`seeded legacy channel did not reach CHANNEL_READY within ${args.timeoutMs}ms${detail}`);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const primaryAdapter = createAdapter({ endpoint: options.primaryEndpoint });
  const peerAdapter = createAdapter({ endpoint: options.peerEndpoint });

  const [primaryNodeInfo, peerNodeInfo] = await Promise.all([
    rpcCall(options.primaryEndpoint, "node_info"),
    rpcCall(options.peerEndpoint, "node_info"),
  ]);
  if (!primaryNodeInfo || typeof primaryNodeInfo !== "object" || !peerNodeInfo || typeof peerNodeInfo !== "object") {
    throw new Error("node_info did not return an object payload");
  }

  const primaryPeerId = derivePeerIdFromNodeId(
    pickRequiredString(primaryNodeInfo as Record<string, unknown>, "node_id"),
  );
  const peerPeerId = derivePeerIdFromNodeId(pickRequiredString(peerNodeInfo as Record<string, unknown>, "node_id"));
  const requiredAmountShannons = ckbToShannons(options.requiredAmountCkb);
  const minRecoverableAmountShannons = ckbToShannons(options.minRecoverableAmountCkb);
  const requiredLegacyAmountShannons = maxAmount(requiredAmountShannons, minRecoverableAmountShannons);

  const existingChannels = await primaryAdapter.listChannels({
    includeClosed: false,
    peerId: peerPeerId,
  });
  console.error(
    JSON.stringify({
      step: "existing_channels",
      count: existingChannels.channels.length,
      peerId: peerPeerId,
    }),
  );
  const existingEligible = findEligibleChannel(existingChannels.channels, requiredLegacyAmountShannons);
  if (existingEligible) {
    console.log(
      JSON.stringify({
        seeded: false,
        reason: "existing_eligible_channel",
        requiredAmountCkb: options.requiredAmountCkb,
        minRecoverableAmountCkb: options.minRecoverableAmountCkb,
        selectedChannelId: existingEligible.channelId,
        selectedChannelLocalBalance: shannonsToCkb(existingEligible.localBalance),
        primaryPeerId,
        peerPeerId,
      }),
    );
    return;
  }

  const primaryConnectAddress = `/ip4/${options.primaryP2pIp}/tcp/${options.primaryP2pPort}/p2p/${primaryPeerId}`;
  const peerConnectAddress = `/ip4/${options.peerP2pIp}/tcp/${options.peerP2pPort}/p2p/${peerPeerId}`;
  await Promise.all([
    connectPeer(options.primaryEndpoint, peerConnectAddress),
    connectPeer(options.peerEndpoint, primaryConnectAddress),
  ]);
  console.error(
    JSON.stringify({
      step: "connected",
      primaryConnectAddress,
      peerConnectAddress,
    }),
  );

  const acceptancePolicy = await peerAdapter.getCkbChannelAcceptancePolicy();
  console.error(
    JSON.stringify({
      step: "acceptance_policy",
      acceptancePolicy,
    }),
  );
  const openFundingAmount = computeRequiredOpenFundingAmount({
    targetLocalBalance: requiredLegacyAmountShannons,
    openChannelAutoAcceptMinFundingAmount: acceptancePolicy.openChannelAutoAcceptMinFundingAmount,
    acceptChannelFundingAmount: acceptancePolicy.acceptChannelFundingAmount,
  });
  const openResult = await primaryAdapter.openChannel({
    peerId: peerPeerId,
    fundingAmount: openFundingAmount,
  });
  console.error(
    JSON.stringify({
      step: "open_channel",
      temporaryChannelId: openResult.temporaryChannelId,
      openFundingAmount,
    }),
  );

  let acceptOutcome: "accepted" | "ignored_error" | "skipped" = "skipped";
  if (hasPositiveAmount(acceptancePolicy.acceptChannelFundingAmount)) {
    try {
      await peerAdapter.acceptChannel({
        temporaryChannelId: openResult.temporaryChannelId,
        fundingAmount: acceptancePolicy.acceptChannelFundingAmount,
      });
      acceptOutcome = "accepted";
    } catch (error) {
      if (!isIgnorableAcceptError(error)) {
        throw error;
      }
      acceptOutcome = "ignored_error";
    }
  }
  console.error(
    JSON.stringify({
      step: "accept_channel",
      temporaryChannelId: openResult.temporaryChannelId,
      acceptOutcome,
      acceptFundingAmount: acceptancePolicy.acceptChannelFundingAmount,
    }),
  );

  const readyChannel = await waitForNewReadyChannel({
    peerId: peerPeerId,
    existingChannelIds: new Set(existingChannels.channels.map((channel) => channel.channelId)),
    endpoint: options.primaryEndpoint,
    timeoutMs: options.readyTimeoutMs,
    pollIntervalMs: options.pollIntervalMs,
  });

  console.log(
    JSON.stringify({
      seeded: true,
      requiredAmountCkb: options.requiredAmountCkb,
      minRecoverableAmountCkb: options.minRecoverableAmountCkb,
      requiredLegacyAmountCkb: shannonsToCkb(requiredLegacyAmountShannons),
      openFundingAmountCkb: shannonsToCkb(openFundingAmount),
      acceptFundingAmountCkb: shannonsToCkb(acceptancePolicy.acceptChannelFundingAmount),
      temporaryChannelId: openResult.temporaryChannelId,
      seededChannelId: readyChannel.channelId,
      seededChannelLocalBalance: shannonsToCkb(readyChannel.localBalance),
      acceptOutcome,
      primaryPeerId,
      peerPeerId,
      primaryConnectAddress,
      peerConnectAddress,
      acceptancePolicy,
    }),
  );
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
