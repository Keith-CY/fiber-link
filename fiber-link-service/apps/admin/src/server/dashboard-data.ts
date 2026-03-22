import { createDbClient, type DbClient, type UserRole } from "@fiber-link/db";
import { appRouter } from "./api/routers/app";
import { withdrawalPolicyRouter } from "./api/routers/withdrawal-policy";
import { withdrawalRouter } from "./api/routers/withdrawal";
import type { TrpcContext } from "./api/trpc";
import { getDashboardFixtureDependencies } from "./dashboard-fixture-store";
import { loadDashboardMonitoringSummary } from "./dashboard-monitoring";
import { loadDashboardRateLimitConfig } from "./dashboard-rate-limit";
import { listDashboardBackupBundles } from "./dashboard-backups";
import {
  parseAdminRole,
  summarizeWithdrawalStates,
  type DashboardApp,
  type DashboardBackupBundle,
  type DashboardMonitoringSummary,
  type DashboardOperationsState,
  type DashboardPageState,
  type DashboardRateLimitConfig,
  type DashboardWithdrawal,
  type DashboardWithdrawalPolicy,
} from "../dashboard/dashboard-page-model";

export type DashboardDataDependencies = {
  createDb: () => DbClient;
  listApps: (ctx: TrpcContext) => Promise<DashboardApp[]>;
  listWithdrawals: (ctx: TrpcContext) => Promise<DashboardWithdrawal[]>;
  listPolicies: (ctx: TrpcContext) => Promise<DashboardWithdrawalPolicy[]>;
  loadMonitoringSummary?: () => Promise<DashboardMonitoringSummary>;
  loadRateLimitConfig?: () => Promise<DashboardRateLimitConfig>;
  listBackupBundles?: () => Promise<DashboardBackupBundle[]>;
};

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
  listPolicies: async (ctx) => {
    const rows = await withdrawalPolicyRouter.createCaller(ctx).list();
    return rows.map((row) => ({
      appId: row.appId,
      allowedAssets: row.allowedAssets,
      maxPerRequest: row.maxPerRequest,
      perUserDailyMax: row.perUserDailyMax,
      perAppDailyMax: row.perAppDailyMax,
      cooldownSeconds: row.cooldownSeconds,
      updatedBy: row.updatedBy ?? null,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    }));
  },
  loadMonitoringSummary: async () => loadDashboardMonitoringSummary(),
  loadRateLimitConfig: async () => loadDashboardRateLimitConfig(),
  listBackupBundles: async () => listDashboardBackupBundles(),
};

function getDashboardDataDependencies(env: NodeJS.ProcessEnv = process.env): DashboardDataDependencies {
  return getDashboardFixtureDependencies(env) ?? DEFAULT_DATA_DEPENDENCIES;
}

function resolveAdminRole(roleHeader: string | undefined, env: NodeJS.ProcessEnv): UserRole | undefined {
  return parseAdminRole(roleHeader) ?? parseAdminRole(env.ADMIN_DASHBOARD_DEFAULT_ROLE);
}

function resolveAdminUserId(adminUserIdHeader: string | undefined, env: NodeJS.ProcessEnv): string | undefined {
  const headerValue = adminUserIdHeader?.trim();
  if (headerValue) {
    return headerValue;
  }

  const fallback = env.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID?.trim();
  return fallback || undefined;
}

async function loadOperationsState(deps: DashboardDataDependencies): Promise<DashboardOperationsState> {
  const [monitoring, rateLimit, backups] = await Promise.all([
    (async () => {
      if (!deps.loadMonitoringSummary) {
        return { status: "error", message: "Monitoring is not configured" } as const;
      }

      try {
        return {
          status: "ready",
          summary: await deps.loadMonitoringSummary(),
        } as const;
      } catch (error) {
        return {
          status: "error",
          message: getErrorMessage(error),
        } as const;
      }
    })(),
    (async () => {
      if (!deps.loadRateLimitConfig) {
        return { status: "error", message: "Rate limiting is not configured" } as const;
      }

      try {
        return {
          status: "ready",
          config: await deps.loadRateLimitConfig(),
        } as const;
      } catch (error) {
        return {
          status: "error",
          message: getErrorMessage(error),
        } as const;
      }
    })(),
    (async () => {
      if (!deps.listBackupBundles) {
        return { status: "error", message: "Backups are not configured" } as const;
      }

      try {
        return {
          status: "ready",
          bundles: await deps.listBackupBundles(),
        } as const;
      } catch (error) {
        return {
          status: "error",
          message: getErrorMessage(error),
        } as const;
      }
    })(),
  ]);

  return {
    monitoring,
    rateLimit,
    backups,
  };
}

export async function loadDashboardState(
  input: {
    roleHeader?: string;
    adminUserIdHeader?: string;
  },
  deps?: DashboardDataDependencies,
  env: NodeJS.ProcessEnv = process.env,
): Promise<DashboardPageState> {
  const resolvedDeps = deps ?? getDashboardDataDependencies(env);
  const role = resolveAdminRole(input.roleHeader, env);
  if (!role) {
    return {
      status: "error",
      message: "Missing or invalid x-admin-role header",
    };
  }

  try {
    const db = resolvedDeps.createDb();
    const trpcContext: TrpcContext = {
      role,
      adminUserId: resolveAdminUserId(input.adminUserIdHeader, env),
      db,
    };
    const [apps, withdrawals, policies] = await Promise.all([
      resolvedDeps.listApps(trpcContext),
      resolvedDeps.listWithdrawals(trpcContext),
      resolvedDeps.listPolicies(trpcContext),
    ]);
    const operations = role === "SUPER_ADMIN" ? await loadOperationsState(resolvedDeps) : undefined;

    return {
      status: "ready",
      role,
      apps,
      withdrawals,
      statusSummaries: summarizeWithdrawalStates(withdrawals),
      policies,
      operations,
    };
  } catch (error) {
    return {
      status: "error",
      role,
      message: getErrorMessage(error),
    };
  }
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to load dashboard data";
}
