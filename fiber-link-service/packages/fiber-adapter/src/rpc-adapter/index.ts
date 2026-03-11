import { createInvoice, getInvoiceStatus } from "./invoice-ops";
import { executeWithdrawal } from "./withdrawal-ops";
import {
  listChannels,
  openChannel,
  acceptChannel,
  getCkbChannelAcceptancePolicy,
  shutdownChannel,
  getLiquidityCapabilities,
} from "./channel-ops";
import { ensureChainLiquidity, getRebalanceStatus } from "./rebalance-ops";
import { createSettlementSubscriber } from "./settlement-stream";
import type { CreateAdapterArgs, FiberAdapter } from "../types";

export function createAdapter({ endpoint, settlementSubscription, fetchFn }: CreateAdapterArgs): FiberAdapter {
  const resolvedFetch = fetchFn ?? fetch;
  const subscribeSettlements = createSettlementSubscriber(settlementSubscription, resolvedFetch);

  return {
    createInvoice: (args) => createInvoice(endpoint, args),
    getInvoiceStatus: (args) => getInvoiceStatus(endpoint, args),
    subscribeSettlements,
    executeWithdrawal: (args) => executeWithdrawal(endpoint, args),
    getLiquidityCapabilities: () => getLiquidityCapabilities(endpoint),
    listChannels: (args) => listChannels(endpoint, args),
    openChannel: (args) => openChannel(endpoint, args),
    acceptChannel: (args) => acceptChannel(endpoint, args),
    getCkbChannelAcceptancePolicy: () => getCkbChannelAcceptancePolicy(endpoint),
    shutdownChannel: (args) => shutdownChannel(endpoint, args),
    ensureChainLiquidity: (args) => ensureChainLiquidity(endpoint, args),
    getRebalanceStatus: (args) => getRebalanceStatus(endpoint, args),
  };
}
