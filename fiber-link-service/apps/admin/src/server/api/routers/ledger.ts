import { TRPCError } from "@trpc/server";
import type { AdminLedgerFilters, AdminLedgerReconcileParams } from "../../services/types";
import { LEDGER_PAGE_MAX_LIMIT, decodeLedgerCursor } from "../../services/types";
import { router, superAdminProcedure } from "../trpc";

const ASSETS = new Set(["CKB", "USDI"]);
const ENTRY_TYPES = new Set(["credit", "debit"]);

function requireString(raw: Record<string, unknown>, key: string): string {
  const value = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  if (!value) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `${key} is required` });
  }
  return value;
}

function optionalEnum(raw: Record<string, unknown>, key: string, allowed: Set<string>): string | undefined {
  const value = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
  if (!value) {
    return undefined;
  }
  if (!allowed.has(value)) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `unknown ${key}: ${value}` });
  }
  return value;
}

function asRecord(input: unknown): Record<string, unknown> {
  if (typeof input !== "object" || input === null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid ledger input" });
  }
  return input as Record<string, unknown>;
}

function parseEntriesInput(input: unknown): AdminLedgerFilters {
  const raw = asRecord(input);
  const filters: AdminLedgerFilters = { appId: requireString(raw, "appId") };

  if (typeof raw.userId === "string" && raw.userId.trim()) {
    filters.userId = raw.userId.trim();
  }
  const asset = optionalEnum(raw, "asset", ASSETS);
  if (asset) {
    filters.asset = asset as "CKB" | "USDI";
  }
  const type = optionalEnum(raw, "type", ENTRY_TYPES);
  if (type) {
    filters.type = type as "credit" | "debit";
  }
  if (raw.limit !== undefined) {
    const limit = Number(raw.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > LEDGER_PAGE_MAX_LIMIT) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: `limit must be an integer in [1, ${LEDGER_PAGE_MAX_LIMIT}]`,
      });
    }
    filters.limit = limit;
  }
  if (typeof raw.cursor === "string" && raw.cursor.trim()) {
    const after = decodeLedgerCursor(raw.cursor.trim());
    if (!after) {
      throw new TRPCError({ code: "BAD_REQUEST", message: "invalid cursor" });
    }
    filters.after = after;
  }
  return filters;
}

function parseBreakdownInput(input: unknown): { appId: string; userId: string; asset: "CKB" | "USDI" } {
  const raw = asRecord(input);
  const asset = optionalEnum(raw, "asset", ASSETS);
  if (!asset) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "asset is required" });
  }
  return {
    appId: requireString(raw, "appId"),
    userId: requireString(raw, "userId"),
    asset: asset as "CKB" | "USDI",
  };
}

function parseReconcileInput(input: unknown): AdminLedgerReconcileParams {
  if (input === undefined || input === null) {
    return {};
  }
  const raw = asRecord(input);
  const params: AdminLedgerReconcileParams = {};

  if (typeof raw.appId === "string" && raw.appId.trim()) {
    params.appId = raw.appId.trim();
  }
  for (const key of ["from", "to"] as const) {
    const value = typeof raw[key] === "string" ? (raw[key] as string).trim() : "";
    if (!value) {
      continue;
    }
    if (Number.isNaN(new Date(value).getTime())) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `${key} must be an ISO timestamp` });
    }
    params[key] = value;
  }
  if (params.from && params.to && new Date(params.from).getTime() > new Date(params.to).getTime()) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "from must not be after to" });
  }
  return params;
}

export const ledgerRouter = router({
  /** Paginated ledger statement for one app account. */
  entries: superAdminProcedure.input(parseEntriesInput).query(async ({ ctx, input }) => {
    return ctx.services.listLedgerEntries(ctx.scope, input);
  }),

  /** Explain a balance from its source credits/debits. */
  balanceBreakdown: superAdminProcedure.input(parseBreakdownInput).query(async ({ ctx, input }) => {
    return ctx.services.getLedgerBalanceBreakdown(ctx.scope, input);
  }),

  /** Cross-check tips/withdrawals against ledger entries inside a window. */
  reconcile: superAdminProcedure.input(parseReconcileInput).query(async ({ ctx, input }) => {
    return ctx.services.reconcileLedger(ctx.scope, input);
  }),
});
