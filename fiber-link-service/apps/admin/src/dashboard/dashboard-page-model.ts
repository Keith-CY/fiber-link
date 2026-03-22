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
};

export type DashboardViewModel = DashboardLoadingViewModel | DashboardErrorViewModel | DashboardReadyViewModel;

const WITHDRAWAL_STATE_ORDER: WithdrawalState[] = [
  "LIQUIDITY_PENDING",
  "PENDING",
  "PROCESSING",
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
  };
}
