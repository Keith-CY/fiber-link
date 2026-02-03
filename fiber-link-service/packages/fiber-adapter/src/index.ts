export type CreateInvoiceArgs = { amount: string; asset: "CKB" | "USDI" };

export function createAdapter(_: { endpoint: string }) {
  return {
    async createInvoice({ amount, asset }: CreateInvoiceArgs) {
      return { invoice: `fiber:${asset}:${amount}:stub` };
    },
    async getInvoiceStatus(_: { invoice: string }) {
      return { state: "UNPAID" as const };
    },
    async subscribeSettlements(_: { onSettled: (invoice: string) => void }) {
      return { close: () => undefined };
    },
  };
}
