import { createNextApiHandler } from "@trpc/server/adapters/next";
import { appRouter } from "../../../server/api/root";
import { createTrpcContext } from "../../../server/api/context";

export default createNextApiHandler({
  router: appRouter,
  createContext: createTrpcContext,
});
