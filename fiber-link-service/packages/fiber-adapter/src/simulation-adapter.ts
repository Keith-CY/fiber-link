import { createHash } from "node:crypto";
import { resolveSimulationScenario, type SimulationScenario } from "./simulation-scenarios";
import type {
  CreateInvoiceArgs,
  ExecuteWithdrawalArgs,
  FiberAdapter,
  InvoiceState,
  SettlementSubscriptionHandle,
  SubscribeSettlementsArgs,
} from "./types";

export type CreateSimulationAdapterArgs = {
  scenario?: string;
  seed?: string;
  env?: NodeJS.ProcessEnv;
};

type SimulatedInvoice = {
  pollCount: number;
  amount: string;
  asset: CreateInvoiceArgs["asset"];
};

function stableHex(input: string, length: number): string {
  return createHash("sha256").update(input).digest("hex").slice(0, length);
}

function resolveSeed(seed: string | undefined): string {
  const trimmed = seed?.trim();
  return trimmed || "fiber-link-simulation-seed";
}

function resolveInvoiceState(record: SimulatedInvoice, scenario: SimulationScenario): InvoiceState {
  if (scenario.invoiceLifecycle.kind === "always") {
    return scenario.invoiceLifecycle.state;
  }

  if (record.pollCount > scenario.invoiceLifecycle.settleAfterPolls) {
    return "SETTLED";
  }
  return "UNPAID";
}

function makeInvoiceId(params: {
  seed: string;
  scenarioName: string;
  index: number;
  amount: string;
  asset: CreateInvoiceArgs["asset"];
}): string {
  const suffix = stableHex(
    `${params.seed}|invoice|${params.scenarioName}|${params.index}|${params.amount}|${params.asset}`,
    16,
  );
  return `sim:${params.scenarioName}:${params.asset}:${params.amount}:${suffix}`;
}

function makeWithdrawalTxHash(params: {
  seed: string;
  scenarioName: string;
  amount: string;
  asset: ExecuteWithdrawalArgs["asset"];
  destination: ExecuteWithdrawalArgs["destination"];
  requestId: string;
}): string {
  const destinationTag =
    params.destination.kind === "CKB_ADDRESS"
      ? `ckb:${params.destination.address}`
      : `payment:${params.destination.paymentRequest}`;
  return `0x${stableHex(
    `${params.seed}|withdrawal|${params.scenarioName}|${params.amount}|${params.asset}|${destinationTag}|${params.requestId}`,
    64,
  )}`;
}

export function createSimulationAdapter(args: CreateSimulationAdapterArgs = {}): FiberAdapter {
  const env = args.env ?? process.env;
  const scenario = resolveSimulationScenario(args.scenario ?? env.FIBER_SIMULATION_SCENARIO);
  const seed = resolveSeed(args.seed ?? env.FIBER_SIMULATION_SEED);

  let invoiceIndex = 0;
  const invoices = new Map<string, SimulatedInvoice>();

  function getOrCreateInvoiceState(invoice: string): SimulatedInvoice {
    const existing = invoices.get(invoice);
    if (existing) {
      return existing;
    }

    const synthetic: SimulatedInvoice = {
      pollCount: 0,
      amount: "0",
      asset: "USDI",
    };
    invoices.set(invoice, synthetic);
    return synthetic;
  }

  async function subscribeSettlements(_: SubscribeSettlementsArgs): Promise<SettlementSubscriptionHandle> {
    return {
      close() {
        return undefined;
      },
    };
  }

  return {
    async createInvoice({ amount, asset }: CreateInvoiceArgs) {
      invoiceIndex += 1;
      const invoice = makeInvoiceId({
        seed,
        scenarioName: scenario.name,
        index: invoiceIndex,
        amount,
        asset,
      });
      invoices.set(invoice, {
        pollCount: 0,
        amount,
        asset,
      });
      return { invoice };
    },

    async getInvoiceStatus({ invoice }: { invoice: string }) {
      const state = getOrCreateInvoiceState(invoice);
      state.pollCount += 1;
      return { state: resolveInvoiceState(state, scenario) };
    },

    subscribeSettlements,

    async executeWithdrawal({ amount, asset, destination, requestId }: ExecuteWithdrawalArgs) {
      if (scenario.withdrawalBehavior.kind === "error") {
        throw new Error(`${scenario.withdrawalBehavior.message} (scenario=${scenario.name})`);
      }

      const resolvedRequestId = requestId?.trim() || "no-request-id";
      return {
        txHash: makeWithdrawalTxHash({
          seed,
          scenarioName: scenario.name,
          amount,
          asset,
          destination,
          requestId: resolvedRequestId,
        }),
      };
    },
  };
}
