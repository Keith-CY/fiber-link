import { createNextApiHandler } from "@trpc/server/adapters/next";
import { createTrpcContext } from "../../../server/api/context";
import { withMutationRequestGuard } from "../../../server/api/request-guard";
import { appRouter } from "../../../server/api/root";

export default withMutationRequestGuard(
  createNextApiHandler({
    router: appRouter,
    createContext: createTrpcContext,
  }),
);
