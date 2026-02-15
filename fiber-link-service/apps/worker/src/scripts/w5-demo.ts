import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

import { createAdapter, type InvoiceState } from "@fiber-link/fiber-adapter";
import {
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentRepo,
  createDbWithdrawalRepo,
  createInMemoryLedgerRepo,
  createInMemoryTipIntentRepo,
  createInMemoryWithdrawalRepo,
  type LedgerRepo,
  type TipIntentRepo,
  type WithdrawalRepo,
} from "@fiber-link/db";
import { runSettlementDiscovery, type SettlementDiscoverySummary } from "../settlement-discovery";
import { runWithdrawalBatch } from "../withdrawal-batch";

type Asset = "CKB" | "USDI";
type DemoMode = "dry-run" | "live";

type DemoOptions = {
  mode: DemoMode;
  fixtureFile?: string;
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: Asset;
  invoiceAmount: string;
  withdrawAmount: string;
  withdrawToAddress: string;
  rpcUrl: string;
  databaseUrl: string;
  pollIntervalMs: number;
  maxPollAttempts: number;
  mockWithdrawal: boolean;
  paymentRequestId?: string;
  dryRunSeed: string;
  dryRunSettleAfterPolls: number;
  evidenceFile: string;
};

type DemoAdapter = Pick<ReturnType<typeof createAdapter>, "createInvoice" | "getInvoiceStatus" | "executeWithdrawal">;

type DemoDependencies = {
  adapter: DemoAdapter;
  tipIntentRepo: TipIntentRepo;
  ledgerRepo: LedgerRepo;
  withdrawalRepo: WithdrawalRepo;
};

type TraceEntry = {
  at: string;
  step: string;
  detail: Record<string, unknown>;
};

type SettlementWaitResult = {
  settled: boolean;
  attempts: number;
  finalInvoiceState: InvoiceState;
  settlementSummary: SettlementDiscoverySummary | null;
};

type DemoSummary = {
  mode: DemoMode;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  invoice: {
    id: string;
    tipIntentId: string;
    asset: Asset;
    amount: string;
  };
  payment: {
    requestId: string;
    txHash: string;
  };
  settlement: {
    settled: boolean;
    attempts: number;
    finalInvoiceState: InvoiceState;
    summary: SettlementDiscoverySummary | null;
  };
  accounting: {
    recipientUserId: string;
    preSettlementBalance: string;
    postSettlementBalance: string;
    expectedPostSettlementBalance: string;
    settlementCreditVerified: boolean;
    withdrawalRequestId: string;
    withdrawalState: string;
    withdrawalTxHash: string | null;
    withdrawalBatch: Awaited<ReturnType<typeof runWithdrawalBatch>>;
    finalBalance: string;
    expectedFinalBalance: string;
    finalBalanceVerified: boolean;
  };
  traceCount: number;
  evidenceFile: string;
};

type Decimal = {
  value: bigint;
  scale: number;
};

function parseMode(value: string): DemoMode {
  if (value === "dry-run" || value === "live") {
    return value;
  }
  throw new Error(`Invalid mode '${value}'. Expected 'dry-run' or 'live'.`);
}

function parseAsset(value: string): Asset {
  const normalized = value.toUpperCase();
  if (normalized === "CKB" || normalized === "USDI") {
    return normalized;
  }
  throw new Error(`Invalid asset '${value}'. Expected CKB or USDI.`);
}

function parseInteger(name: string, raw: unknown, min: number): number {
  const value = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isInteger(value) || value < min) {
    throw new Error(`${name} must be an integer >= ${min}`);
  }
  return value;
}

