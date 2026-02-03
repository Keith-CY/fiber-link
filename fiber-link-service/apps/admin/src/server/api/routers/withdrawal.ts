import { initTRPC } from "@trpc/server";
const t = initTRPC.create();

export const withdrawalRouter = t.router({
  list: t.procedure.query(() => []),
});
