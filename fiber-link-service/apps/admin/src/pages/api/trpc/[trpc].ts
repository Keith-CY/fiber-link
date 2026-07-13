import { createNextApiHandler } from "@trpc/server/adapters/next";
import { createTrpcContext } from "../../../server/api/context";
import { appRouter } from "../../../server/api/root";

export default createNextApiHandler({
  router: appRouter,
  createContext: createTrpcContext,
});
