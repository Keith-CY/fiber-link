async (page) => {
  const env = typeof globalThis === "object" && globalThis.__PW_DEMO_ENV__ && typeof globalThis.__PW_DEMO_ENV__ === "object"
    ? globalThis.__PW_DEMO_ENV__
    : {};
  const baseUrl = String(env.baseUrl ?? "http://127.0.0.1:4200").replace(/\/+$/, "");
  const username = String(env.username ?? "fiber_tipper");
  const password = String(env.password ?? "fiber-local-pass-1");
  const topicTitle = String(env.topicTitle ?? "Fiber Link Local Workflow Topic");
  const topicPath = String(env.topicPath ?? "");
  const tipAmount = String(env.tipAmount ?? "31");
  const artifactDir = String(env.artifactDir ?? ".");
  const screenshotPath = `${artifactDir}/playwright-step4-tip-modal.png`;

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

  if (topicPath.trim()) {
    const normalizedPath = topicPath.startsWith("/") ? topicPath : `/${topicPath}`;
    await page.goto(`${baseUrl}${normalizedPath}`, { waitUntil: "domcontentloaded" });
  } else {
    await page.goto(`${baseUrl}/latest`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: topicTitle }).first().click();
  }

  const tipButton = page.getByRole("button", { name: /^tip$/i }).first();
  await tipButton.waitFor({ timeout: 20_000 });
  await tipButton.click();

  const amountInput = page.getByLabel(/amount/i).first();
  await amountInput.waitFor({ timeout: 15_000 });
  await amountInput.fill(tipAmount);

  await page.getByRole("button", { name: /generate invoice/i }).first().click();
  await page.getByText(/pending/i).first().waitFor({ timeout: 30_000 });

  const invoice = await page.evaluate(() => {
    const text = document.body.innerText || "";
    const match = text.match(/\bfib[a-z0-9]{40,}\b/i);
    return match ? match[0] : null;
  });

  await page.screenshot({ path: screenshotPath, fullPage: false });

  return {
    user: username,
    topicTitle,
    tipAmount,
    invoice,
    screenshotPath,
    pageUrl: page.url(),
  };
}
