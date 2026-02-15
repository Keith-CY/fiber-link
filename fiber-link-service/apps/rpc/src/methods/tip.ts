import { createAdapter } from "@fiber-link/fiber-adapter";
import {
  createDbClient,
  createDbLedgerRepo,
  createDbTipIntentRepo,
  InvoiceStateTransitionError,
  type LedgerRepo,
  type TipIntentRepo,
} from "@fiber-link/db";
import type { InvoiceState } from "@fiber-link/fiber-adapter";

let defaultTipIntentRepo: TipIntentRepo | null | undefined;
let defaultLedgerRepo: LedgerRepo | null | undefined;
let defaultAdapter: ReturnType<typeof createAdapter> | null | undefined;

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

function getDefaultAdapter() {
  if (defaultAdapter !== undefined) {
    return defaultAdapter;
  }

  const fiberRpcUrl = process.env.FIBER_RPC_URL;
  if (!fiberRpcUrl) {
    throw new Error("FIBER_RPC_URL environment variable is not set.");
  }
  defaultAdapter = createAdapter({ endpoint: fiberRpcUrl });
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
  adapter?: {
    getInvoiceStatus: (input: { invoice: string }) => Promise<{ state: InvoiceState }>;
  };
};

type HandleTipCreateOptions = {
  tipIntentRepo?: TipIntentRepo;
  adapter?: {
    createInvoice: (input: { amount: string; asset: "CKB" | "USDI" }) => Promise<{ invoice: string }>;
  };
};

export async function handleTipCreate(
  input: HandleTipCreateInput,
  options: HandleTipCreateOptions = {},
) {
  let adapter = options.adapter;
  if (!adapter) {
    const fiberRpcUrl = process.env.FIBER_RPC_URL;
    if (!fiberRpcUrl) {
      throw new Error("FIBER_RPC_URL environment variable is not set.");
    }
    adapter = createAdapter({ endpoint: fiberRpcUrl });
  }
  const invoice = await adapter.createInvoice({ amount: input.amount, asset: input.asset });
  const repo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  await repo.create({
    appId: input.appId,
    postId: input.postId,
    fromUserId: input.fromUserId,
    toUserId: input.toUserId,
    asset: input.asset,
    amount: input.amount,
    invoice: invoice.invoice,
  });
  return { invoice: invoice.invoice };
}

export async function handleTipStatus(
  input: HandleTipStatusInput,
  options: HandleTipStatusOptions = {},
) {
  const tipIntentRepo = options.tipIntentRepo ?? getDefaultTipIntentRepo();
  const ledgerRepo = options.ledgerRepo ?? getDefaultLedgerRepo();
  const adapter = options.adapter ?? getDefaultAdapter();
  const tipIntent = await tipIntentRepo.findByInvoiceOrThrow(input.invoice);

  if (tipIntent.invoiceState !== "UNPAID") {
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
    try {
      const settled = await tipIntentRepo.updateInvoiceState(input.invoice, "SETTLED");
      return { state: settled.invoiceState };
    } catch (error) {
      if (error instanceof InvoiceStateTransitionError) {
        const current = await tipIntentRepo.findByInvoiceOrThrow(input.invoice);
        return { state: current.invoiceState };
      }
      throw error;
    }
  }

  if (invoiceStatus.state === "FAILED") {
    try {
      const failed = await tipIntentRepo.updateInvoiceState(input.invoice, "FAILED");
      return { state: failed.invoiceState };
    } catch (error) {
      if (error instanceof InvoiceStateTransitionError) {
        const current = await tipIntentRepo.findByInvoiceOrThrow(input.invoice);
        return { state: current.invoiceState };
      }
      throw error;
    }
  }

  return { state: tipIntent.invoiceState };
}
