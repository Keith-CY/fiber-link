import { adminProcedure, router } from "../trpc";

export const appsRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.listApps(ctx.scope);
  }),
});
