import { createAdapter } from "./rpc-adapter";
import { createSimulationAdapter, type CreateSimulationAdapterArgs } from "./simulation-adapter";
import type { CreateAdapterArgs, FiberAdapter } from "./types";

export type AdapterProviderMode = "rpc" | "simulation";

export type CreateAdapterProviderArgs = {
  mode?: AdapterProviderMode | string;
  endpoint?: string;
  settlementSubscription?: CreateAdapterArgs["settlementSubscription"];
  fetchFn?: CreateAdapterArgs["fetchFn"];
  simulation?: CreateSimulationAdapterArgs;
  rpcFactory?: (args: CreateAdapterArgs) => FiberAdapter;
  env?: NodeJS.ProcessEnv;
};

function parseBoolean(value: string | undefined): boolean {
  if (!value) {
    return false;
  }
  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function parseMode(raw: string | undefined): AdapterProviderMode {
  const normalized = (raw ?? "rpc").trim().toLowerCase();
  if (normalized === "rpc") {
    return "rpc";
  }
  if (normalized === "simulation") {
    return "simulation";
  }

  throw new Error(`Invalid FIBER_ADAPTER_MODE '${raw}'. Expected one of: rpc, simulation.`);
}

function isProductionLikeEnvironment(env: NodeJS.ProcessEnv): boolean {
  const candidates = [env.NODE_ENV, env.APP_ENV, env.ENVIRONMENT];
  return candidates.some((value) => {
    const normalized = (value ?? "").trim().toLowerCase();
    return normalized === "production" || normalized === "prod";
  });
}

function assertSimulationGuardrails(env: NodeJS.ProcessEnv) {
  if (!isProductionLikeEnvironment(env)) {
    return;
  }

  const allowInProduction = parseBoolean(env.FIBER_SIMULATION_ALLOW_IN_PRODUCTION);
  if (allowInProduction) {
    return;
  }

  throw new Error(
    "Simulation adapter is blocked in production-like environments. Set FIBER_SIMULATION_ALLOW_IN_PRODUCTION=true to override intentionally.",
  );
}

export function createAdapterProvider(args: CreateAdapterProviderArgs = {}): FiberAdapter {
  const env = args.env ?? process.env;
  const mode = parseMode(args.mode ?? env.FIBER_ADAPTER_MODE);

  if (mode === "simulation") {
    assertSimulationGuardrails(env);
    return createSimulationAdapter({
      ...args.simulation,
      env,
    });
  }

  const endpoint = (args.endpoint ?? env.FIBER_RPC_URL ?? "").trim();
  if (!endpoint) {
    throw new Error("FIBER_RPC_URL environment variable is not set.");
  }

  const rpcFactory = args.rpcFactory ?? createAdapter;
  return rpcFactory({
    endpoint,
    settlementSubscription: args.settlementSubscription,
    fetchFn: args.fetchFn,
  });
}
