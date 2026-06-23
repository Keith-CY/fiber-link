import { getRoleVisibility } from "../../../dashboard/dashboard-page-model";
import { publicProcedure, router } from "../trpc";

/**
 * Lightweight identity probe the client shell uses to render role-appropriate
 * navigation. Public (not `adminProcedure`) so an unauthenticated request
 * renders a clear "no role" state rather than a hard error.
 */
export const sessionRouter = router({
  me: publicProcedure.query(({ ctx }) => {
    if (ctx.role !== "SUPER_ADMIN" && ctx.role !== "COMMUNITY_ADMIN") {
      return { role: null as null, adminUserId: null as string | null, visibility: null };
    }
    return {
      role: ctx.role,
      adminUserId: ctx.adminUserId ?? null,
      visibility: getRoleVisibility(ctx.role),
    };
  }),
});
