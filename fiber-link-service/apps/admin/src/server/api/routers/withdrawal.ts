import { TRPCError } from "@trpc/server";
import { requireRole } from "../../auth/roles";
import { t } from "../trpc";

export const withdrawalRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    requireRole(["SUPER_ADMIN", "COMMUNITY_ADMIN"], ctx.role);
    if (!ctx.db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not configured" });
    }

    const columns = {
      id: true,
      appId: true,
      userId: true,
      asset: true,
      amount: true,
      toAddress: true,
      state: true,
      retryCount: true,
      nextRetryAt: true,
      lastError: true,
      createdAt: true,
      updatedAt: true,
      completedAt: true,
    } as const;

    if (ctx.role === "SUPER_ADMIN") {
      return ctx.db.query.withdrawals.findMany({ columns });
    }

    if (!ctx.adminUserId) {
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: "Admin identity not configured",
      });
    }

    const memberships = await ctx.db.query.appAdmins.findMany({
      columns: { appId: true },
      where: (a, { eq }) => eq(a.adminUserId, ctx.adminUserId),
    });
    const appIds = memberships.map((m) => m.appId);
    if (appIds.length === 0) {
      return [];
    }

    return ctx.db.query.withdrawals.findMany({
      columns,
      where: (w, { inArray }) => inArray(w.appId, appIds),
    });
  }),
});
