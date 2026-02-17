import { WITHDRAWAL_STATE_ORDER, type DashboardReadyState, type DashboardState } from "./dashboard-model";

type SummaryRow = {
  state: string;
  count: number;
};

type AppRow = {
  appId: string;
  createdAt: string;
};

type WithdrawalRow = {
  id: string;
  appId: string;
  userId: string;
  asset: string;
  amount: string;
  state: string;
  retryCount: number;
  lastError: string;
  createdAt: string;
  completedAt: string;
};

type DashboardLoadingRenderModel = {
  kind: "loading";
  title: string;
  message: string;
};

type DashboardErrorRenderModel = {
  kind: "error";
  title: string;
  message: string;
};

type DashboardReadyRenderModel = {
  kind: "ready";
  title: string;
  scopeLabel: string;
  showUserColumn: boolean;
  totalWithdrawals: number;
  summaryRows: SummaryRow[];
  appRows: AppRow[];
  withdrawalRows: WithdrawalRow[];
};

export type DashboardRenderModel = DashboardLoadingRenderModel | DashboardErrorRenderModel | DashboardReadyRenderModel;

function formatTimestamp(value: Date | null): string {
  if (!value) {
    return "-";
  }
  return value.toISOString();
}

function toReadyRenderModel(state: DashboardReadyState): DashboardReadyRenderModel {
  return {
    kind: "ready",
    title: "Fiber Link Admin Dashboard",
    scopeLabel: state.scopeLabel,
    showUserColumn: state.showUserIds,
    totalWithdrawals: state.statusSummary.total,
    summaryRows: WITHDRAWAL_STATE_ORDER.map((withdrawalState) => ({
      state: withdrawalState,
      count: state.statusSummary.byState[withdrawalState],
    })),
    appRows: state.apps.map((app) => ({
      appId: app.appId,
      createdAt: formatTimestamp(app.createdAt),
    })),
    withdrawalRows: state.withdrawals.map((withdrawal) => ({
      id: withdrawal.id,
      appId: withdrawal.appId,
      userId: state.showUserIds ? withdrawal.userId : "Restricted",
      asset: withdrawal.asset,
      amount: withdrawal.amount,
      state: withdrawal.state,
      retryCount: withdrawal.retryCount,
      lastError: withdrawal.lastError ?? "-",
      createdAt: formatTimestamp(withdrawal.createdAt),
      completedAt: formatTimestamp(withdrawal.completedAt),
    })),
  };
}

export function buildDashboardRenderModel(state: DashboardState): DashboardRenderModel {
  if (state.kind === "loading") {
    return {
      kind: "loading",
      title: "Fiber Link Admin Dashboard",
      message: "Loading operational data...",
    };
  }

  if (state.kind === "error") {
    return {
      kind: "error",
      title: "Fiber Link Admin Dashboard",
      message: state.message,
    };
  }

  return toReadyRenderModel(state);
}
