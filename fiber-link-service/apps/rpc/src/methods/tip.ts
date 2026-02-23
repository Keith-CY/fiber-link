import { createAdapter, createAdapterProvider } from "@fiber-link/fiber-adapter";
import {
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentEventRepo,
  createDbTipIntentRepo,
  type LedgerRepo,
  type TipIntentEventRepo,
  type TipIntentRepo,
} from "@fiber-link/db";
import type { InvoiceState } from "@fiber-link/fiber-adapter";

let defaultTipIntentRepo: TipIntentRepo | null | undefined;
let defaultLedgerRepo: LedgerRepo | null | undefined;
let defaultAdapter: ReturnType<typeof createAdapterProvider> | null | undefined;
let defaultTipIntentEventRepo: TipIntentEventRepo | null | undefined;

function isInvoiceStateConflictError(error: unknown): boolean {
  if (!error || typeof error !== "object") {
    return false;
  }

  const maybeError = error as { name?: unknown; message?: unknown };
  if (maybeError.name === "InvoiceStateTransitionError") {
    return true;
  }

  if (typeof maybeError.message === "string") {
    return maybeError.message.includes("invalid invoice state transition");
  }

  return false;
}

function getDefaultTipIntentRepo(): TipIntentRepo {
  if (defaultTipIntentRepo !== undefined) {
    if (!defaultTipIntentRepo) {
      throw new Error("TipIntentRepo is not available (DATABASE_URL missing).");
    }
    return defaultTipIntentRepo;
  }

  try {
    defaultTipIntentRepo = createDbTipIntentRepo(createDbClient());
  } catch (error) {
    console.error("Failed to initialize default TipIntentRepo.", error);
    defaultTipIntentRepo = null;
    throw error;
  }

  return defaultTipIntentRepo;
}

function getDefaultLedgerRepo(): LedgerRepo {
  if (defaultLedgerRepo !== undefined) {
    return defaultLedgerRepo;
  }
  defaultLedgerRepo = createDbLedgerRepo(createDbClient());
  return defaultLedgerRepo;
}

function getDefaultTipIntentEventRepo(): TipIntentEventRepo | null {
  if (defaultTipIntentEventRepo !== undefined) {
    return defaultTipIntentEventRepo;
  }

  try {
    defaultTipIntentEventRepo = createDbTipIntentEventRepo(createDbClient());
  } catch (error) {
    console.error("Failed to initialize default TipIntentEventRepo.", error);
    defaultTipIntentEventRepo = null;
  }

  return defaultTipIntentEventRepo;
}

function getDefaultAdapter() {
  if (defaultAdapter !== undefined) {
    return defaultAdapter;
  }

  defaultAdapter = createAdapterProvider({
    rpcFactory: createAdapter,
  });
  return defaultAdapter;
}

export type HandleTipCreateInput = {
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: "CKB" | "USDI";
  amount: string;
};

export type HandleTipStatusInput = {
  invoice: string;
};

type HandleTipStatusOptions = {
  tipIntentRepo?: TipIntentRepo;
  ledgerRepo?: LedgerRepo;
  tipIntentEventRepo?: TipIntentEventRepo;
  adapter?: {
    getInvoiceStatus: (input: { invoice: string }) => Promise<{ state: InvoiceState }>;
  };
};

type HandleTipCreateOptions = {
  tipIntentRepo?: TipIntentRepo;
  tipIntentEventRepo?: TipIntentEventRepo;
  adapter?: {
    createInvoice: (input: { amount: string; asset: "CKB" | "USDI" }) => Promise<{ invoice: string }>;
  };
};

function statusStateToTimelineType(state: InvoiceState): "TIP_STATUS_UNPAID_OBSERVED" | "TIP_STATUS_SETTLED" | "TIP_STATUS_FAILED" {
  if (state === "SETTLED") {
    return "TIP_STATUS_SETTLED";
  }
  if (state === "FAILED") {
    return "TIP_STATUS_FAILED";
  }
  return "TIP_STATUS_UNPAID_OBSERVED";
}

async function appendTipTimelineEvent(
  eventRepo: TipIntentEventRepo | null,
  input: Parameters<TipIntentEventRepo["append"]>[0],
): Promise<void> {
  if (!eventRepo) {
    return;
  }
  try {
    await eventRepo.append(input);
  } catch (error) {
    console.error("Failed to append tip intent timeline event.", error);
  }
}

