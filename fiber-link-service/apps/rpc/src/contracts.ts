import { z } from "zod";

export const JsonRpcVersionSchema = z.literal("2.0");
export const RpcIdSchema = z.union([z.string(), z.number(), z.null()]);
export type RpcId = z.infer<typeof RpcIdSchema>;

export const RpcRequestSchema = z.object({
  jsonrpc: JsonRpcVersionSchema,
  id: RpcIdSchema,
  method: z.string().min(1),
  params: z.unknown().optional(),
});
export type RpcRequest = z.infer<typeof RpcRequestSchema>;

export const TipCreateParamsSchema = z.object({
  postId: z.string().min(1),
  fromUserId: z.string().min(1),
  toUserId: z.string().min(1),
  asset: z.enum(["CKB", "USDI"]),
  amount: z.string().min(1),
});

export const TipCreateResultSchema = z.object({
  invoice: z.string().min(1),
});

export const TipStatusParamsSchema = z.object({
  invoice: z.string().min(1),
});

export const TipStatusResultSchema = z.object({
  state: z.enum(["UNPAID", "SETTLED", "FAILED"]),
});

export const DashboardWithdrawalStateFilterSchema = z.enum([
  "ALL",
  "PENDING",
  "PROCESSING",
  "RETRY_PENDING",
  "COMPLETED",
  "FAILED",
]);

export const DashboardSettlementStateFilterSchema = z.enum(["ALL", "UNPAID", "SETTLED", "FAILED"]);

export const DashboardSummaryParamsSchema = z.object({
  userId: z.string().min(1),
  limit: z.number().int().min(1).max(50).optional(),
  includeAdmin: z.boolean().optional(),
  filters: z
    .object({
      withdrawalState: DashboardWithdrawalStateFilterSchema.optional(),
      settlementState: DashboardSettlementStateFilterSchema.optional(),
    })
    .optional(),
});

export const DashboardSummaryResultSchema = z.object({
  balance: z.string().min(1),
  tips: z.array(
    z.object({
      id: z.string().min(1),
      invoice: z.string().min(1),
      postId: z.string().min(1),
      amount: z.string().min(1),
      asset: z.enum(["CKB", "USDI"]),
      state: z.enum(["UNPAID", "SETTLED", "FAILED"]),
      direction: z.enum(["IN", "OUT"]),
      counterpartyUserId: z.string().min(1),
      createdAt: z.string().datetime(),
    }),
  ),
  admin: z
    .object({
      filtersApplied: z.object({
        withdrawalState: DashboardWithdrawalStateFilterSchema,
        settlementState: DashboardSettlementStateFilterSchema,
      }),
      apps: z.array(
        z.object({
          appId: z.string().min(1),
          createdAt: z.string().datetime(),
        }),
      ),
      withdrawals: z.array(
        z.object({
          id: z.string().min(1),
          userId: z.string().min(1),
          asset: z.enum(["CKB", "USDI"]),
          amount: z.string().min(1),
          state: z.enum(["PENDING", "PROCESSING", "RETRY_PENDING", "COMPLETED", "FAILED"]),
          retryCount: z.number().int().min(0),
          createdAt: z.string().datetime(),
          updatedAt: z.string().datetime(),
          txHash: z.string().nullable(),
          nextRetryAt: z.string().datetime().nullable(),
          lastError: z.string().nullable(),
        }),
      ),
      settlements: z.array(
        z.object({
          id: z.string().min(1),
          invoice: z.string().min(1),
          fromUserId: z.string().min(1),
          toUserId: z.string().min(1),
          state: z.enum(["UNPAID", "SETTLED", "FAILED"]),
          retryCount: z.number().int().min(0),
          createdAt: z.string().datetime(),
          settledAt: z.string().datetime().nullable(),
          nextRetryAt: z.string().datetime().nullable(),
          lastCheckedAt: z.string().datetime().nullable(),
          lastError: z.string().nullable(),
          failureReason: z.string().nullable(),
        }),
      ),
    })
    .optional(),
  generatedAt: z.string().datetime(),
});

export const RpcErrorCode = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  TIP_NOT_FOUND: -32004,
} as const;

export type RpcErrorCode = (typeof RpcErrorCode)[keyof typeof RpcErrorCode];
