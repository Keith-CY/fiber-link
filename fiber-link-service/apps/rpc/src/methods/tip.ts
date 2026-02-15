import { createAdapter } from "@fiber-link/fiber-adapter";
import { createDbClient, createDbTipIntentRepo, type TipIntentRepo } from "@fiber-link/db";
import type { InvoiceState } from "@fiber-link/fiber-adapter";

let defaultTipIntentRepo: TipIntentRepo | null | undefined;
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

function getDefaultAdapter() {
  if (defaultAdapter !== undefined) {
    if (!defaultAdapter) {
      throw new Error("Fiber adapter is not available (FIBER_RPC_URL missing).");
    }
    return defaultAdapter;
  }

  const fiberRpcUrl = process.env.FIBER_RPC_URL;
  if (!fiberRpcUrl) {
    defaultAdapter = null;
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
  adapter?: {
    getInvoiceStatus: (input: { invoice: string }) => Promise<{ state: InvoiceState }>;
  };
};

export async function handleTipCreate(
  input: HandleTipCreateInput,
  options: { tipIntentRepo?: TipIntentRepo } = {},
) {
  const fiberRpcUrl = process.env.FIBER_RPC_URL;
  if (!fiberRpcUrl) {
    throw new Error("FIBER_RPC_URL environment variable is not set.");
  }
  const adapter = createAdapter({ endpoint: fiberRpcUrl });
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
  const adapter = options.adapter ?? getDefaultAdapter();
  const tipIntent = await tipIntentRepo.findByInvoiceOrThrow(input.invoice);

  if (tipIntent.invoiceState !== "UNPAID") {
    return { state: tipIntent.invoiceState };
  }

  const invoiceStatus = await adapter.getInvoiceStatus({ invoice: input.invoice });
  if (invoiceStatus.state === "SETTLED") {
    const settled = await tipIntentRepo.updateInvoiceState(input.invoice, "SETTLED");
    return { state: settled.invoiceState };
  }

  if (invoiceStatus.state === "FAILED") {
    const failed = await tipIntentRepo.updateInvoiceState(input.invoice, "FAILED");
    return { state: failed.invoiceState };
  }

  return { state: tipIntent.invoiceState };
}
