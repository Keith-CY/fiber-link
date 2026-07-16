import { appsRouter } from "./routers/apps";
import { ledgerRouter } from "./routers/ledger";
import { opsRouter } from "./routers/ops";
import { sessionRouter } from "./routers/session";
import { settlementsRouter } from "./routers/settlements";
import { withdrawalPolicyRouter } from "./routers/withdrawal-policy";
import { withdrawalsRouter } from "./routers/withdrawals";
import { router } from "./trpc";

export const appRouter = router({
  session: sessionRouter,
  apps: appsRouter,
  withdrawals: withdrawalsRouter,
  withdrawalPolicy: withdrawalPolicyRouter,
  settlements: settlementsRouter,
  ledger: ledgerRouter,
  ops: opsRouter,
});

export type AppRouter = typeof appRouter;
