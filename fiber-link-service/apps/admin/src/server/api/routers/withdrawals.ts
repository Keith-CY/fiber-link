import type { WithdrawalState } from "@fiber-link/db";
import { TRPCError } from "@trpc/server";
import { WITHDRAWAL_STATE_ORDER } from "../../../dashboard/dashboard-page-model";
import type { AdminWithdrawalFilters } from "../../services/types";
import { ADMIN_LIST_MAX_LIMIT, decodeLedgerCursor } from "../../services/types";
import { adminProcedure, router } from "../trpc";

const ASSETS = new Set(["CKB", "USDI"]);

function optionalTrimmed(raw: Record<string, unknown>, key: string): string | undefined {
  const value = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  return value ? value : undefined;
}

function optionalIsoTimestamp(raw: Record<string, unknown>, key: string): string | undefined {
  const value = optionalTrimmed(raw, key);
  if (value === undefined) {
    return undefined;
  }
  if (Number.isNaN(new Date(value).getTime())) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${key} must be an ISO timestamp` });
  }
  return value;
}

function parseWithdrawalFilters(input: unknown): AdminWithdrawalFilters {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid withdrawal filters" });
  }

  const raw = input as Record<string, unknown>;
  const filters: AdminWithdrawalFilters = {};

  filters.appId = optionalTrimmed(raw, "appId");
  filters.userId = optionalTrimmed(raw, "userId");
  filters.id = optionalTrimmed(raw, "id");
  filters.txHash = optionalTrimmed(raw, "txHash");
  filters.createdFrom = optionalIsoTimestamp(raw, "createdFrom");
  filters.createdTo = optionalIsoTimestamp(raw, "createdTo");

  const state = optionalTrimmed(raw, "state");
  if (state) {
    if (!WITHDRAWAL_STATE_ORDER.includes(state as WithdrawalState)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `unknown withdrawal state: ${state}` });
    }
    filters.state = state as WithdrawalState;
  }
  const asset = optionalTrimmed(raw, "asset");
  if (asset) {
    if (!ASSETS.has(asset)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `unknown asset: ${asset}` });
    }
    filters.asset = asset as "CKB" | "USDI";
  }
  if (raw.limit !== undefined) {
    const limit = Number(raw.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > ADMIN_LIST_MAX_LIMIT) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `limit must be an integer in [1, ${ADMIN_LIST_MAX_LIMIT}]`,
      });
    }
    filters.limit = limit;
  }
  const cursor = optionalTrimmed(raw, "cursor");
  if (cursor) {
    const after = decodeLedgerCursor(cursor);
    if (!after) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalid cursor" });
    }
    filters.after = after;
  }
  return filters;
}

export const withdrawalsRouter = router({
  /** Newest-first page with keyset cursor; exact search by id/txHash/user. */
  list: adminProcedure.input(parseWithdrawalFilters).query(async ({ ctx, input }) => {
    return ctx.services.listWithdrawals(ctx.scope, input);
  }),

  /** Per-state counts over the whole scope; the list itself is paged. */
  stateSummary: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.summarizeWithdrawals(ctx.scope);
  }),
});
