import { describe, expect, it } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import HomePage from "../pages/index";

describe("dashboard page", () => {
  it("renders operation admin sections for SUPER_ADMIN", () => {
    const AnyHomePage = HomePage as React.ComponentType<any>;
    const html = renderToStaticMarkup(
      <AnyHomePage
        initialState={{
          status: "ready",
          role: "SUPER_ADMIN",
          apps: [{ appId: "app-beta", createdAt: "2026-03-18T00:00:00.000Z" }],
          withdrawals: [],
          statusSummaries: [
            { state: "LIQUIDITY_PENDING", count: 1 },
            { state: "PENDING", count: 0 },
            { state: "PROCESSING", count: 0 },
            { state: "RETRY_PENDING", count: 0 },
            { state: "COMPLETED", count: 2 },
            { state: "FAILED", count: 1 },
          ],
          policies: [],
          operations: {
            monitoring: {
              status: "ready",
              summary: {
                status: "alert",
                generatedAt: "2026-03-21T08:00:00.000Z",
                readinessStatus: "ready",
                unpaidBacklog: 8,
                retryPendingCount: 1,
                withdrawalParityIssueCount: 0,
                alertCount: 1,
              },
            },
            rateLimit: {
              status: "ready",
              config: {
                enabled: true,
                windowMs: "60000",
                maxRequests: "300",
                redisUrl: "redis://redis:6379/1",
                sourceLabel: "deploy/compose/.env",
              },
            },
            backups: {
              status: "ready",
              bundles: [
                {
                  id: "20260321T080000Z",
                  generatedAt: "20260321T080000Z",
                  overallStatus: "PASS",
                  retentionDays: 30,
                  dryRun: false,
                  backupDir: "/tmp/backups/20260321T080000Z",
                  archiveFile: "/tmp/backups/20260321T080000Z.tar.gz",
                },
              ],
            },
          },
        }}
        operationFlash={{
          rateLimitChangeSet: {
            changedKeys: ["RPC_RATE_LIMIT_WINDOW_MS", "RPC_RATE_LIMIT_MAX_REQUESTS"],
            envSnippet: "RPC_RATE_LIMIT_WINDOW_MS=90000\nRPC_RATE_LIMIT_MAX_REQUESTS=500",
            rollbackSnippet: "RPC_RATE_LIMIT_WINDOW_MS=60000\nRPC_RATE_LIMIT_MAX_REQUESTS=300",
          },
          backupRestorePlan: {
            backupId: "20260321T080000Z",
            command:
              "scripts/restore-compose-backup.sh --backup /tmp/backups/20260321T080000Z.tar.gz --yes",
          },
        }}
      />,
    );

    expect(html).toContain('class="dashboard-shell"');
    expect(html).toContain('class="hero-panel"');
    expect(html).toContain("Operations overview");
    expect(html).toContain("Monitoring");
    expect(html).toContain("Global rate limiting");
    expect(html).toContain("Backups");
    expect(html).toContain("Generate rate-limit change set");
    expect(html).toContain("Capture backup");
    expect(html).toContain("Restore plan");
    expect(html).toContain("RPC_RATE_LIMIT_WINDOW_MS=90000");
    expect(html).toContain("scripts/restore-compose-backup.sh");
  });

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

  it("hides global operation controls for COMMUNITY_ADMIN", () => {
    const AnyHomePage = HomePage as React.ComponentType<any>;
    const html = renderToStaticMarkup(
      <AnyHomePage
        initialState={{
          status: "ready",
          role: "COMMUNITY_ADMIN",
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
      />,
    );

    expect(html).not.toContain("Global rate limiting");
    expect(html).not.toContain("Capture backup");
    expect(html).not.toContain("Operations overview");
  });
});
