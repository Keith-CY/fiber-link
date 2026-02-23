import { afterEach, describe, expect, it } from "vitest";
import { createAdapterProvider } from "./provider";
import { createSimulationAdapter } from "./simulation-adapter";

const ENV_KEYS = [
  "FIBER_ADAPTER_MODE",
  "FIBER_SIMULATION_SCENARIO",
  "FIBER_SIMULATION_SEED",
  "FIBER_SIMULATION_ALLOW_IN_PRODUCTION",
  "FIBER_RPC_URL",
  "NODE_ENV",
  "APP_ENV",
  "ENVIRONMENT",
] as const;

const previousEnv: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

for (const key of ENV_KEYS) {
  previousEnv[key] = process.env[key];
}

afterEach(() => {
  for (const key of ENV_KEYS) {
    const previous = previousEnv[key];
    if (previous === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = previous;
    }
  }
});

describe("simulation adapter", () => {
  it("returns deterministic status transitions for settle-after-1-poll scenario", async () => {
    const adapter = createSimulationAdapter({
      scenario: "settle-after-1-poll",
      seed: "seed-1",
    });

    const created = await adapter.createInvoice({ amount: "10", asset: "USDI" });
    const first = await adapter.getInvoiceStatus({ invoice: created.invoice });
    const second = await adapter.getInvoiceStatus({ invoice: created.invoice });

    expect(first.state).toBe("UNPAID");
    expect(second.state).toBe("SETTLED");
  });

  it("produces deterministic withdrawal txHash across adapter instances with same seed", async () => {
    const first = createSimulationAdapter({
      scenario: "settled-immediately",
      seed: "seed-det",
    });
    const second = createSimulationAdapter({
      scenario: "settled-immediately",
      seed: "seed-det",
    });

    const input = {
      amount: "5",
      asset: "USDI" as const,
      toAddress: "sim-destination",
      requestId: "withdrawal-1",
    };

    const firstResult = await first.executeWithdrawal(input);
    const secondResult = await second.executeWithdrawal(input);

    expect(firstResult.txHash).toBe(secondResult.txHash);
    expect(firstResult.txHash).toMatch(/^0x[0-9a-f]{64}$/);
  });
});

describe("adapter provider", () => {
  it("requires RPC endpoint when provider mode resolves to rpc", () => {
    delete process.env.FIBER_ADAPTER_MODE;
    delete process.env.FIBER_RPC_URL;

    expect(() => createAdapterProvider()).toThrow("FIBER_RPC_URL environment variable is not set.");
  });

  it("selects simulation mode from environment", async () => {
    process.env.FIBER_ADAPTER_MODE = "simulation";
    process.env.FIBER_SIMULATION_SCENARIO = "always-failed";
    process.env.FIBER_SIMULATION_SEED = "env-seed";

    const adapter = createAdapterProvider();
    const created = await adapter.createInvoice({ amount: "3", asset: "CKB" });
    const status = await adapter.getInvoiceStatus({ invoice: created.invoice });

    expect(created.invoice).toContain("sim:always-failed:CKB:3:");
    expect(status.state).toBe("FAILED");
    await expect(
      adapter.executeWithdrawal({
        amount: "3",
        asset: "CKB",
        toAddress: "sim-target",
        requestId: "req-1",
      }),
    ).rejects.toThrow("simulated withdrawal rejected");
  });

  it("blocks simulation mode in production-like environments by default", () => {
    process.env.FIBER_ADAPTER_MODE = "simulation";
    process.env.NODE_ENV = "production";
    delete process.env.FIBER_SIMULATION_ALLOW_IN_PRODUCTION;

    expect(() => createAdapterProvider()).toThrow(
      "Simulation adapter is blocked in production-like environments.",
    );
  });

  it("allows simulation mode in production-like environments when explicitly overridden", async () => {
    process.env.FIBER_ADAPTER_MODE = "simulation";
    process.env.NODE_ENV = "production";
    process.env.FIBER_SIMULATION_ALLOW_IN_PRODUCTION = "true";

    const adapter = createAdapterProvider({
      simulation: {
        scenario: "settled-immediately",
        seed: "prod-override",
      },
    });

    const created = await adapter.createInvoice({ amount: "1", asset: "USDI" });
    const status = await adapter.getInvoiceStatus({ invoice: created.invoice });
    expect(status.state).toBe("SETTLED");
  });
});
