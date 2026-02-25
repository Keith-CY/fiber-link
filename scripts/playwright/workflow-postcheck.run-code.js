async (page) => {
  const env = typeof globalThis === "object" && globalThis.__PW_DEMO_ENV__ && typeof globalThis.__PW_DEMO_ENV__ === "object"
    ? globalThis.__PW_DEMO_ENV__
    : {};
  const baseUrl = String(env.baseUrl ?? "http://127.0.0.1:4200").replace(/\/+$/, "");
  const authorUser = String(env.authorUser ?? "fiber_author");
  const authorPassword = String(env.authorPassword ?? "fiber-local-pass-1");
  const adminUser = String(env.adminUser ?? "fiber_tipper");
  const adminPassword = String(env.adminPassword ?? "fiber-local-pass-1");
  const withdrawalId = String(env.withdrawalId ?? "");
  const artifactDir = String(env.artifactDir ?? ".");
  const authorScreenshotPath = `${artifactDir}/playwright-step5-author-dashboard.png`;
  const adminScreenshotPath = `${artifactDir}/playwright-step6-admin-withdrawal.png`;

  async function login(username, password) {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    const openLoginButton = page.getByRole("button", { name: /log in/i }).first();
    await openLoginButton.waitFor({ timeout: 20_000 });
    await openLoginButton.click();

    const usernameInput = page.locator("#login-account-name:visible, #signin-account-name:visible, input[name='login']:visible").first();
    const passwordInput = page.locator("#login-password:visible, #signin_password:visible, input[type='password']:visible").first();
    await usernameInput.waitFor({ timeout: 20_000 });
    await usernameInput.fill(username);
    await passwordInput.fill(password);

    const submitButton = page.locator("button#login-button, button:has-text('Log In')").first();
    await submitButton.click();
    await page.getByRole("button", { name: /notifications and account/i }).first().waitFor({ timeout: 20_000 });
  }

  async function logout() {
    const accountButton = page.getByRole("button", { name: /notifications and account/i }).first();
    await accountButton.waitFor({ timeout: 20_000 });
    await accountButton.click();

    const logoutButton = page.locator("button, a").filter({ hasText: /log out/i }).first();
    await logoutButton.waitFor({ timeout: 10_000 });
    await logoutButton.click();

    const loginButton = page.getByRole("button", { name: /log in/i }).first();
    await loginButton.waitFor({ timeout: 20_000 });
  }

  try {
    await login(authorUser, authorPassword);
    await page.goto(`${baseUrl}/fiber-link`, { waitUntil: "domcontentloaded" });
    await Promise.any([
      page.getByText(/balance/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/tips/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/withdrawals/i).first().waitFor({ timeout: 20_000 }),
    ]).catch(() => {});

    const authorBalance = await page.evaluate(() => {
      const text = document.body.innerText || "";
      const match = text.match(/balance[^0-9]*([0-9]+(?:\.[0-9]+)?)/i);
      return match ? match[1] : null;
    });

    await page.screenshot({ path: authorScreenshotPath, fullPage: true });

    await logout();
    await login(adminUser, adminPassword);
    await page.goto(`${baseUrl}/fiber-link`, { waitUntil: "domcontentloaded" });
    await Promise.any([
      page.getByText(/withdrawals/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/settlements/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/pipeline/i).first().waitFor({ timeout: 20_000 }),
    ]).catch(() => {});

    const adminView = await page.evaluate((wid) => {
      const text = document.body.innerText || "";
      const states = ["COMPLETED", "PROCESSING", "RETRY_PENDING", "FAILED", "PENDING"];

      let extractedState = null;
      if (wid) {
        const idx = text.indexOf(wid);
        if (idx >= 0) {
          const around = text.slice(Math.max(0, idx - 200), Math.min(text.length, idx + 400));
          extractedState = states.find((state) => around.includes(state)) ?? null;
        }
      }

      return {
        containsWithdrawalId: wid ? text.includes(wid) : null,
        extractedState,
      };
    }, withdrawalId);

    await page.screenshot({ path: adminScreenshotPath, fullPage: true });

    return {
      authorUser,
      authorBalance,
      adminUser,
      withdrawalId: withdrawalId || null,
      adminContainsWithdrawalId: adminView.containsWithdrawalId,
      adminExtractedState: adminView.extractedState,
      screenshots: {
        author: authorScreenshotPath,
        admin: adminScreenshotPath,
      },
    };
  } catch (error) {
    return {
      authorUser,
      adminUser,
      withdrawalId: withdrawalId || null,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      pageUrl: page.url(),
      screenshots: {
        author: authorScreenshotPath,
        admin: adminScreenshotPath,
      },
    };
  }
}