function parseDecimal(name: string, raw: string): Decimal {
  const value = raw.trim();
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(value);
  if (!match) {
    throw new Error(`${name} must be a decimal string`);
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const intPart = match[2] ?? "0";
  const fracPart = match[3] ?? "";
  const digits = `${intPart}${fracPart}`.replace(/^0+(?=\d)/, "");
  let amount = BigInt(digits === "" ? "0" : digits);
  if (sign < 0n && amount !== 0n) {
    amount = -amount;
  }
  return { value: amount, scale: fracPart.length };
}

function pow10(exp: number): bigint {
  if (exp <= 0) {
    return 1n;
  }
  return BigInt(`1${"0".repeat(exp)}`);
}

function formatDecimal(value: bigint, scale: number): string {
  if (scale === 0) {
    return value.toString();
  }

  const sign = value < 0n ? "-" : "";
  const abs = value < 0n ? -value : value;
  const raw = abs.toString().padStart(scale + 1, "0");
  const intPart = raw.slice(0, -scale).replace(/^0+(?=\d)/, "") || "0";
  const fracPart = raw.slice(-scale).replace(/0+$/, "");
  if (!fracPart) {
    return `${sign}${intPart}`;
  }
  return `${sign}${intPart}.${fracPart}`;
}

function normalizeDecimal(raw: string): string {
  const parsed = parseDecimal("decimal", raw);
  return formatDecimal(parsed.value, parsed.scale);
}

function addDecimal(leftRaw: string, rightRaw: string): string {
  const left = parseDecimal("left", leftRaw);
  const right = parseDecimal("right", rightRaw);
  const scale = Math.max(left.scale, right.scale);
  const leftValue = left.value * pow10(scale - left.scale);
  const rightValue = right.value * pow10(scale - right.scale);
  return formatDecimal(leftValue + rightValue, scale);
}

function subtractDecimal(leftRaw: string, rightRaw: string): string {
  const left = parseDecimal("left", leftRaw);
  const right = parseDecimal("right", rightRaw);
  const scale = Math.max(left.scale, right.scale);
  const leftValue = left.value * pow10(scale - left.scale);
  const rightValue = right.value * pow10(scale - right.scale);
  return formatDecimal(leftValue - rightValue, scale);
}

function decimalEqual(leftRaw: string, rightRaw: string): boolean {
  return normalizeDecimal(leftRaw) === normalizeDecimal(rightRaw);
}

function stableHex(seed: string, size = 16): string {
  return createHash("sha256").update(seed).digest("hex").slice(0, size);
}

function ensureNonEmpty(name: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new Error(`${name} must not be empty`);
  }
  return trimmed;
}

function sanitizeUrl(value: string): string {
  if (!value) {
    return "<empty>";
  }
  try {
    const parsed = new URL(value);
    const host = parsed.host || "<invalid-host>";
    return `${parsed.protocol}//${host}${parsed.pathname}`;
  } catch {
    return "<redacted>";
  }
}

function defaultOptions(): DemoOptions {
  const envMode = process.env.W5_MODE ?? "dry-run";
  const mode = parseMode(envMode);
  return {
    mode,
    appId: process.env.W5_APP_ID ?? "demo-app",
    postId: process.env.W5_POST_ID ?? "demo-post",
    fromUserId: process.env.W5_FROM_USER_ID ?? "demo-from",
    toUserId: process.env.W5_TO_USER_ID ?? "demo-to",
    asset: parseAsset(process.env.W5_ASSET ?? "USDI"),
    invoiceAmount: process.env.W5_INVOICE_AMOUNT ?? "1",
    withdrawAmount: process.env.W5_WITHDRAW_AMOUNT ?? "0",
    withdrawToAddress: process.env.W5_WITHDRAW_TO_ADDRESS ?? "ckt1qdemo-withdraw-address",
    rpcUrl: process.env.FIBER_RPC_URL ?? "",
    databaseUrl: process.env.DATABASE_URL ?? "",
    pollIntervalMs: parseInteger("W5_POLL_INTERVAL_MS", process.env.W5_POLL_INTERVAL_MS ?? 500, 0),
    maxPollAttempts: parseInteger("W5_POLL_ATTEMPTS", process.env.W5_POLL_ATTEMPTS ?? 20, 1),
    mockWithdrawal: process.env.W5_MOCK_WITHDRAWAL === "1",
    paymentRequestId: process.env.W5_PAYMENT_REQUEST_ID?.trim() || undefined,
    dryRunSeed: process.env.W5_DRY_RUN_SEED ?? "w5-demo-seed",
    dryRunSettleAfterPolls: parseInteger(
      "W5_DRY_RUN_SETTLE_AFTER_POLLS",
      process.env.W5_DRY_RUN_SETTLE_AFTER_POLLS ?? 2,
      1,
    ),
    evidenceFile: process.env.W5_EVIDENCE_FILE ?? "../../../docs/runbooks/evidence/w5-demo.json",
  };
}

