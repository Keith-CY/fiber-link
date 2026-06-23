async (page) => {
  const env =
    typeof globalThis === "object" && globalThis.__PW_ADMIN_DASHBOARD_ENV__ && typeof globalThis.__PW_ADMIN_DASHBOARD_ENV__ === "object"
      ? globalThis.__PW_ADMIN_DASHBOARD_ENV__
      : {};
  const baseUrl = String(env.baseUrl ?? "http://127.0.0.1:4318").replace(/\/+$/, "");
  const artifactDir = String(env.artifactDir ?? ".");
  const appId = String(env.appId ?? "app-beta");
  const adminRole = String(env.adminRole ?? "SUPER_ADMIN");
  const adminUserId = String(env.adminUserId ?? "proof-admin");
  const maxPerRequest = String(env.maxPerRequest ?? "1500");
  const perUserDailyMax = String(env.perUserDailyMax ?? "4500");
  const perAppDailyMax = String(env.perAppDailyMax ?? "25000");
  const cooldownSeconds = String(env.cooldownSeconds ?? "45");
  const rateLimitWindowMs = String(env.rateLimitWindowMs ?? "90000");
  const rateLimitMaxRequests = String(env.rateLimitMaxRequests ?? "500");
  const screenshots = {
    overview: `${artifactDir}/01-operations-overview.png`,
    rateLimit: `${artifactDir}/02-rate-limit-change-set.png`,
    backup: `${artifactDir}/03-backup-captured.png`,
    restorePlan: `${artifactDir}/04-restore-plan.png`,
    policySaved: `${artifactDir}/05-policy-saved.png`,
  };

  // The console now reads/writes over /api/trpc, so the proxy must inject the
  // trusted identity headers on XHR (not only document loads). We set them at
  // the context level to mirror that.
  await page.context().setExtraHTTPHeaders({
    "x-admin-role": adminRole,
    "x-admin-user-id": adminUserId,
  });

  const gotoPath = async (path) => {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded" });
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
  };

  // 1. Overview
  await gotoPath("/");
  await page.getByRole("heading", { name: /operations overview/i }).waitFor({ timeout: 20_000 });
  await page.getByTestId("triage-settlement-backlog").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.overview, fullPage: true });

  // 2. Ops — rate-limit change set (inline result, no redirect/flash)
  await gotoPath("/ops");
  await page.locator("#windowMs").fill(rateLimitWindowMs);
  await page.locator("#maxRequests").fill(rateLimitMaxRequests);
  await page.getByRole("button", { name: /generate change set/i }).click({ noWaitAfter: true });
  await page.getByTestId("rate-limit-change-set").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.rateLimit, fullPage: true });

  // 3. Ops — capture backup and prepare a restore plan
  await page.getByTestId("capture-backup").click();
  await page.getByText(/backup captured/i).first().waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.backup, fullPage: true });

  await page.getByRole("button", { name: /restore plan/i }).first().click();
  await page.getByTestId("restore-plan").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.restorePlan, fullPage: true });

  // 4. App detail — withdrawal policy edit with an inline success toast
  await gotoPath(`/apps/${appId}`);
  const policyForm = page.locator(`[data-testid="policy-form-${appId}"]`).first();
  await policyForm.waitFor({ timeout: 20_000 });
  await policyForm.locator('input[name="allowedAssets"][value="CKB"]').check();
  await policyForm.locator('input[name="allowedAssets"][value="USDI"]').check();
  await policyForm.locator("#maxPerRequest").fill(maxPerRequest);
  await policyForm.locator("#perUserDailyMax").fill(perUserDailyMax);
  await policyForm.locator("#perAppDailyMax").fill(perAppDailyMax);
  await policyForm.locator("#cooldownSeconds").fill(cooldownSeconds);
  await policyForm.getByRole("button", { name: /save policy/i }).click();
  await page.getByText(new RegExp(`policy saved for ${appId}`, "i")).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.policySaved, fullPage: true });

  return {
    appId,
    screenshots,
    pageUrl: page.url(),
  };
}
