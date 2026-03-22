import { parseAdminRole } from "../dashboard/dashboard-page-model";
import {
  buildDashboardOperationRedirectTarget,
  parseDashboardRateLimitDraft,
} from "../dashboard/dashboard-operation-form";
import {
  buildDashboardRateLimitChangeSet,
  loadDashboardRateLimitConfig,
  parseDashboardRateLimitInput,
  type DashboardRateLimitChangeSet,
  type DashboardRateLimitDraft,
} from "./dashboard-rate-limit";

type DashboardRateLimitActionRequest = {
  roleHeader?: string;
  body: Record<string, unknown>;
};

type DashboardRateLimitActionDependencies = {
  allowDefaultIdentityFallback?: boolean;
  env?: NodeJS.ProcessEnv;
  loadRateLimitConfig?: () => Promise<ReturnType<typeof loadDashboardRateLimitConfig>>;
  createRateLimitChangeSet?: (input: DashboardRateLimitDraft) => Promise<DashboardRateLimitChangeSet>;
};

export type DashboardRateLimitActionResult = {
  statusCode: number;
  location: string;
};

function readRole(
  roleHeader: string | undefined,
  env: NodeJS.ProcessEnv | undefined,
  allowDefaultIdentityFallback: boolean | undefined,
) {
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
  return "Failed to generate rate-limit change set";
}

export async function handleDashboardRateLimitAction(
  request: DashboardRateLimitActionRequest,
  deps: DashboardRateLimitActionDependencies = {},
): Promise<DashboardRateLimitActionResult> {
  const role = readRole(request.roleHeader, deps.env, deps.allowDefaultIdentityFallback);
  const draft = parseDashboardRateLimitDraft(request.body);

  try {
    if (role !== "SUPER_ADMIN") {
      throw new Error("Only SUPER_ADMIN can manage global rate limiting");
    }

    const parsedDraft = parseDashboardRateLimitInput(draft);
    const changeSet = deps.createRateLimitChangeSet
      ? await deps.createRateLimitChangeSet(parsedDraft)
      : buildDashboardRateLimitChangeSet(
          await (deps.loadRateLimitConfig ? deps.loadRateLimitConfig() : Promise.resolve(loadDashboardRateLimitConfig({ env: deps.env }))),
          parsedDraft,
        );

    return {
      statusCode: 303,
      location: buildDashboardOperationRedirectTarget({
        rateLimitDraft: parsedDraft,
        rateLimitChangeSet: changeSet,
      }),
    };
  } catch (error) {
    return {
      statusCode: 303,
      location: buildDashboardOperationRedirectTarget({
        rateLimitError: getErrorMessage(error),
        rateLimitDraft: draft,
      }),
    };
  }
}
