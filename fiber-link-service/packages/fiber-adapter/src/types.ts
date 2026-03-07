export type Asset = "CKB" | "USDI";
export type CkbNetwork = "AGGRON4" | "LINA";

export type CreateInvoiceArgs = { amount: string; asset: Asset };
export type InvoiceState = "UNPAID" | "SETTLED" | "FAILED";
export type WithdrawalExecutionKind = "transient" | "permanent";

export type WithdrawalDestination =
  | { kind: "CKB_ADDRESS"; address: string }
  | { kind: "PAYMENT_REQUEST"; paymentRequest: string };

export type ExecuteWithdrawalArgs = {
  amount: string;
  asset: Asset;
  destination: WithdrawalDestination;
  requestId: string;
};

export type SubscribeSettlementsArgs = {
  onSettled: (invoice: string) => void | Promise<void>;
  onError?: (error: unknown) => void;
};

export type SettlementSubscriptionHandle = {
  close: () => void | Promise<void>;
};

export type SettlementSubscriptionConfig = {
  enabled?: boolean;
  url?: string;
  reconnectDelayMs?: number;
  authToken?: string;
};

export type CreateAdapterArgs = {
  endpoint: string;
  settlementSubscription?: SettlementSubscriptionConfig;
  fetchFn?: typeof fetch;
};

export type GetHotWalletInventoryArgs = {
  asset: Asset;
  network: CkbNetwork;
};

export type CkbHotWalletInventory = {
  asset: "CKB";
  network: CkbNetwork;
  availableAmount: string;
};

export type UsdiHotWalletInventory = {
  asset: "USDI";
  network: CkbNetwork;
  availableAmount: string;
  supportingCkbAmount: string;
};

export type HotWalletInventory = CkbHotWalletInventory | UsdiHotWalletInventory;
export type HotWalletInventoryProvider = (args: GetHotWalletInventoryArgs) => Promise<HotWalletInventory>;

export type FiberAdapter = {
  createInvoice: (args: CreateInvoiceArgs) => Promise<{ invoice: string }>;
  getInvoiceStatus: (args: { invoice: string }) => Promise<{ state: InvoiceState }>;
  subscribeSettlements: (args: SubscribeSettlementsArgs) => Promise<SettlementSubscriptionHandle>;
  executeWithdrawal: (args: ExecuteWithdrawalArgs) => Promise<{ txHash: string }>;
};
