import type { UserRole, WithdrawalState } from "@fiber-link/db";

export const DASHBOARD_TITLE = "Fiber Link Admin Dashboard";

export type DashboardApp = {
  appId: string;
  createdAt: string;
};

export type DashboardWithdrawal = {
  id: string;
  appId: string;
  userId: string;
  asset: "CKB" | "USDI";
  amount: string;
  state: WithdrawalState;
  createdAt: string;
  txHash: string | null;
};

export type DashboardStatusSummary = {
  state: WithdrawalState;
  count: number;
};

export type DashboardWithdrawalPolicy = {
  appId: string;
  allowedAssets: Array<"CKB" | "USDI">;
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: number;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DashboardMonitoringSummary = {
  status: "ok" | "alert";
  generatedAt: string;
  readinessStatus: "ready" | "not_ready";
  unpaidBacklog: number;
  retryPendingCount: number;
  withdrawalParityIssueCount: number;
  alertCount: number;
  rawJson?: string;
};

export type DashboardMonitoringState =
  | {
      status: "ready";
      summary: DashboardMonitoringSummary;
    }
  | {
      status: "error";
      message: string;
    };

export type DashboardRateLimitConfig = {
  enabled: boolean;
  windowMs: string;
  maxRequests: string;
  redisUrl: string | null;
  sourceLabel: string;
};

export type DashboardRateLimitState =
  | {
      status: "ready";
      config: DashboardRateLimitConfig;
    }
  | {
      status: "error";
      message: string;
    };

export type DashboardBackupBundle = {
  id: string;
  generatedAt: string;
  overallStatus: string;
  retentionDays: number;
  dryRun: boolean;
  backupDir: string;
  archiveFile: string | null;
};

export type DashboardBackupsState =
  | {
      status: "ready";
      bundles: DashboardBackupBundle[];
    }
  | {
      status: "error";
      message: string;
    };

export type DashboardOperationsState = {
  monitoring: DashboardMonitoringState;
  rateLimit: DashboardRateLimitState;
  backups: DashboardBackupsState;
};

export type DashboardOpsTriageCard = {
  id: string;
  label: string;
  value: string;
  severity: "ok" | "watch" | "alert";
  description: string;
  href: string;
};

type DashboardLoadingState = {
  status: "loading";
};

type DashboardErrorState = {
  status: "error";
  role?: UserRole;
  message: string;
};

type DashboardReadyState = {
  status: "ready";
  role: UserRole;
  apps: DashboardApp[];
  withdrawals: DashboardWithdrawal[];
  statusSummaries: DashboardStatusSummary[];
  policies: DashboardWithdrawalPolicy[];
  operations?: DashboardOperationsState;
};

export type DashboardPageState = DashboardLoadingState | DashboardErrorState | DashboardReadyState;

export type DashboardRoleVisibility = {
  scopeDescription: string;
  showUserId: boolean;
  showGlobalControls: boolean;
};

type DashboardLoadingViewModel = {
  status: "loading";
  title: string;
};

type DashboardErrorViewModel = {
  status: "error";
  title: string;
  message: string;
};

type DashboardReadyViewModel = DashboardReadyState & {
  title: string;
  roleVisibility: DashboardRoleVisibility;
  withdrawalColumns: Array<"id" | "appId" | "userId" | "asset" | "amount" | "state" | "createdAt" | "txHash">;
  opsTriageCards: DashboardOpsTriageCard[];
};

export type DashboardViewModel = DashboardLoadingViewModel | DashboardErrorViewModel | DashboardReadyViewModel;

const WITHDRAWAL_STATE_ORDER: WithdrawalState[] = [
  "LIQUIDITY_PENDING",
  "PENDING",
  "PROCESSING",
  "BROADCASTED",
  "RETRY_PENDING",
  "COMPLETED",
  "FAILED",
];

export function parseAdminRole(roleHeader?: string): UserRole | undefined {
  if (roleHeader === "SUPER_ADMIN" || roleHeader === "COMMUNITY_ADMIN") {
    return roleHeader;
  }
  return undefined;
}

export function getRoleVisibility(role: UserRole): DashboardRoleVisibility {
  if (role === "SUPER_ADMIN") {
    return {
      scopeDescription: "Global visibility across all communities",
      showUserId: true,
      showGlobalControls: true,
    };
  }

  return {
    scopeDescription: "Scoped visibility for assigned communities",
    showUserId: false,
    showGlobalControls: false,
  };
}

export function summarizeWithdrawalStates(withdrawals: DashboardWithdrawal[]): DashboardStatusSummary[] {
  const counts = WITHDRAWAL_STATE_ORDER.reduce<Record<WithdrawalState, number>>(
    (acc, state) => {
      acc[state] = 0;
      return acc;
    },
    {
      LIQUIDITY_PENDING: 0,
      PENDING: 0,
      PROCESSING: 0,
      BROADCASTED: 0,
      RETRY_PENDING: 0,
      COMPLETED: 0,
      FAILED: 0,
    },
  );

  for (const row of withdrawals) {
    counts[row.state] = (counts[row.state] ?? 0) + 1;
  }

  return WITHDRAWAL_STATE_ORDER.map((state) => ({ state, count: counts[state] ?? 0 }));
}

function countState(statusSummaries: DashboardStatusSummary[], state: WithdrawalState): number {
  return statusSummaries.find((summary) => summary.state === state)?.count ?? 0;
}

function severityFromCount(count: number, alertAt = 1): DashboardOpsTriageCard["severity"] {
  if (count <= 0) {
    return "ok";
  }

  return count >= alertAt ? "alert" : "watch";
}

export function buildOpsTriageCards(state: DashboardReadyState): DashboardOpsTriageCard[] {
  const liquidityPending = countState(state.statusSummaries, "LIQUIDITY_PENDING");
  const failedWithdrawals = countState(state.statusSummaries, "FAILED");
  const retryPendingWithdrawals = countState(state.statusSummaries, "RETRY_PENDING");
  const withdrawalBacklog =
    liquidityPending +
    countState(state.statusSummaries, "PENDING") +
    countState(state.statusSummaries, "PROCESSING") +
    countState(state.statusSummaries, "BROADCASTED") +
    retryPendingWithdrawals;

  const monitoringSummary = state.operations?.monitoring.status === "ready" ? state.operations.monitoring.summary : undefined;
  const unpaidBacklog = monitoringSummary?.unpaidBacklog ?? 0;
  const settlementRetryPending = monitoringSummary?.retryPendingCount ?? 0;
  const alertCount = monitoringSummary?.alertCount ?? 0;

  const settlementBacklog = unpaidBacklog + settlementRetryPending;

  return [
    {
      id: "settlement-backlog",
      label: "Settlement backlog",
      value: String(settlementBacklog),
      severity: severityFromCount(settlementBacklog, 5),
      description:
        settlementRetryPending > 0
          ? `${unpaidBacklog} unpaid and ${settlementRetryPending} retry-pending settlement(s).`
          : "Unpaid invoice backlog from ops summary.",
      href: "#monitoring",
    },
    {
      id: "withdrawal-backlog",
      label: "Withdrawal backlog",
      value: String(withdrawalBacklog),
      severity: severityFromCount(withdrawalBacklog, 5),
      description: "Pending, processing, broadcasted, retry, and liquidity-pending withdrawals.",
      href: "#withdrawals",
    },
    {
      id: "liquidity-pending",
      label: "Liquidity pending",
      value: String(liquidityPending),
      severity: severityFromCount(liquidityPending),
      description: "Withdrawals blocked on available channel or chain liquidity.",
      href: "#withdrawals",
    },
    {
      id: "failed-withdrawals",
      label: "Failed withdrawals",
      value: String(failedWithdrawals),
      severity: severityFromCount(failedWithdrawals),
      description: "Terminal payout failures requiring operator investigation.",
      href: "#withdrawals",
    },
    {
      id: "ops-alerts",
      label: "Ops alerts",
      value: String(alertCount),
      severity: monitoringSummary ? severityFromCount(alertCount) : "watch",
      description: monitoringSummary ? `Ops summary status: ${monitoringSummary.status}.` : "Monitoring integration is unavailable.",
      href: "#monitoring",
    },
  ];
}

export function buildDashboardViewModel(state: DashboardPageState): DashboardViewModel {
  if (state.status === "loading") {
    return {
      status: "loading",
      title: DASHBOARD_TITLE,
    };
  }

  if (state.status === "error") {
    return {
      status: "error",
      title: DASHBOARD_TITLE,
      message: state.message,
    };
  }

  const roleVisibility = getRoleVisibility(state.role);
  const withdrawalColumns: DashboardReadyViewModel["withdrawalColumns"] = roleVisibility.showUserId
    ? ["id", "appId", "userId", "asset", "amount", "state", "createdAt", "txHash"]
    : ["id", "appId", "asset", "amount", "state", "createdAt", "txHash"];

  return {
    ...state,
    title: DASHBOARD_TITLE,
    roleVisibility,
    withdrawalColumns,
    opsTriageCards: buildOpsTriageCards(state),
  };
}
