export type DashboardRateLimitDraft = {
  enabled: boolean;
  windowMs: string;
  maxRequests: string;
};

export type DashboardRateLimitChangeSetFlash = {
  changedKeys: string[];
  envSnippet: string;
  rollbackSnippet: string;
};

export type DashboardBackupCaptureFlash = {
  status: "success" | "error";
  message: string;
  backupId?: string;
  archiveFile?: string | null;
};

export type DashboardBackupRestorePlanFlash = {
  backupId: string;
  command: string;
  warnings?: string[];
};

export type DashboardOperationFlash = {
  rateLimitError?: string;
  rateLimitDraft?: DashboardRateLimitDraft;
  rateLimitChangeSet?: DashboardRateLimitChangeSetFlash;
  backupCapture?: DashboardBackupCaptureFlash;
  backupRestorePlan?: DashboardBackupRestorePlanFlash;
};

function readString(raw: unknown): string {
  if (Array.isArray(raw)) {
    return readString(raw[0]);
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function readBoolean(raw: unknown): boolean {
  const value = readString(raw).toLowerCase();
  return value === "true" || value === "1" || value === "on" || value === "yes";
}

export function parseDashboardRateLimitDraft(raw: Record<string, unknown>): DashboardRateLimitDraft {
  return {
    enabled: readBoolean(raw.enabled ?? raw.rateLimitEnabled),
    windowMs: readString(raw.windowMs ?? raw.rateLimitWindowMs),
    maxRequests: readString(raw.maxRequests ?? raw.rateLimitMaxRequests),
  };
}

export function readDashboardOperationFlash(searchParams: URLSearchParams): DashboardOperationFlash | undefined {
  const draftWindowMs = searchParams.get("rateLimitDraftWindowMs");
  const draftMaxRequests = searchParams.get("rateLimitDraftMaxRequests");
  const draftEnabled = searchParams.get("rateLimitDraftEnabled");
  const restoreWarnings = searchParams.getAll("restoreWarning").filter(Boolean);
  const backupCaptureStatus = searchParams.get("backupCaptureStatus");
  const flash: DashboardOperationFlash = {};
  const rateLimitError = searchParams.get("rateLimitError")?.trim() || undefined;

  if (rateLimitError) {
    flash.rateLimitError = rateLimitError;
  }

  if (draftWindowMs !== null || draftMaxRequests !== null || draftEnabled !== null) {
    flash.rateLimitDraft = {
      enabled: draftEnabled === "true",
      windowMs: draftWindowMs?.trim() ?? "",
      maxRequests: draftMaxRequests?.trim() ?? "",
    };
  }

  if (searchParams.get("rateLimitEnvSnippet") || searchParams.get("rateLimitRollbackSnippet")) {
    flash.rateLimitChangeSet = {
      changedKeys: searchParams.getAll("rateLimitChangedKey").filter(Boolean),
      envSnippet: searchParams.get("rateLimitEnvSnippet") ?? "",
      rollbackSnippet: searchParams.get("rateLimitRollbackSnippet") ?? "",
    };
  }

  if (backupCaptureStatus === "success" || backupCaptureStatus === "error") {
    const backupCapture: DashboardBackupCaptureFlash = {
      status: backupCaptureStatus,
      message: searchParams.get("backupCaptureMessage") ?? "",
    };
    const backupId = searchParams.get("backupCaptureBackupId");
    const archiveFile = searchParams.get("backupCaptureArchive");

    if (backupId) {
      backupCapture.backupId = backupId;
    }
    if (archiveFile !== null) {
      backupCapture.archiveFile = archiveFile;
    }

    flash.backupCapture = backupCapture;
  }

  if (searchParams.get("restoreBackupId") || searchParams.get("restoreCommand")) {
    const backupRestorePlan: DashboardBackupRestorePlanFlash = {
      backupId: searchParams.get("restoreBackupId") ?? "",
      command: searchParams.get("restoreCommand") ?? "",
    };

    if (restoreWarnings.length > 0) {
      backupRestorePlan.warnings = restoreWarnings;
    }

    flash.backupRestorePlan = backupRestorePlan;
  }

  return Object.keys(flash).length > 0 ? flash : undefined;
}

export function buildDashboardOperationRedirectTarget(input: DashboardOperationFlash): string {
  const searchParams = new URLSearchParams();

  if (input.rateLimitError) {
    searchParams.set("rateLimitError", input.rateLimitError);
  }

  if (input.rateLimitDraft) {
    searchParams.set("rateLimitDraftEnabled", input.rateLimitDraft.enabled ? "true" : "false");
    searchParams.set("rateLimitDraftWindowMs", input.rateLimitDraft.windowMs);
    searchParams.set("rateLimitDraftMaxRequests", input.rateLimitDraft.maxRequests);
  }

  if (input.rateLimitChangeSet) {
    for (const key of input.rateLimitChangeSet.changedKeys) {
      searchParams.append("rateLimitChangedKey", key);
    }
    searchParams.set("rateLimitEnvSnippet", input.rateLimitChangeSet.envSnippet);
    searchParams.set("rateLimitRollbackSnippet", input.rateLimitChangeSet.rollbackSnippet);
  }

  if (input.backupCapture) {
    searchParams.set("backupCaptureStatus", input.backupCapture.status);
    searchParams.set("backupCaptureMessage", input.backupCapture.message);
    if (input.backupCapture.backupId) {
      searchParams.set("backupCaptureBackupId", input.backupCapture.backupId);
    }
    if (input.backupCapture.archiveFile) {
      searchParams.set("backupCaptureArchive", input.backupCapture.archiveFile);
    }
  }

  if (input.backupRestorePlan) {
    searchParams.set("restoreBackupId", input.backupRestorePlan.backupId);
    searchParams.set("restoreCommand", input.backupRestorePlan.command);
    for (const warning of input.backupRestorePlan.warnings ?? []) {
      searchParams.append("restoreWarning", warning);
    }
  }

  const search = searchParams.toString();
  return search ? `/?${search}` : "/";
}
