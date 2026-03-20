async (page) => {
  const env =
    typeof globalThis === "object" && globalThis.__PW_ADMIN_DASHBOARD_ENV__ && typeof globalThis.__PW_ADMIN_DASHBOARD_ENV__ === "object"
      ? globalThis.__PW_ADMIN_DASHBOARD_ENV__
      : {};
  const baseUrl = String(env.baseUrl ?? "http://127.0.0.1:4318").replace(/\/+$/, "");
  const artifactDir = String(env.artifactDir ?? ".");
  const appId = String(env.appId ?? "app-beta");
  const maxPerRequest = String(env.maxPerRequest ?? "1500");
  const perUserDailyMax = String(env.perUserDailyMax ?? "4500");
  const perAppDailyMax = String(env.perAppDailyMax ?? "25000");
  const cooldownSeconds = String(env.cooldownSeconds ?? "45");
  const screenshots = {
    dashboard: `${artifactDir}/01-admin-dashboard.png`,
    draft: `${artifactDir}/02-admin-dashboard-draft.png`,
    saved: `${artifactDir}/03-admin-dashboard-saved.png`,
  };

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /fiber link admin dashboard/i }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.dashboard, fullPage: true });

  const policyForm = page.locator(`[data-testid="policy-form-${appId}"]`).first();
  await policyForm.waitFor({ timeout: 20_000 });

  await policyForm.locator('input[name="allowedAssets"][value="CKB"]').uncheck();
  await policyForm.locator('input[name="allowedAssets"][value="USDI"]').check();
  await policyForm.locator('input[name="maxPerRequest"]').fill(maxPerRequest);
  await policyForm.locator('input[name="perUserDailyMax"]').fill(perUserDailyMax);
  await policyForm.locator('input[name="perAppDailyMax"]').fill(perAppDailyMax);
  await policyForm.locator('input[name="cooldownSeconds"]').fill(cooldownSeconds);
  await page.screenshot({ path: screenshots.draft, fullPage: true });

  await Promise.all([
    page.waitForURL((url) => url.searchParams.get("savedAppId") === appId, { timeout: 20_000 }),
    policyForm.getByRole("button", { name: /save policy/i }).click(),
  ]);

  await page.getByRole("status").waitFor({ timeout: 20_000 });
  await policyForm.locator('input[name="allowedAssets"][value="CKB"]').waitFor({ state: "attached", timeout: 20_000 });
  await page.screenshot({ path: screenshots.saved, fullPage: true });

  return {
    appId,
    screenshots,
    pageUrl: page.url(),
  };
}
