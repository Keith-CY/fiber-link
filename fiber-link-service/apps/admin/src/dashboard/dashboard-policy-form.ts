import type { Asset } from "@fiber-link/db";

export type DashboardPolicyDraft = {
  appId: string;
  allowedAssets: Asset[];
  maxPerRequest: string;
  perUserDailyMax: string;
  perAppDailyMax: string;
  cooldownSeconds: string;
};

export type DashboardPolicyFlash = {
  savedAppId?: string;
  formError?: string;
  draft?: DashboardPolicyDraft;
};

function readString(raw: unknown): string {
  if (Array.isArray(raw)) {
    return readString(raw[0]);
  }
  return typeof raw === "string" ? raw.trim() : "";
}

function readAssetList(raw: unknown): Asset[] {
  const values = Array.isArray(raw) ? raw : typeof raw === "string" ? raw.split(",") : [];
  return Array.from(
    new Set(values.map((value) => value.trim()).filter((value): value is Asset => value === "CKB" || value === "USDI")),
  );
}

export function parseDashboardPolicyDraft(raw: Record<string, unknown>): DashboardPolicyDraft | undefined {
  const appId = readString(raw.appId);
  if (!appId) {
    return undefined;
  }

  return {
    appId,
    allowedAssets: readAssetList(raw.allowedAssets),
    maxPerRequest: readString(raw.maxPerRequest),
    perUserDailyMax: readString(raw.perUserDailyMax),
    perAppDailyMax: readString(raw.perAppDailyMax),
    cooldownSeconds: readString(raw.cooldownSeconds),
  };
}

function parseDraftFromSearch(searchParams: URLSearchParams): DashboardPolicyDraft | undefined {
  const appId = searchParams.get("draftAppId")?.trim() ?? "";
  if (!appId) {
    return undefined;
  }

  return {
    appId,
    allowedAssets: readAssetList(searchParams.getAll("draftAllowedAssets")),
    maxPerRequest: searchParams.get("draftMaxPerRequest")?.trim() ?? "",
    perUserDailyMax: searchParams.get("draftPerUserDailyMax")?.trim() ?? "",
    perAppDailyMax: searchParams.get("draftPerAppDailyMax")?.trim() ?? "",
    cooldownSeconds: searchParams.get("draftCooldownSeconds")?.trim() ?? "",
  };
}

export function readDashboardPolicyFlash(searchParams: URLSearchParams): DashboardPolicyFlash | undefined {
  const savedAppId = searchParams.get("savedAppId")?.trim() || undefined;
  const formError = searchParams.get("formError")?.trim() || undefined;
  const draft = parseDraftFromSearch(searchParams);
  const flash: DashboardPolicyFlash = {};

  if (savedAppId) {
    flash.savedAppId = savedAppId;
  }

  if (formError) {
    flash.formError = formError;
  }

  if (draft) {
    flash.draft = draft;
  }

  return Object.keys(flash).length > 0 ? flash : undefined;
}

export function buildDashboardPolicyRedirectTarget(input: DashboardPolicyFlash): string {
  const searchParams = new URLSearchParams();

  if (input.savedAppId) {
    searchParams.set("savedAppId", input.savedAppId);
  }

  if (input.formError) {
    searchParams.set("formError", input.formError);
  }

  if (input.draft) {
    searchParams.set("draftAppId", input.draft.appId);
    for (const asset of input.draft.allowedAssets) {
      searchParams.append("draftAllowedAssets", asset);
    }
    searchParams.set("draftMaxPerRequest", input.draft.maxPerRequest);
    searchParams.set("draftPerUserDailyMax", input.draft.perUserDailyMax);
    searchParams.set("draftPerAppDailyMax", input.draft.perAppDailyMax);
    searchParams.set("draftCooldownSeconds", input.draft.cooldownSeconds);
  }

  const search = searchParams.toString();
  return search ? `/?${search}` : "/";
}
