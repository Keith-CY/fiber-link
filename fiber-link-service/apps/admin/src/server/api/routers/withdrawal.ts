import { TRPCError } from "@trpc/server";
import { withdrawals } from "@fiber-link/db";
import { requireRole } from "../../auth/roles";
import { t } from "../trpc";

export const withdrawalRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    requireRole(["SUPER_ADMIN", "COMMUNITY_ADMIN"], ctx.role);
    if (!ctx.db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not configured" });
    }

    return ctx.db
      .select({
        id: withdrawals.id,
        appId: withdrawals.appId,
        userId: withdrawals.userId,
        asset: withdrawals.asset,
        amount: withdrawals.amount,
        toAddress: withdrawals.toAddress,
        state: withdrawals.state,
        retryCount: withdrawals.retryCount,
        nextRetryAt: withdrawals.nextRetryAt,
        lastError: withdrawals.lastError,
        createdAt: withdrawals.createdAt,
        updatedAt: withdrawals.updatedAt,
        completedAt: withdrawals.completedAt,
      })
      .from(withdrawals);
  }),
});
