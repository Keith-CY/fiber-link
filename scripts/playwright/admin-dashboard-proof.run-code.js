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
  // Generous waits: the console is now multi-route, so each route triggers a
  // cold `next dev` compile plus client-side tRPC hydration on first visit.
  const WAIT = 45_000;
  const NAV_TIMEOUT = 90_000;

  // The console reads/writes over /api/trpc XHR, so the proxy must inject the
  // trusted identity headers on every request, not only document navigations.
  await page.context().setExtraHTTPHeaders({
    "x-admin-role": adminRole,
    "x-admin-user-id": adminUserId,
  });

  const gotoPath = async (path) => {
    await page.goto(`${baseUrl}${path}`, { waitUntil: "domcontentloaded", timeout: NAV_TIMEOUT });
    await page.waitForLoadState("domcontentloaded", { timeout: WAIT });
  };
  const safeShot = async (path) => {
    await page.screenshot({ path, fullPage: true, timeout: WAIT }).catch(() => {});
  };

  // 1. Overview
  await gotoPath("/");
  await page.getByRole("heading", { name: /operations overview/i }).waitFor({ timeout: WAIT });
  // Triage cards depend on the apps + withdrawals queries; treat as best-effort
  // so a slow data load never fails the proof before the screenshot is taken.
  await page.getByTestId("triage-settlement-backlog").waitFor({ timeout: WAIT }).catch(() => {});
  await safeShot(screenshots.overview);

  // 2. Ops — rate-limit change set (inline persistent result, no redirect/flash)
  await gotoPath("/ops");
  await page.locator("#windowMs").waitFor({ timeout: WAIT });
  await page.locator("#windowMs").fill(rateLimitWindowMs, { timeout: WAIT });
  await page.locator("#maxRequests").fill(rateLimitMaxRequests, { timeout: WAIT });
  await page.getByRole("button", { name: /generate change set/i }).click({ noWaitAfter: true, timeout: WAIT });
  await page.getByTestId("rate-limit-change-set").waitFor({ timeout: WAIT });
  await safeShot(screenshots.rateLimit);

  // 3. Ops — capture backup and prepare a restore plan
  await page.getByTestId("capture-backup").click({ timeout: WAIT });
  await page.getByTestId("backup-captured").waitFor({ timeout: NAV_TIMEOUT });
  await safeShot(screenshots.backup);

  await page.getByRole("button", { name: /restore plan/i }).first().click({ timeout: WAIT });
  await page.getByTestId("restore-plan").waitFor({ timeout: WAIT });
  await safeShot(screenshots.restorePlan);

  // 4. App detail — withdrawal policy edit with a persistent saved indicator
  await gotoPath(`/apps/${appId}`);
  const policyForm = page.locator(`[data-testid="policy-form-${appId}"]`).first();
  await policyForm.waitFor({ timeout: WAIT });
  await policyForm.locator('input[name="allowedAssets"][value="CKB"]').check({ timeout: WAIT });
  await policyForm.locator('input[name="allowedAssets"][value="USDI"]').check({ timeout: WAIT });
  await policyForm.locator("#maxPerRequest").fill(maxPerRequest, { timeout: WAIT });
  await policyForm.locator("#perUserDailyMax").fill(perUserDailyMax, { timeout: WAIT });
  await policyForm.locator("#perAppDailyMax").fill(perAppDailyMax, { timeout: WAIT });
  await policyForm.locator("#cooldownSeconds").fill(cooldownSeconds, { timeout: WAIT });
  await policyForm.getByRole("button", { name: /save policy/i }).click({ timeout: WAIT });
  await page.getByTestId("policy-saved").waitFor({ timeout: WAIT });
  await safeShot(screenshots.policySaved);

  return {
    appId,
    screenshots,
    pageUrl: page.url(),
  };
}
