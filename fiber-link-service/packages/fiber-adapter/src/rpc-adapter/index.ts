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

export function createAdapter({ endpoint, settlementSubscription, fetchFn, timeoutMs, retryCount, retryDelayMs, signal }: CreateAdapterArgs): FiberAdapter {
  const rpcEndpoint = { endpoint, fetchFn, timeoutMs, retryCount, retryDelayMs, signal };
  const subscribeSettlements = createSettlementSubscriber(settlementSubscription, fetchFn ?? fetch);

  return {
    createInvoice: (args) => createInvoice(rpcEndpoint, args),
    getInvoiceStatus: (args) => getInvoiceStatus(rpcEndpoint, args),
    subscribeSettlements,
    executeWithdrawal: (args) => executeWithdrawal(rpcEndpoint, args),
    getLiquidityCapabilities: () => getLiquidityCapabilities(rpcEndpoint),
    listChannels: (args) => listChannels(rpcEndpoint, args),
    openChannel: (args) => openChannel(rpcEndpoint, args),
    acceptChannel: (args) => acceptChannel(rpcEndpoint, args),
    getCkbChannelAcceptancePolicy: () => getCkbChannelAcceptancePolicy(rpcEndpoint),
    shutdownChannel: (args) => shutdownChannel(rpcEndpoint, args),
    ensureChainLiquidity: (args) => ensureChainLiquidity(rpcEndpoint, args),
    getRebalanceStatus: (args) => getRebalanceStatus(rpcEndpoint, args),
  };
}
