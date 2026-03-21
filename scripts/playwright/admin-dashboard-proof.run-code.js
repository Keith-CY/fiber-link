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
  const rateLimitWindowMs = String(env.rateLimitWindowMs ?? "90000");
  const rateLimitMaxRequests = String(env.rateLimitMaxRequests ?? "500");
  const screenshots = {
    dashboard: `${artifactDir}/01-operations-overview.png`,
    rateLimit: `${artifactDir}/02-rate-limit-change-set.png`,
    backup: `${artifactDir}/03-backup-captured.png`,
    restorePlan: `${artifactDir}/04-restore-plan.png`,
    policySaved: `${artifactDir}/05-policy-saved.png`,
  };
  const submitAndWaitForUrl = async (button, matchesUrl) => {
    await Promise.all([
      page.waitForURL(matchesUrl, { timeout: 20_000 }),
      button.click({ noWaitAfter: true }),
    ]);
    await page.waitForLoadState("domcontentloaded", { timeout: 20_000 });
  };

  await page.goto(baseUrl, { waitUntil: "domcontentloaded" });
  await page.getByRole("heading", { name: /fiber link admin dashboard/i }).waitFor({ timeout: 20_000 });
  await page.getByRole("heading", { name: /operations overview/i }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.dashboard, fullPage: true });

  const rateLimitForm = page.locator('form[action="/api/runtime-policies/rate-limit"]').first();
  await rateLimitForm.locator('input[name="windowMs"]').fill(rateLimitWindowMs);
  await rateLimitForm.locator('input[name="maxRequests"]').fill(rateLimitMaxRequests);
  await submitAndWaitForUrl(
    rateLimitForm.getByRole("button", { name: /generate rate-limit change set/i }),
    (url) => url.searchParams.has("rateLimitEnvSnippet"),
  );
  await page.getByRole("heading", { name: /generated change set/i }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.rateLimit, fullPage: true });

  await submitAndWaitForUrl(
    page.getByRole("button", { name: /capture backup/i }),
    (url) => url.searchParams.get("backupCaptureStatus") === "success",
  );
  await page.getByRole("status").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.backup, fullPage: true });

  await submitAndWaitForUrl(
    page.getByRole("button", { name: /generate restore plan/i }).first(),
    (url) => url.searchParams.has("restoreCommand"),
  );
  await page.getByRole("heading", { name: /restore plan/i }).waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.restorePlan, fullPage: true });

  const policyForm = page.locator(`[data-testid="policy-form-${appId}"]`).first();
  await policyForm.waitFor({ timeout: 20_000 });
  await policyForm.locator('input[name="allowedAssets"][value="CKB"]').check();
  await policyForm.locator('input[name="allowedAssets"][value="USDI"]').check();
  await policyForm.locator('input[name="maxPerRequest"]').fill(maxPerRequest);
  await policyForm.locator('input[name="perUserDailyMax"]').fill(perUserDailyMax);
  await policyForm.locator('input[name="perAppDailyMax"]').fill(perAppDailyMax);
  await policyForm.locator('input[name="cooldownSeconds"]').fill(cooldownSeconds);
  await submitAndWaitForUrl(
    policyForm.getByRole("button", { name: /save policy/i }),
    (url) => url.searchParams.get("savedAppId") === appId,
  );
  await page.getByRole("status").waitFor({ timeout: 20_000 });
  await page.screenshot({ path: screenshots.policySaved, fullPage: true });

  return {
    appId,
    screenshots,
    pageUrl: page.url(),
  };
}