export async function handleTipCreate(
  input: HandleTipCreateInput,
  options: HandleTipCreateOptions = {},
) {
  const adapter = options.adapter ?? getDefaultAdapter();
  const invoice = await adapter.createInvoice({ amount: input.amount, asset: input.asset });
  const repo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  const eventRepo = options.tipIntentEventRepo ?? getDefaultTipIntentEventRepo();
  const tipIntent = await repo.create({
    appId: input.appId,
    postId: input.postId,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    asset: input.asset,
    amount: input.amount,
    invoice: invoice.invoice,
  });
  await appendTipTimelineEvent(eventRepo, {
    tipIntentId: tipIntent.id,
    invoice: tipIntent.invoice,
    source: "TIP_CREATE",
    type: "TIP_CREATED",
    previousInvoiceState: null,
    nextInvoiceState: tipIntent.invoiceState,
    metadata: {
      appId: tipIntent.appId,
      postId: tipIntent.postId,
    },
  });
  return { invoice: invoice.invoice };
}

export async function handleTipStatus(
  input: HandleTipStatusInput,
  options: HandleTipStatusOptions = {},
) {
  const tipIntentRepo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  const eventRepo = options.tipIntentEventRepo ?? getDefaultTipIntentEventRepo();
  const adapter = options.adapter ?? getDefaultAdapter();
  const tipIntent = await tipIntentRepo.findByInvoiceOrThrow(input.invoice);

  if (tipIntent.invoiceState !== "UNPAID") {
    await appendTipTimelineEvent(eventRepo, {
      tipIntentId: tipIntent.id,
      invoice: tipIntent.invoice,
      source: "TIP_STATUS",
      type: statusStateToTimelineType(tipIntent.invoiceState),
      previousInvoiceState: tipIntent.invoiceState,
      nextInvoiceState: tipIntent.invoiceState,
      metadata: {
        observedState: tipIntent.invoiceState,
        skippedUpstreamCheck: true,
      },
    });
    return { state: tipIntent.invoiceState };
  }

  const invoiceStatus = await adapter.getInvoiceStatus({ invoice: input.invoice });
  if (invoiceStatus.state === "SETTLED") {
    await ledgerRepo.creditOnce({
      appId: tipIntent.appId,
      userId: tipIntent.toUserId,
      asset: tipIntent.asset,
      amount: tipIntent.amount,
      refId: tipIntent.id,
      idempotencyKey: `settlement:tip_intent:${tipIntent.id}`,
    });
    let nextState: InvoiceState;
    try {
      const settled = await tipIntentRepo.updateInvoiceState(input.invoice, "SETTLED");
      nextState = settled.invoiceState;
    } catch (error) {
      if (isInvoiceStateConflictError(error)) {
        const current = await tipIntentRepo.findByInvoiceOrThrow(input.invoice);
        nextState = current.invoiceState;
      } else {
        throw error;
      }
    }
    await appendTipTimelineEvent(eventRepo, {
      tipIntentId: tipIntent.id,
      invoice: tipIntent.invoice,
      source: "TIP_STATUS",
      type: statusStateToTimelineType(nextState),
      previousInvoiceState: tipIntent.invoiceState,
      nextInvoiceState: nextState,
      metadata: {
        observedState: "SETTLED",
      },
    });
    return { state: nextState };
  }

  if (invoiceStatus.state === "FAILED") {
    let nextState: InvoiceState;
    try {
      const failed = await tipIntentRepo.updateInvoiceState(input.invoice, "FAILED");
      nextState = failed.invoiceState;
    } catch (error) {
      if (isInvoiceStateConflictError(error)) {
        const current = await tipIntentRepo.findByInvoiceOrThrow(input.invoice);
        nextState = current.invoiceState;
      } else {
        throw error;
      }
    }
    await appendTipTimelineEvent(eventRepo, {
      tipIntentId: tipIntent.id,
      invoice: tipIntent.invoice,
      source: "TIP_STATUS",
      type: statusStateToTimelineType(nextState),
      previousInvoiceState: tipIntent.invoiceState,
      nextInvoiceState: nextState,
      metadata: {
        observedState: "FAILED",
      },
    });
    return { state: nextState };
  }

  await appendTipTimelineEvent(eventRepo, {
    tipIntentId: tipIntent.id,
    invoice: tipIntent.invoice,
    source: "TIP_STATUS",
    type: "TIP_STATUS_UNPAID_OBSERVED",
    previousInvoiceState: tipIntent.invoiceState,
    nextInvoiceState: tipIntent.invoiceState,
    metadata: {
      observedState: "UNPAID",
    },
  });
  return { state: tipIntent.invoiceState };
}
