import { createAdapter } from "@fiber-link/fiber-adapter";

export async function handleTipCreate(input: {
  appId: string;
  postId: string;
  fromUserId: string;
  toUserId: string;
  asset: "CKB" | "USDI";
  amount: string;
}) {
  const adapter = createAdapter({ endpoint: process.env.FIBER_RPC_URL ?? "" });
  const invoice = await adapter.createInvoice({ amount: input.amount, asset: input.asset });
  return { invoice: invoice.invoice };
}
