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

export const RpcErrorCode = {
  INVALID_REQUEST: -32600,
  METHOD_NOT_FOUND: -32601,
  INVALID_PARAMS: -32602,
  INTERNAL_ERROR: -32603,
  UNAUTHORIZED: -32001,
  TIP_NOT_FOUND: -32004,
} as const;

export type RpcErrorCode = (typeof RpcErrorCode)[keyof typeof RpcErrorCode];
