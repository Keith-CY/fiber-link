import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "../pages/index";

describe("dashboard page", () => {
  it("renders editable policy forms and success feedback", () => {
    const html = renderToStaticMarkup(
      <HomePage
        initialState={{
          status: "ready",
          role: "SUPER_ADMIN",
          apps: [{ appId: "app-beta", createdAt: "2026-03-18T00:00:00.000Z" }],
          withdrawals: [],
          statusSummaries: [
            { state: "LIQUIDITY_PENDING", count: 0 },
            { state: "PENDING", count: 0 },
            { state: "PROCESSING", count: 0 },
            { state: "RETRY_PENDING", count: 0 },
            { state: "COMPLETED", count: 0 },
            { state: "FAILED", count: 0 },
          ],
          policies: [
            {
              appId: "app-beta",
              allowedAssets: ["CKB", "USDI"],
              maxPerRequest: "1500",
              perUserDailyMax: "4500",
              perAppDailyMax: "25000",
              cooldownSeconds: 45,
              updatedBy: "admin-2",
              createdAt: "2026-03-18T00:00:00.000Z",
              updatedAt: "2026-03-18T00:00:00.000Z",
            },
          ],
        }}
        policyFlash={{ savedAppId: "app-beta" }}
      />,
    );

    expect(html).toContain("Policy saved for app-beta");
    expect(html).toContain('data-testid="policy-form-app-beta"');
    expect(html).toContain('name="allowedAssets"');
    expect(html).toContain('name="maxPerRequest"');
    expect(html).toContain('action="/api/withdrawal-policies"');
  });

  it("replays draft values and validation feedback", () => {
    const html = renderToStaticMarkup(
      <HomePage
        initialState={{
          status: "ready",
          role: "SUPER_ADMIN",
          apps: [{ appId: "app-beta", createdAt: "2026-03-18T00:00:00.000Z" }],
          withdrawals: [],
          statusSummaries: [
            { state: "LIQUIDITY_PENDING", count: 0 },
            { state: "PENDING", count: 0 },
            { state: "PROCESSING", count: 0 },
            { state: "RETRY_PENDING", count: 0 },
            { state: "COMPLETED", count: 0 },
            { state: "FAILED", count: 0 },
          ],
          policies: [],
        }}
        policyFlash={{
          formError: "maxPerRequest must be <= perUserDailyMax",
          draft: {
            appId: "app-beta",
            allowedAssets: ["USDI"],
            maxPerRequest: "9000",
            perUserDailyMax: "4500",
            perAppDailyMax: "25000",
            cooldownSeconds: "45",
          },
        }}
      />,
    );

    expect(html).toContain("maxPerRequest must be &lt;= perUserDailyMax");
    expect(html).toContain('value="9000"');
    expect(html).toContain('name="allowedAssets" checked="" value="USDI"');
  });
});