function printUsage() {
  console.log(`Usage:
  bun run demo:w5 -- [options]

Modes:
  --mode=dry-run|live
  --dry-run
  --live

Input:
  --fixture-file=<path>            JSON with option keys (mode, appId, asset, amounts, etc)
  --app-id=<string>
  --post-id=<string>
  --from-user-id=<string>
  --to-user-id=<string>
  --asset=CKB|USDI
  --invoice-amount=<decimal>
  --withdraw-amount=<decimal>      "0" means same as invoice amount
  --withdraw-to-address=<string>
  --rpc-url=<url>
  --database-url=<url>
  --poll-interval-ms=<int>=0
  --max-poll-attempts=<int>=1
  --payment-request-id=<string>
  --mock-withdrawal
  --dry-run-seed=<string>
  --dry-run-settle-after-polls=<int>=1
  --evidence-file=<path>
  --help

Notes:
  dry-run mode is deterministic and does not require FIBER_RPC_URL or DATABASE_URL.
  live mode requires both --rpc-url/FIBER_RPC_URL and --database-url/DATABASE_URL.`);
}

async function loadFixture(path: string): Promise<Record<string, unknown>> {
  const raw = await readFile(path, "utf8");
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(`fixture file '${path}' is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`fixture file '${path}' must contain a JSON object`);
  }
  return parsed as Record<string, unknown>;
}

function asString(source: string, key: string, value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  throw new Error(`${source} field '${key}' must be a string`);
}

function asOptionalString(source: string, key: string, value: unknown): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  const parsed = asString(source, key, value).trim();
  return parsed || undefined;
}

function asBoolean(source: string, key: string, value: unknown): boolean {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    if (value === "true") return true;
    if (value === "false") return false;
  }
  throw new Error(`${source} field '${key}' must be a boolean`);
}

function applyFixtureOption(options: DemoOptions, key: string, value: unknown) {
  const source = "fixture";
  switch (key) {
    case "mode":
      options.mode = parseMode(asString(source, key, value));
      return;
    case "appId":
      options.appId = asString(source, key, value);
      return;
    case "postId":
      options.postId = asString(source, key, value);
      return;
    case "fromUserId":
      options.fromUserId = asString(source, key, value);
      return;
    case "toUserId":
      options.toUserId = asString(source, key, value);
      return;
    case "asset":
      options.asset = parseAsset(asString(source, key, value));
      return;
    case "invoiceAmount":
      options.invoiceAmount = asString(source, key, value);
      return;
    case "withdrawAmount":
      options.withdrawAmount = asString(source, key, value);
      return;
    case "withdrawToAddress":
      options.withdrawToAddress = asString(source, key, value);
      return;
    case "rpcUrl":
      options.rpcUrl = asString(source, key, value);
      return;
    case "databaseUrl":
      options.databaseUrl = asString(source, key, value);
      return;
    case "pollIntervalMs":
      options.pollIntervalMs = parseInteger("fixture.pollIntervalMs", value, 0);
      return;
    case "maxPollAttempts":
      options.maxPollAttempts = parseInteger("fixture.maxPollAttempts", value, 1);
      return;
    case "mockWithdrawal":
      options.mockWithdrawal = asBoolean(source, key, value);
      return;
    case "paymentRequestId":
      options.paymentRequestId = asOptionalString(source, key, value);
      return;
    case "dryRunSeed":
      options.dryRunSeed = asString(source, key, value);
      return;
    case "dryRunSettleAfterPolls":
      options.dryRunSettleAfterPolls = parseInteger("fixture.dryRunSettleAfterPolls", value, 1);
      return;
    case "evidenceFile":
      options.evidenceFile = asString(source, key, value);
      return;
    default:
      throw new Error(`Unsupported fixture field '${key}'`);
  }
}

function applyCliToken(options: DemoOptions, token: string) {
  if (!token.startsWith("--")) {
    throw new Error(`Unknown argument '${token}'. Use --help for usage.`);
  }

  if (token === "--dry-run") {
    options.mode = "dry-run";
    return;
  }
  if (token === "--live") {
    options.mode = "live";
    return;
  }
  if (token === "--mock-withdrawal") {
    options.mockWithdrawal = true;
    return;
  }
  if (token === "--help") {
    printUsage();
    process.exit(0);
  }

  const readValue = (prefix: string): string | null => (token.startsWith(prefix) ? token.slice(prefix.length) : null);

  const mode = readValue("--mode=");
  if (mode !== null) {
    options.mode = parseMode(mode);
    return;
  }
  const appId = readValue("--app-id=");
  if (appId !== null) {
    options.appId = appId;
    return;
  }
  const postId = readValue("--post-id=");
  if (postId !== null) {
    options.postId = postId;
    return;
  }
  const fromUserId = readValue("--from-user-id=");
  if (fromUserId !== null) {
    options.fromUserId = fromUserId;
    return;
  }
  const toUserId = readValue("--to-user-id=");
  if (toUserId !== null) {
    options.toUserId = toUserId;
    return;
  }
  const asset = readValue("--asset=");
  if (asset !== null) {
    options.asset = parseAsset(asset);
    return;
  }
  const invoiceAmount = readValue("--invoice-amount=");
  if (invoiceAmount !== null) {
    options.invoiceAmount = invoiceAmount;
    return;
  }
  const withdrawAmount = readValue("--withdraw-amount=");
  if (withdrawAmount !== null) {
    options.withdrawAmount = withdrawAmount;
    return;
  }
  const withdrawToAddress = readValue("--withdraw-to-address=");
  if (withdrawToAddress !== null) {
    options.withdrawToAddress = withdrawToAddress;
    return;
  }
  const rpcUrl = readValue("--rpc-url=");
  if (rpcUrl !== null) {
    options.rpcUrl = rpcUrl;
    return;
  }
  const databaseUrl = readValue("--database-url=");
  if (databaseUrl !== null) {
    options.databaseUrl = databaseUrl;
    return;
  }
  const pollIntervalMs = readValue("--poll-interval-ms=");
  if (pollIntervalMs !== null) {
    options.pollIntervalMs = parseInteger("--poll-interval-ms", pollIntervalMs, 0);
    return;
  }
  const maxPollAttempts = readValue("--max-poll-attempts=");
  if (maxPollAttempts !== null) {
    options.maxPollAttempts = parseInteger("--max-poll-attempts", maxPollAttempts, 1);
    return;
  }
  const paymentRequestId = readValue("--payment-request-id=");
  if (paymentRequestId !== null) {
    options.paymentRequestId = paymentRequestId.trim() || undefined;
    return;
  }
  const dryRunSeed = readValue("--dry-run-seed=");
  if (dryRunSeed !== null) {
    options.dryRunSeed = dryRunSeed;
    return;
  }
  const dryRunSettleAfterPolls = readValue("--dry-run-settle-after-polls=");
  if (dryRunSettleAfterPolls !== null) {
    options.dryRunSettleAfterPolls = parseInteger("--dry-run-settle-after-polls", dryRunSettleAfterPolls, 1);
    return;
  }
  const evidenceFile = readValue("--evidence-file=");
  if (evidenceFile !== null) {
    options.evidenceFile = evidenceFile;
    return;
  }
  const fixtureFile = readValue("--fixture-file=");
  if (fixtureFile !== null) {
    options.fixtureFile = fixtureFile;
    return;
  }

  throw new Error(`Unknown argument '${token}'. Use --help for usage.`);
}

function normalizeOptions(options: DemoOptions) {
  options.appId = ensureNonEmpty("--app-id", options.appId);
  options.postId = ensureNonEmpty("--post-id", options.postId);
  options.fromUserId = ensureNonEmpty("--from-user-id", options.fromUserId);
  options.toUserId = ensureNonEmpty("--to-user-id", options.toUserId);
  options.withdrawToAddress = ensureNonEmpty("--withdraw-to-address", options.withdrawToAddress);
  options.evidenceFile = ensureNonEmpty("--evidence-file", options.evidenceFile);
  options.dryRunSeed = ensureNonEmpty("--dry-run-seed", options.dryRunSeed);

  const invoiceAmountDecimal = parseDecimal("--invoice-amount", options.invoiceAmount);
  if (invoiceAmountDecimal.value <= 0n) {
    throw new Error("--invoice-amount must be greater than 0");
  }
  options.invoiceAmount = formatDecimal(invoiceAmountDecimal.value, invoiceAmountDecimal.scale);

  const withdrawAmountDecimal = parseDecimal("--withdraw-amount", options.withdrawAmount);
  if (withdrawAmountDecimal.value < 0n) {
    throw new Error("--withdraw-amount must be >= 0");
  }
  if (withdrawAmountDecimal.value === 0n) {
    options.withdrawAmount = options.invoiceAmount;
  } else {
    options.withdrawAmount = formatDecimal(withdrawAmountDecimal.value, withdrawAmountDecimal.scale);
  }
}

async function parseArgs(argv: string[]): Promise<{ options: DemoOptions }> {
  let fixtureFileArg: string | undefined;
  for (const token of argv) {
    if (token === "--help") {
      printUsage();
      process.exit(0);
    }
    if (token.startsWith("--fixture-file=")) {
      fixtureFileArg = token.slice("--fixture-file=".length);
    }
  }

  const options = defaultOptions();

  if (fixtureFileArg) {
    options.fixtureFile = fixtureFileArg;
  }
  if (options.fixtureFile) {
    const fixture = await loadFixture(options.fixtureFile);
    for (const [key, value] of Object.entries(fixture)) {
      applyFixtureOption(options, key, value);
    }
  }

  for (const token of argv) {
    if (token.startsWith("--fixture-file=")) {
      continue;
    }
    applyCliToken(options, token);
  }

  normalizeOptions(options);
  return { options };
}

function createTracer() {
  const entries: TraceEntry[] = [];
  const log = (step: string, detail: Record<string, unknown> = {}) => {
    const entry: TraceEntry = {
      at: new Date().toISOString(),
      step,
      detail,
    };
    entries.push(entry);
    console.log(`[W5 demo][trace] ${step} ${JSON.stringify(detail)}`);
  };
  return { entries, log };
}

function resolvePaymentRequestId(options: DemoOptions, invoice: string): string {
  if (options.paymentRequestId) {
    return options.paymentRequestId;
  }
  if (options.mode === "dry-run") {
    return `w5-payment-${stableHex(`${options.dryRunSeed}|${invoice}`, 20)}`;
  }
  return `w5-payment-${randomUUID()}`;
}

function assertLiveDependencies(options: DemoOptions) {
  if (!options.rpcUrl) {
    throw new Error(
      "BLOCKER: live mode requires FIBER_RPC_URL (--rpc-url). Use --mode=dry-run for deterministic local execution.",
    );
  }
  if (!options.databaseUrl) {
    throw new Error(
      "BLOCKER: live mode requires DATABASE_URL (--database-url). Use --mode=dry-run for deterministic local execution.",
    );
  }
}

function createDryRunAdapter(options: DemoOptions): DemoAdapter {
  let invoiceCounter = 0;
  let paymentCounter = 0;
  const states = new Map<
    string,
    {
      paid: boolean;
      pollsAfterPayment: number;
      state: InvoiceState;
    }
  >();

  return {
    async createInvoice({ amount, asset }) {
      invoiceCounter += 1;
      const invoice = `dry:${asset}:${amount}:${stableHex(
        `${options.dryRunSeed}|invoice|${invoiceCounter}|${asset}|${amount}`,
        24,
      )}`;
      states.set(invoice, {
        paid: false,
        pollsAfterPayment: 0,
        state: "UNPAID",
      });
      return { invoice };
    },

    async getInvoiceStatus({ invoice }) {
      const record = states.get(invoice);
      if (!record) {
        return { state: "FAILED" };
      }
      if (record.state === "UNPAID" && record.paid) {
        record.pollsAfterPayment += 1;
        if (record.pollsAfterPayment >= options.dryRunSettleAfterPolls) {
          record.state = "SETTLED";
        }
      }
      return { state: record.state };
    },

    async executeWithdrawal({ amount, asset, toAddress, requestId }) {
      paymentCounter += 1;
      const txHash = `0x${stableHex(
        `${options.dryRunSeed}|payment|${paymentCounter}|${requestId}|${asset}|${amount}|${toAddress}`,
        64,
      )}`;
      const invoiceRecord = states.get(toAddress);
      if (invoiceRecord) {
        invoiceRecord.paid = true;
      }
      return { txHash };
    },
  };
}

function createDependencies(options: DemoOptions): DemoDependencies {
  if (options.mode === "live") {
    assertLiveDependencies(options);
    const db = createDbClient(options.databaseUrl);
    return {
      adapter: createAdapter({ endpoint: options.rpcUrl }),
      tipIntentRepo: createDbTipIntentRepo(db),
      ledgerRepo: createDbLedgerRepo(db),
      withdrawalRepo: createDbWithdrawalRepo(db),
    };
  }

  return {
    adapter: createDryRunAdapter(options),
    tipIntentRepo: createInMemoryTipIntentRepo(),
    ledgerRepo: createInMemoryLedgerRepo(),
    withdrawalRepo: createInMemoryWithdrawalRepo(),
  };
}

async function waitForSettlement(args: {
  invoice: string;
  appId: string;
  createdAtFrom: Date;
  adapter: DemoAdapter;
  tipIntentRepo: TipIntentRepo;
  ledgerRepo: LedgerRepo;
  pollIntervalMs: number;
  maxPollAttempts: number;
  onAttempt: (payload: {
    attempt: number;
    invoiceState: InvoiceState;
    settledCredits: number;
    stillUnpaid: number;
    errors: number;
  }) => void;
}): Promise<SettlementWaitResult> {
  let settlementSummary: SettlementDiscoverySummary | null = null;
  let finalInvoiceState: InvoiceState = "UNPAID";

  for (let attempt = 1; attempt <= args.maxPollAttempts; attempt += 1) {
    settlementSummary = await runSettlementDiscovery({
      limit: 50,
      appId: args.appId,
      createdAtFrom: args.createdAtFrom,
      adapter: args.adapter,
      tipIntentRepo: args.tipIntentRepo,
      ledgerRepo: args.ledgerRepo,
      logger: {
        info: () => undefined,
        error: () => undefined,
      },
    });

    const saved = await args.tipIntentRepo.findByInvoiceOrThrow(args.invoice);
    finalInvoiceState = saved.invoiceState;
    args.onAttempt({
      attempt,
      invoiceState: finalInvoiceState,
      settledCredits: settlementSummary.settledCredits,
      stillUnpaid: settlementSummary.stillUnpaid,
      errors: settlementSummary.errors,
    });

    if (finalInvoiceState === "SETTLED") {
      return {
        settled: true,
        attempts: attempt,
        finalInvoiceState,
        settlementSummary,
      };
    }

    if (attempt < args.maxPollAttempts && args.pollIntervalMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, args.pollIntervalMs));
    }
  }

  return {
    settled: false,
    attempts: args.maxPollAttempts,
    finalInvoiceState,
    settlementSummary,
  };
}

async function writeEvidence(filePath: string, evidence: unknown) {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

async function main() {
  const { options } = await parseArgs(process.argv.slice(2));
  const tracer = createTracer();
  const dependencies = createDependencies(options);
  const startedAtMs = Date.now();
  const startedAt = new Date(startedAtMs).toISOString();

  tracer.log("start", {
    mode: options.mode,
    fixtureFile: options.fixtureFile ?? null,
    appId: options.appId,
    postId: options.postId,
    asset: options.asset,
    invoiceAmount: options.invoiceAmount,
    withdrawAmount: options.withdrawAmount,
    withdrawToAddress: options.withdrawToAddress,
    pollIntervalMs: options.pollIntervalMs,
    maxPollAttempts: options.maxPollAttempts,
    dryRunSettleAfterPolls: options.dryRunSettleAfterPolls,
    rpcUrl: options.mode === "live" ? sanitizeUrl(options.rpcUrl) : "<not-used>",
    databaseUrl: options.mode === "live" ? sanitizeUrl(options.databaseUrl) : "<not-used>",
  });

  const preSettlementBalance = await dependencies.ledgerRepo.getBalance({
    appId: options.appId,
    userId: options.toUserId,
    asset: options.asset,
  });
  tracer.log("balance.pre-settlement", {
    recipient: options.toUserId,
    balance: preSettlementBalance,
  });

  const createdAtFrom = new Date();
  const invoiceResult = await dependencies.adapter.createInvoice({
    amount: options.invoiceAmount,
    asset: options.asset,
  });
  tracer.log("invoice.created", {
    invoice: invoiceResult.invoice,
  });

  const tipIntent = await dependencies.tipIntentRepo.create({
    appId: options.appId,
    postId: options.postId,
    fromUserId: options.fromUserId,
    toUserId: options.toUserId,
    asset: options.asset,
    amount: options.invoiceAmount,
    invoice: invoiceResult.invoice,
  });
  tracer.log("tip-intent.created", {
    tipIntentId: tipIntent.id,
    invoice: tipIntent.invoice,
  });

  const paymentRequestId = resolvePaymentRequestId(options, tipIntent.invoice);
  const payment = await dependencies.adapter.executeWithdrawal({
    amount: options.invoiceAmount,
    asset: options.asset,
    toAddress: tipIntent.invoice,
    requestId: paymentRequestId,
  });
  tracer.log("payment.executed", {
    requestId: paymentRequestId,
    txHash: payment.txHash,
  });

  const settlement = await waitForSettlement({
    invoice: tipIntent.invoice,
    appId: options.appId,
    createdAtFrom,
    adapter: dependencies.adapter,
    tipIntentRepo: dependencies.tipIntentRepo,
    ledgerRepo: dependencies.ledgerRepo,
    pollIntervalMs: options.pollIntervalMs,
    maxPollAttempts: options.maxPollAttempts,
    onAttempt(payload) {
      tracer.log("settlement.poll", payload);
    },
  });

  if (!settlement.settled) {
    throw new Error(
      `invoice '${tipIntent.invoice}' did not settle after ${settlement.attempts} attempts (final state: ${settlement.finalInvoiceState})`,
    );
  }
  tracer.log("settlement.completed", {
    settled: settlement.settled,
    attempts: settlement.attempts,
    finalInvoiceState: settlement.finalInvoiceState,
  });

  const postSettlementBalance = await dependencies.ledgerRepo.getBalance({
    appId: options.appId,
    userId: options.toUserId,
    asset: options.asset,
  });
  const expectedPostSettlementBalance = addDecimal(preSettlementBalance, options.invoiceAmount);
  const settlementCreditVerified = decimalEqual(postSettlementBalance, expectedPostSettlementBalance);
  tracer.log("balance.post-settlement", {
    balance: postSettlementBalance,
    expected: expectedPostSettlementBalance,
    verified: settlementCreditVerified,
  });

  const withdrawal = await dependencies.withdrawalRepo.createWithBalanceCheck(
    {
      appId: options.appId,
      userId: options.toUserId,
      asset: options.asset,
      amount: options.withdrawAmount,
      toAddress: options.withdrawToAddress,
    },
    { ledgerRepo: dependencies.ledgerRepo },
  );
  tracer.log("withdrawal.requested", {
    withdrawalRequestId: withdrawal.id,
    amount: withdrawal.amount,
  });

  let dryRunWithdrawalCounter = 0;
  const withdrawalBatch = await runWithdrawalBatch({
    repo: dependencies.withdrawalRepo,
    ledgerRepo: dependencies.ledgerRepo,
    executeWithdrawal: async (item) => {
      if (options.mode === "dry-run") {
        dryRunWithdrawalCounter += 1;
        return {
          ok: true,
          txHash: `0x${stableHex(
            `${options.dryRunSeed}|withdrawal|${dryRunWithdrawalCounter}|${item.appId}|${item.userId}|${item.amount}|${item.toAddress}`,
            64,
          )}`,
        };
      }
      if (options.mockWithdrawal) {
        return { ok: true, txHash: `mock-withdrawal-${item.id}` };
      }
      const result = await dependencies.adapter.executeWithdrawal({
        amount: item.amount,
        asset: item.asset,
        toAddress: item.toAddress,
        requestId: item.id,
      });
      return { ok: true, txHash: result.txHash };
    },
  });
  tracer.log("withdrawal.batch", withdrawalBatch);

  const withdrawalFinal = await dependencies.withdrawalRepo.findByIdOrThrow(withdrawal.id);
  const finalBalance = await dependencies.ledgerRepo.getBalance({
    appId: options.appId,
    userId: options.toUserId,
    asset: options.asset,
  });
  const expectedFinalBalance = subtractDecimal(postSettlementBalance, options.withdrawAmount);
  const finalBalanceVerified = decimalEqual(finalBalance, expectedFinalBalance);
  tracer.log("withdrawal.finalized", {
    withdrawalRequestId: withdrawalFinal.id,
    state: withdrawalFinal.state,
    txHash: withdrawalFinal.txHash,
    finalBalance,
    expectedFinalBalance,
    verified: finalBalanceVerified,
  });

  const verificationErrors: string[] = [];
  if (!settlementCreditVerified) {
    verificationErrors.push(
      `post-settlement balance mismatch (expected ${expectedPostSettlementBalance}, got ${postSettlementBalance})`,
    );
  }
  if (withdrawalFinal.state !== "COMPLETED") {
    verificationErrors.push(`withdrawal is not COMPLETED (state: ${withdrawalFinal.state})`);
  }
  if (!withdrawalFinal.txHash) {
    verificationErrors.push("withdrawal txHash is missing");
  }
  if (!finalBalanceVerified) {
    verificationErrors.push(`final balance mismatch (expected ${expectedFinalBalance}, got ${finalBalance})`);
  }
  if (verificationErrors.length > 0) {
    throw new Error(`accounting verification failed: ${verificationErrors.join("; ")}`);
  }

  const finishedAtMs = Date.now();
  const finishedAt = new Date(finishedAtMs).toISOString();
  const summary: DemoSummary = {
    mode: options.mode,
    startedAt,
    finishedAt,
    durationMs: finishedAtMs - startedAtMs,
    invoice: {
      id: tipIntent.invoice,
      tipIntentId: tipIntent.id,
      asset: options.asset,
      amount: options.invoiceAmount,
    },
    payment: {
      requestId: paymentRequestId,
      txHash: payment.txHash,
    },
    settlement: {
      settled: settlement.settled,
      attempts: settlement.attempts,
      finalInvoiceState: settlement.finalInvoiceState,
      summary: settlement.settlementSummary,
    },
    accounting: {
      recipientUserId: options.toUserId,
      preSettlementBalance,
      postSettlementBalance,
      expectedPostSettlementBalance,
      settlementCreditVerified,
      withdrawalRequestId: withdrawalFinal.id,
      withdrawalState: withdrawalFinal.state,
      withdrawalTxHash: withdrawalFinal.txHash,
      withdrawalBatch,
      finalBalance,
      expectedFinalBalance,
      finalBalanceVerified,
    },
    traceCount: tracer.entries.length,
    evidenceFile: options.evidenceFile,
  };

  await writeEvidence(options.evidenceFile, {
    summary,
    trace: tracer.entries,
  });
  tracer.log("evidence.written", { path: options.evidenceFile });

  console.log("[W5 demo] completed");
  console.log(JSON.stringify(summary, null, 2));
}

main().catch((error) => {
  if (error instanceof Error) {
    console.error(`[W5 demo] failed: ${error.message}`);
  } else {
    console.error("[W5 demo] failed:", error);
  }
  process.exit(1);
});
