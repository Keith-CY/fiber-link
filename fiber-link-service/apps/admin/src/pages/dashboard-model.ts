import type { UserRole } from "@fiber-link/db";
import { appRouter } from "../server/api/routers/app";
import { withdrawalRouter } from "../server/api/routers/withdrawal";
import type { TrpcContext } from "../server/api/trpc";

export type DashboardApp = {
  appId: string;
  createdAt: Date;
};

export type DashboardWithdrawalState = "PENDING" | "PROCESSING" | "RETRY_PENDING" | "COMPLETED" | "FAILED";

export type DashboardWithdrawal = {
  id: string;
  appId: string;
  userId: string;
  asset: string;
  amount: string;
  toAddress: string;
  state: DashboardWithdrawalState;
  retryCount: number;
  nextRetryAt: Date | null;
  lastError: string | null;
  createdAt: Date;
  updatedAt: Date;
  completedAt: Date | null;
  txHash: string | null;
};

export const WITHDRAWAL_STATE_ORDER: DashboardWithdrawalState[] = [
  "PENDING",
  "PROCESSING",
  "RETRY_PENDING",
  "COMPLETED",
  "FAILED",
];

export type WithdrawalStatusSummary = {
  total: number;
  byState: Record<DashboardWithdrawalState, number>;
};

export type DashboardLoadingState = {
  kind: "loading";
};

export type DashboardErrorState = {
  kind: "error";
  message: string;
};

export type DashboardReadyState = {
  kind: "ready";
  role: UserRole;
  scopeLabel: string;
  showUserIds: boolean;
  apps: DashboardApp[];
  withdrawals: DashboardWithdrawal[];
  statusSummary: WithdrawalStatusSummary;
};

export type DashboardState = DashboardLoadingState | DashboardErrorState | DashboardReadyState;

export function getInitialDashboardState(): DashboardLoadingState {
  return { kind: "loading" };
}

export function summarizeWithdrawalStates(withdrawals: DashboardWithdrawal[]): WithdrawalStatusSummary {
  const byState = WITHDRAWAL_STATE_ORDER.reduce(
    (acc, state) => {
      acc[state] = 0;
      return acc;
    },
    {} as Record<DashboardWithdrawalState, number>,
  );

  for (const row of withdrawals) {
    byState[row.state] += 1;
  }

  return {
    total: withdrawals.length,
    byState,
  };
}

function getScopeLabel(role: UserRole): string {
  if (role === "SUPER_ADMIN") {
    return "Global operational view across all apps.";
  }
  return "Scoped operational view for apps you administer.";
}

function getErrorMessage(error: unknown): string {
  if (error && typeof error === "object") {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.length > 0) {
      return message;
    }
  }
  if (typeof error === "string" && error.length > 0) {
    return error;
  }
  return "Failed to load admin dashboard data.";
}

export function createReadyDashboardState(
  role: UserRole,
  apps: DashboardApp[],
  withdrawals: DashboardWithdrawal[],
): DashboardReadyState {
  return {
    kind: "ready",
    role,
    scopeLabel: getScopeLabel(role),
    showUserIds: role === "SUPER_ADMIN",
    apps,
    withdrawals,
    statusSummary: summarizeWithdrawalStates(withdrawals),
  };
}

export async function loadDashboardState(ctx: TrpcContext): Promise<DashboardState> {
  if (!ctx.role) {
    return { kind: "error", message: "Admin role is required to view dashboard." };
  }

  try {
    const appCaller = appRouter.createCaller(ctx);
    const withdrawalCaller = withdrawalRouter.createCaller(ctx);
    const [apps, withdrawals] = await Promise.all([appCaller.list(), withdrawalCaller.list()]);

    return createReadyDashboardState(ctx.role, apps as DashboardApp[], withdrawals as DashboardWithdrawal[]);
  } catch (error) {
    return { kind: "error", message: getErrorMessage(error) };
  }
}
