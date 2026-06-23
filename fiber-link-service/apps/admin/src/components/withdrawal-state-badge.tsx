import type { WithdrawalState } from "@fiber-link/db";
import { Badge, type BadgeProps } from "./ui/badge";

const STATE_VARIANT: Record<WithdrawalState, BadgeProps["variant"]> = {
  LIQUIDITY_PENDING: "warning",
  PENDING: "secondary",
  PROCESSING: "secondary",
  BROADCASTED: "default",
  RETRY_PENDING: "warning",
  COMPLETED: "success",
  FAILED: "destructive",
};

export function WithdrawalStateBadge({ state }: { state: WithdrawalState }) {
  return <Badge variant={STATE_VARIANT[state] ?? "outline"}>{state}</Badge>;
}
