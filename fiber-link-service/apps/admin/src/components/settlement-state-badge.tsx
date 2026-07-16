import type { InvoiceState } from "@fiber-link/db";
import { Badge, type BadgeProps } from "./ui/badge";

const STATE_VARIANT: Record<InvoiceState, BadgeProps["variant"]> = {
  UNPAID: "warning",
  SETTLED: "success",
  FAILED: "destructive",
};

export function SettlementStateBadge({ state }: { state: InvoiceState }) {
  return <Badge variant={STATE_VARIANT[state] ?? "outline"}>{state}</Badge>;
}
