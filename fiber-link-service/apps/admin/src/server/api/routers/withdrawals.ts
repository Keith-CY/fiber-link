import type { WithdrawalState } from "@fiber-link/db";
import { TRPCError } from "@trpc/server";
import { WITHDRAWAL_STATE_ORDER } from "../../../dashboard/dashboard-page-model";
import type { AdminWithdrawalFilters } from "../../services/types";
import { adminProcedure, router } from "../trpc";

function parseWithdrawalFilters(input: unknown): AdminWithdrawalFilters {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid withdrawal filters" });
  }

  const raw = input as Record<string, unknown>;
  const filters: AdminWithdrawalFilters = {};

  if (typeof raw.appId === "string" && raw.appId.trim()) {
    filters.appId = raw.appId.trim();
  }
  if (typeof raw.state === "string" && raw.state.trim()) {
    const state = raw.state.trim();
    if (!WITHDRAWAL_STATE_ORDER.includes(state as WithdrawalState)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `unknown withdrawal state: ${state}` });
    }
    filters.state = state as WithdrawalState;
  }
  return filters;
}

export const withdrawalsRouter = router({
  list: adminProcedure.input(parseWithdrawalFilters).query(async ({ ctx, input }) => {
    return ctx.services.listWithdrawals(ctx.scope, input);
  }),

  /** Per-state counts over the whole scope; the list itself is capped. */
  stateSummary: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.summarizeWithdrawals(ctx.scope);
  }),
});
