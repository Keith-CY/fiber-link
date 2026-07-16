import type { InvoiceState } from "@fiber-link/db";
import { TRPCError } from "@trpc/server";
import { SettlementNotFoundError, SettlementRetryStateError } from "../../services/errors";
import type { AdminSettlementFilters } from "../../services/types";
import { recordAuditEvent, router, superAdminProcedure } from "../trpc";

const INVOICE_STATES: readonly InvoiceState[] = ["UNPAID", "SETTLED", "FAILED"];

/** Fiber invoices are long bech32-ish strings, but bounded; reject junk early. */
const INVOICE_MAX_LENGTH = 4096;
const OPS_NOTE_MAX_LENGTH = 2000;

function parseSettlementFilters(input: unknown): AdminSettlementFilters {
  if (input === undefined || input === null) {
    return {};
  }
  if (typeof input !== "object") {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid settlement filters" });
  }

  const raw = input as Record<string, unknown>;
  const filters: AdminSettlementFilters = {};

  if (typeof raw.appId === "string" && raw.appId.trim()) {
    filters.appId = raw.appId.trim();
  }
  if (typeof raw.state === "string" && raw.state.trim()) {
    const state = raw.state.trim();
    if (!INVOICE_STATES.includes(state as InvoiceState)) {
      throw new TRPCError({ code: "BAD_REQUEST", message: `unknown settlement state: ${state}` });
    }
    filters.state = state as InvoiceState;
  }
  return filters;
}

function parseInvoice(input: unknown): { invoice: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const invoice = typeof raw.invoice === "string" ? raw.invoice.trim() : "";
  if (!invoice || invoice.length > INVOICE_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invoice is required" });
  }
  return { invoice };
}

function parseOpsNote(input: unknown): { invoice: string; note: string } {
  const { invoice } = parseInvoice(input);
  const raw = input as Record<string, unknown>;
  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  if (!note) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "note is required" });
  }
  if (note.length > OPS_NOTE_MAX_LENGTH) {
    throw new TRPCError({ code: "BAD_REQUEST", message: `note exceeds ${OPS_NOTE_MAX_LENGTH} characters` });
  }
  return { invoice, note };
}

function mapSettlementError(error: unknown): never {
  if (error instanceof SettlementNotFoundError) {
    throw new TRPCError({ code: "NOT_FOUND", message: error.message });
  }
  if (error instanceof SettlementRetryStateError) {
    throw new TRPCError({ code: "PRECONDITION_FAILED", message: error.message });
  }
  throw error;
}

export const settlementsRouter = router({
  list: superAdminProcedure.input(parseSettlementFilters).query(async ({ ctx, input }) => {
    return ctx.services.listSettlements(ctx.scope, input);
  }),

  timeline: superAdminProcedure.input(parseInvoice).query(async ({ ctx, input }) => {
    try {
      return await ctx.services.getSettlementTimeline(ctx.scope, input.invoice);
    } catch (error) {
      mapSettlementError(error);
    }
  }),

  retryNow: superAdminProcedure.input(parseInvoice).mutation(async ({ ctx, input }) => {
    try {
      const intent = await ctx.services.retrySettlementNow(ctx.scope, input.invoice);
      await recordAuditEvent(ctx, ctx.scope, {
        action: "settlement.retry_now",
        targetType: "tip_intent",
        targetId: input.invoice,
        after: {
          invoiceState: intent.invoiceState,
          settlementRetryCount: intent.settlementRetryCount,
          settlementNextRetryAt: intent.settlementNextRetryAt,
        },
      });
      return intent;
    } catch (error) {
      mapSettlementError(error);
    }
  }),

  addOpsNote: superAdminProcedure.input(parseOpsNote).mutation(async ({ ctx, input }) => {
    try {
      // Resolve first so notes cannot be attached to unknown/out-of-scope
      // invoices, and so a failed lookup is NOT_FOUND rather than a silent write.
      await ctx.services.getSettlementTimeline(ctx.scope, input.invoice);
    } catch (error) {
      mapSettlementError(error);
    }
    await recordAuditEvent(ctx, ctx.scope, {
      action: "settlement.ops_note.add",
      targetType: "tip_intent",
      targetId: input.invoice,
      reason: input.note,
    });
    return { ok: true as const };
  }),
});
