import { TRPCError } from "@trpc/server";
import { type WithdrawalPolicyInput, parseWithdrawalPolicyInput } from "../../../withdrawal-policy-input";
import { PolicyScopeError, UnknownAppError } from "../../services/errors";
import { adminProcedure, router } from "../trpc";

function parsePolicyInput(input: unknown): WithdrawalPolicyInput {
  try {
    return parseWithdrawalPolicyInput(input);
  } catch (error) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: error instanceof Error ? error.message : "invalid withdrawal policy input",
    });
  }
}

export const withdrawalPolicyRouter = router({
  list: adminProcedure.query(async ({ ctx }) => {
    return ctx.services.listPolicies(ctx.scope);
  }),

  upsert: adminProcedure.input(parsePolicyInput).mutation(async ({ ctx, input }) => {
    try {
      return await ctx.services.upsertPolicy(ctx.scope, input);
    } catch (error) {
      if (error instanceof PolicyScopeError) {
        throw new TRPCError({ code: "FORBIDDEN", message: error.message });
      }
      if (error instanceof UnknownAppError) {
        throw new TRPCError({ code: "NOT_FOUND", message: error.message });
      }
      throw new TRPCError({
        code: "INTERNAL_SERVER_ERROR",
        message: error instanceof Error ? error.message : "failed to persist withdrawal policy",
      });
    }
  }),
});
