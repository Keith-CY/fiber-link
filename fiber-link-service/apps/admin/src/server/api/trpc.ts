import { initTRPC } from "@trpc/server";
import type { DbClient } from "@fiber-link/db";

export type TrpcContext = {
  role?: string;
  db?: DbClient;
};

export const t = initTRPC.context<TrpcContext>().create();
