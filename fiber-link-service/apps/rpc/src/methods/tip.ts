import { createAdapter } from "@fiber-link/fiber-adapter";
import { createDbClient, createDbTipIntentRepo, type TipIntentRepo } from "@fiber-link/db";

let defaultTipIntentRepo: TipIntentRepo | null | undefined;

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

export type HandleTipCreateInput = {
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: "CKB" | "USDI";
  amount: string;
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
