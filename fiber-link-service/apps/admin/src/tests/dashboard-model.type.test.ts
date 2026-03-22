import { describe, expect, expectTypeOf, it } from "vitest";
import { appRouter } from "../server/api/routers/app";
import { withdrawalRouter } from "../server/api/routers/withdrawal";
import { WITHDRAWAL_STATE_ORDER, type DashboardApp, type DashboardWithdrawal } from "../dashboard/dashboard-model";

type AppListOutput = Awaited<ReturnType<ReturnType<typeof appRouter.createCaller>["list"]>>;
type WithdrawalListOutput = Awaited<ReturnType<ReturnType<typeof withdrawalRouter.createCaller>["list"]>>;

describe("dashboard-model type alignment", () => {
  it("keeps dashboard app type aligned to router output", () => {
    expectTypeOf<DashboardApp>().toEqualTypeOf<AppListOutput[number]>();
  });

  it("keeps dashboard withdrawal type aligned to router output", () => {
    expectTypeOf<DashboardWithdrawal>().toEqualTypeOf<WithdrawalListOutput[number]>();
  });

  it("includes LIQUIDITY_PENDING in withdrawal ordering", () => {
    expect(WITHDRAWAL_STATE_ORDER).toContain("LIQUIDITY_PENDING");
  });
});
