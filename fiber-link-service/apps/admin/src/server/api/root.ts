import { router } from "./trpc";
import { sessionRouter } from "./routers/session";
import { appsRouter } from "./routers/apps";
import { withdrawalsRouter } from "./routers/withdrawals";
import { withdrawalPolicyRouter } from "./routers/withdrawal-policy";
import { opsRouter } from "./routers/ops";

export const appRouter = router({
  session: sessionRouter,
  apps: appsRouter,
  withdrawals: withdrawalsRouter,
  withdrawalPolicy: withdrawalPolicyRouter,
  ops: opsRouter,
});

export type AppRouter = typeof appRouter;
