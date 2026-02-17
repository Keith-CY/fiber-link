import { createDbClient, type DbClient, type UserRole, type WithdrawalState } from "@fiber-link/db";
import { appRouter } from "../server/api/routers/app";
import { withdrawalRouter } from "../server/api/routers/withdrawal";
import type { TrpcContext } from "../server/api/trpc";

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
};

export type DashboardPageState = DashboardLoadingState | DashboardErrorState | DashboardReadyState;

export type DashboardRoleVisibility = {
  scopeDescription: string;
  showUserId: boolean;
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

export type DashboardDataDependencies = {
  createDb: () => DbClient;
  listApps: (ctx: TrpcContext) => Promise<DashboardApp[]>;
  listWithdrawals: (ctx: TrpcContext) => Promise<DashboardWithdrawal[]>;
};

const WITHDRAWAL_STATE_ORDER: WithdrawalState[] = [
  "PENDING",
  "PROCESSING",
  "RETRY_PENDING",
  "COMPLETED",
  "FAILED",
];

const DEFAULT_DATA_DEPENDENCIES: DashboardDataDependencies = {
  createDb: () => createDbClient(),
  listApps: async (ctx) => {
    const rows = await appRouter.createCaller(ctx).list();
    return rows.map((row) => ({
      appId: row.appId,
      createdAt: row.createdAt.toISOString(),
    }));
  },
  listWithdrawals: async (ctx) => {
    const rows = await withdrawalRouter.createCaller(ctx).list();
    return rows.map((row) => ({
      id: row.id,
      appId: row.appId,
      userId: row.userId,
      asset: row.asset,
      amount: row.amount,
      state: row.state,
      createdAt: row.createdAt.toISOString(),
      txHash: row.txHash ?? null,
    }));
  },
};

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
    };
  }

  return {
    scopeDescription: "Scoped visibility for assigned communities",
    showUserId: false,
  };
}

export function summarizeWithdrawalStates(withdrawals: DashboardWithdrawal[]): DashboardStatusSummary[] {
  const counts = WITHDRAWAL_STATE_ORDER.reduce<Record<WithdrawalState, number>>(
    (acc, state) => {
      acc[state] = 0;
      return acc;
    },
    {
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

export async function loadDashboardState(
  input: {
    roleHeader?: string;
    adminUserIdHeader?: string;
  },
  deps: DashboardDataDependencies = DEFAULT_DATA_DEPENDENCIES,
): Promise<DashboardPageState> {
  const role = parseAdminRole(input.roleHeader);
  if (!role) {
    return {
      status: "error",
      message: "Missing or invalid x-admin-role header",
    };
  }

  try {
    const db = deps.createDb();
    const trpcContext: TrpcContext = {
      role,
      adminUserId: input.adminUserIdHeader?.trim() || undefined,
      db,
    };
    const [apps, withdrawals] = await Promise.all([deps.listApps(trpcContext), deps.listWithdrawals(trpcContext)]);

    return {
      status: "ready",
      role,
      apps,
      withdrawals,
      statusSummaries: summarizeWithdrawalStates(withdrawals),
    };
  } catch (error) {
    return {
      status: "error",
      role,
      message: getErrorMessage(error),
    };
  }
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
  const withdrawalColumns = roleVisibility.showUserId
    ? ["id", "appId", "userId", "asset", "amount", "state", "createdAt", "txHash"]
    : ["id", "appId", "asset", "amount", "state", "createdAt", "txHash"];

  return {
    ...state,
    title: DASHBOARD_TITLE,
    roleVisibility,
    withdrawalColumns,
  };
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to load dashboard data";
}
