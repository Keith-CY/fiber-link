import type { Asset } from "@fiber-link/db";

export type WithdrawalNotificationEventBase = {
  type: "WITHDRAWAL_RETRY_PENDING" | "WITHDRAWAL_FAILED" | "WITHDRAWAL_COMPLETED";
  occurredAt: Date;
  appId: string;
  userId: string;
  withdrawalId: string;
  asset: Asset;
  amount: string;
};

export type WithdrawalRetryPendingNotificationEvent = WithdrawalNotificationEventBase & {
  type: "WITHDRAWAL_RETRY_PENDING";
  retryCount: number;
  nextRetryAt: Date;
  error: string;
};

export type WithdrawalFailedNotificationEvent = WithdrawalNotificationEventBase & {
  type: "WITHDRAWAL_FAILED";
  retryCount: number;
  error: string;
};

export type WithdrawalCompletedNotificationEvent = WithdrawalNotificationEventBase & {
  type: "WITHDRAWAL_COMPLETED";
  txHash: string;
};

export type WithdrawalNotificationEvent =
  | WithdrawalRetryPendingNotificationEvent
  | WithdrawalFailedNotificationEvent
  | WithdrawalCompletedNotificationEvent;
