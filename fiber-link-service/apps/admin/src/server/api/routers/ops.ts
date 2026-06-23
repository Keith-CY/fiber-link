import { TRPCError } from "@trpc/server";
import { router, superAdminProcedure } from "../trpc";
import type { DashboardRateLimitDraft } from "../../dashboard-rate-limit";

function parseRateLimitDraft(input: unknown): DashboardRateLimitDraft {
  if (typeof input !== "object" || input === null) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "invalid rate-limit input" });
  }
  const raw = input as Record<string, unknown>;
  return {
    enabled: Boolean(raw.enabled),
    windowMs: typeof raw.windowMs === "string" ? raw.windowMs : String(raw.windowMs ?? ""),
    maxRequests: typeof raw.maxRequests === "string" ? raw.maxRequests : String(raw.maxRequests ?? ""),
  };
}

function parseBackupId(input: unknown): { backupId: string } {
  const raw = (typeof input === "object" && input !== null ? input : {}) as Record<string, unknown>;
  const backupId = typeof raw.backupId === "string" ? raw.backupId.trim() : "";
  if (!backupId) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "backupId is required" });
  }
  return { backupId };
}

function toServiceError(error: unknown, fallback: string): TRPCError {
  return new TRPCError({
    code: "INTERNAL_SERVER_ERROR",
    message: error instanceof Error && error.message ? error.message : fallback,
  });
}

export const opsRouter = router({
  monitoring: superAdminProcedure.query(async ({ ctx }) => {
    return ctx.services.loadMonitoringSummary();
  }),

  rateLimitConfig: superAdminProcedure.query(async ({ ctx }) => {
    return ctx.services.loadRateLimitConfig();
  }),

  createRateLimitChangeSet: superAdminProcedure
    .input(parseRateLimitDraft)
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.services.createRateLimitChangeSet(input);
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : "failed to build rate-limit change set",
        });
      }
    }),

  listBackups: superAdminProcedure.query(async ({ ctx }) => {
    return ctx.services.listBackupBundles();
  }),

  captureBackup: superAdminProcedure.mutation(async ({ ctx }) => {
    try {
      return await ctx.services.captureBackup();
    } catch (error) {
      throw toServiceError(error, "Failed to capture backup");
    }
  }),

  restorePlan: superAdminProcedure.input(parseBackupId).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.services.buildBackupRestorePlan(input.backupId);
    } catch (error) {
      throw toServiceError(error, "Failed to generate restore plan");
    }
  }),
});
