import type { DbClient, UserRole } from "@fiber-link/db";
import { parseDashboardPolicyDraft, buildDashboardPolicyRedirectTarget } from "../dashboard/dashboard-policy-form";
import { parseAdminRole } from "../dashboard/dashboard-page-model";
import { parseWithdrawalPolicyInput, type WithdrawalPolicyInput } from "../withdrawal-policy-input";
import type { TrpcContext } from "./api/trpc";

type DashboardPolicyActionRequest = {
  roleHeader?: string;
  adminUserIdHeader?: string;
  body: Record<string, unknown>;
};

type DashboardPolicyActionDependencies = {
  allowDefaultIdentityFallback?: boolean;
  env?: NodeJS.ProcessEnv;
  createDb?: () => DbClient;
  upsertPolicy: (input: {
    ctx: TrpcContext;
    input: WithdrawalPolicyInput;
  }) => Promise<unknown>;
};

export type DashboardPolicyActionResult = {
  statusCode: number;
  location: string;
};

function readAdminUserId(
  headerValue: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
  allowDefaultIdentityFallback: boolean | undefined,
): string | undefined {
  const header = headerValue?.trim();
  if (header) {
    return header;
  }

  if (!allowDefaultIdentityFallback) {
    return undefined;
  }

  const fallback = env?.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID?.trim();
  return fallback || undefined;
}

function readRole(
  roleHeader: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
  allowDefaultIdentityFallback: boolean | undefined,
): UserRole | undefined {
  const headerRole = parseAdminRole(roleHeader);
  if (headerRole) {
    return headerRole;
  }
  if (!allowDefaultIdentityFallback) {
    return undefined;
  }
  return parseAdminRole(env?.ADMIN_DASHBOARD_DEFAULT_ROLE);
}

function getErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return "Failed to save withdrawal policy";
}

export async function handleDashboardPolicyAction(
  request: DashboardPolicyActionRequest,
  deps: DashboardPolicyActionDependencies,
): Promise<DashboardPolicyActionResult> {
  const role = readRole(request.roleHeader, deps.env, deps.allowDefaultIdentityFallback);
  const adminUserId = readAdminUserId(
    request.adminUserIdHeader,
    deps.env,
    deps.allowDefaultIdentityFallback,
  );

  try {
    if (!role) {
      throw new Error("Missing or invalid x-admin-role header");
    }
    if (!adminUserId) {
      throw new Error("Missing x-admin-user-id header");
    }

    const input = parseWithdrawalPolicyInput(request.body);
    await deps.upsertPolicy({
      ctx: {
        role,
        adminUserId,
        db: deps.createDb ? deps.createDb() : undefined,
      },
      input,
    });

    return {
      statusCode: 303,
      location: buildDashboardPolicyRedirectTarget({ savedAppId: input.appId }),
    };
  } catch (error) {
    return {
      statusCode: 303,
      location: buildDashboardPolicyRedirectTarget({
        formError: getErrorMessage(error),
        draft: parseDashboardPolicyDraft(request.body),
      }),
    };
  }
}
