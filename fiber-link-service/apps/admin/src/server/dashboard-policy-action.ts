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
): string | undefined {
  const header = headerValue?.trim();
  if (header) {
    return header;
  }

  const fallback = env?.ADMIN_DASHBOARD_DEFAULT_ADMIN_USER_ID?.trim();
  return fallback || undefined;
}

function readRole(roleHeader: string | undefined, env: NodeJS.ProcessEnv | undefined): UserRole | undefined {
  return parseAdminRole(roleHeader) ?? parseAdminRole(env?.ADMIN_DASHBOARD_DEFAULT_ROLE);
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
  const role = readRole(request.roleHeader, deps.env);
  const adminUserId = readAdminUserId(request.adminUserIdHeader, deps.env);

  try {
    if (!role) {
      throw new Error("Missing or invalid x-admin-role header");
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
