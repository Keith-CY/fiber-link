import { describe, expect, it } from "vitest";
import {
  buildDashboardPolicyRedirectTarget,
  parseDashboardPolicyDraft,
  readDashboardPolicyFlash,
  type DashboardPolicyDraft,
} from "../dashboard/dashboard-policy-form";

function createDraft(overrides: Partial<DashboardPolicyDraft> = {}): DashboardPolicyDraft {
  return {
    appId: "app-beta",
    allowedAssets: ["CKB", "USDI"],
    maxPerRequest: "1500",
    perUserDailyMax: "4500",
    perAppDailyMax: "25000",
    cooldownSeconds: "45",
    ...overrides,
  };
}

describe("dashboard policy form helpers", () => {
  it("returns no flash payload when query params are empty", () => {
    expect(readDashboardPolicyFlash(new URLSearchParams())).toBeUndefined();
  });

  it("builds a compact redirect target for successful saves", () => {
    expect(buildDashboardPolicyRedirectTarget({ savedAppId: "app-beta" })).toBe("/?savedAppId=app-beta");
  });

  it("round-trips draft values and validation errors through query params", () => {
    const location = buildDashboardPolicyRedirectTarget({
      formError: "maxPerRequest must be <= perUserDailyMax",
      draft: createDraft({ allowedAssets: ["USDI"] }),
    });

    const search = location.split("?")[1];
    expect(search).toBeTruthy();

    const flash = readDashboardPolicyFlash(new URLSearchParams(search));
    expect(flash).toEqual({
      formError: "maxPerRequest must be <= perUserDailyMax",
      draft: createDraft({ allowedAssets: ["USDI"] }),
    });
  });

  it("parses a dashboard draft from repeated form values", () => {
    const draft = parseDashboardPolicyDraft({
      appId: "app-alpha",
      allowedAssets: ["CKB", "USDI"],
      maxPerRequest: "5000",
      perUserDailyMax: "20000",
      perAppDailyMax: "200000",
      cooldownSeconds: "120",
    });

    expect(draft).toEqual(createDraft({
      appId: "app-alpha",
      maxPerRequest: "5000",
      perUserDailyMax: "20000",
      perAppDailyMax: "200000",
      cooldownSeconds: "120",
    }));
  });
});
