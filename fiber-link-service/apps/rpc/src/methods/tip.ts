import { createAdapter } from "@fiber-link/fiber-adapter";

export type HandleTipCreateInput = {
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: "CKB" | "USDI";
  amount: string;
};

export async function handleTipCreate(input: HandleTipCreateInput) {
  const fiberRpcUrl = process.env.FIBER_RPC_URL;
  if (!fiberRpcUrl) {
    throw new Error("FIBER_RPC_URL environment variable is not set.");
  }
  const adapter = createAdapter({ endpoint: fiberRpcUrl });
  const invoice = await adapter.createInvoice({ amount: input.amount, asset: input.asset });
  return { invoice: invoice.invoice };
}
