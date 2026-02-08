import { TRPCError } from "@trpc/server";
import { apps } from "@fiber-link/db";
import { requireRole } from "../../auth/roles";
import { t } from "../trpc";

export const appRouter = t.router({
  list: t.procedure.query(async ({ ctx }) => {
    requireRole(["SUPER_ADMIN", "COMMUNITY_ADMIN"], ctx.role);
    if (!ctx.db) {
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "DB not configured" });
    }

    return ctx.db.select({ appId: apps.appId, createdAt: apps.createdAt }).from(apps);
  }),
});
