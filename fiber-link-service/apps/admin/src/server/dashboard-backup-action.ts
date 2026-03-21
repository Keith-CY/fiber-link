import { parseAdminRole, type DashboardBackupBundle } from "../dashboard/dashboard-page-model";
import { buildDashboardOperationRedirectTarget } from "../dashboard/dashboard-operation-form";
import {
  buildDashboardBackupRestorePlan,
  captureDashboardBackup,
  listDashboardBackupBundles,
  type DashboardBackupCaptureResult,
  type DashboardBackupRestorePlan,
} from "./dashboard-backups";

type DashboardBackupActionRequest = {
  roleHeader?: string;
  body?: Record<string, unknown>;
};

type DashboardBackupActionDependencies = {
  env?: NodeJS.ProcessEnv;
  captureBackup?: () => Promise<DashboardBackupCaptureResult>;
  listBackupBundles?: () => Promise<DashboardBackupBundle[]>;
  buildBackupRestorePlan?: (backupId: string) => Promise<DashboardBackupRestorePlan>;
};

export type DashboardBackupActionResult = {
  statusCode: number;
  location: string;
};

function readRole(roleHeader: string | undefined, env: NodeJS.ProcessEnv | undefined) {
  return parseAdminRole(roleHeader) ?? parseAdminRole(env?.ADMIN_DASHBOARD_DEFAULT_ROLE);
}

function readBackupId(body: Record<string, unknown> | undefined): string {
  const raw = body?.backupId;
  if (Array.isArray(raw)) {
    return typeof raw[0] === "string" ? raw[0].trim() : "";
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function getErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export async function handleDashboardBackupCaptureAction(
  request: DashboardBackupActionRequest,
  deps: DashboardBackupActionDependencies = {},
): Promise<DashboardBackupActionResult> {
  const role = readRole(request.roleHeader, deps.env);

  try {
    if (role !== "SUPER_ADMIN") {
      throw new Error("Only SUPER_ADMIN can capture backups");
    }

    const result = deps.captureBackup ? await deps.captureBackup() : await captureDashboardBackup();
    return {
      statusCode: 303,
      location: buildDashboardOperationRedirectTarget({
        backupCapture: {
          status: "success",
          message: `Backup captured for ${result.backupId}`,
          backupId: result.backupId,
          archiveFile: result.archiveFile,
        },
      }),
    };
  } catch (error) {
    return {
      statusCode: 303,
      location: buildDashboardOperationRedirectTarget({
        backupCapture: {
          status: "error",
          message: getErrorMessage(error, "Failed to capture backup"),
        },
      }),
    };
  }
}

export async function handleDashboardBackupRestorePlanAction(
  request: DashboardBackupActionRequest,
  deps: DashboardBackupActionDependencies = {},
): Promise<DashboardBackupActionResult> {
  const role = readRole(request.roleHeader, deps.env);
  const backupId = readBackupId(request.body);

  try {
    if (role !== "SUPER_ADMIN") {
      throw new Error("Only SUPER_ADMIN can generate restore plans");
    }
    if (!backupId) {
      throw new Error("backupId is required");
    }

    const restorePlan = ifBackupRestorePlan(deps, backupId);
    return {
      statusCode: 303,
      location: buildDashboardOperationRedirectTarget({
        backupRestorePlan: await restorePlan,
      }),
    };
  } catch (error) {
    return {
      statusCode: 303,
      location: buildDashboardOperationRedirectTarget({
        backupCapture: {
          status: "error",
          message: getErrorMessage(error, "Failed to generate restore plan"),
        },
      }),
    };
  }
}

async function ifBackupRestorePlan(
  deps: DashboardBackupActionDependencies,
  backupId: string,
): Promise<DashboardBackupRestorePlan> {
  if (deps.buildBackupRestorePlan) {
    return deps.buildBackupRestorePlan(backupId);
  }

  const bundles = deps.listBackupBundles ? await deps.listBackupBundles() : listDashboardBackupBundles();
  const bundle = bundles.find((candidate) => candidate.id === backupId);
  if (!bundle) {
    throw new Error(`Unknown backup bundle: ${backupId}`);
  }
  return buildDashboardBackupRestorePlan(bundle);
}
