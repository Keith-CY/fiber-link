async (page) => {
  const env = typeof globalThis === "object" && globalThis.__PW_FLOW12_ENV__ && typeof globalThis.__PW_FLOW12_ENV__ === "object"
    ? globalThis.__PW_FLOW12_ENV__
    : {};
  const baseUrl = String(env.baseUrl ?? "http://127.0.0.1:4200").replace(/\/+$/, "");
  const username = String(env.username ?? "fiber_tipper");
  const password = String(env.password ?? "fiber-local-pass-1");
  const topicTitle = String(env.topicTitle ?? "Fiber Link Local Workflow Topic");
  const topicPath = String(env.topicPath ?? "");
  const tipAmount = String(env.tipAmount ?? "31");
  const artifactDir = String(env.artifactDir ?? ".");

  const tipButtonScreenshotPath = `${artifactDir}/playwright-flow1-tip-button.png`;
  const tipModalScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-invoice.png`;

  async function rpcCall(method, params) {
    return page.evaluate(async ({ method, params }) => {
      let csrfToken = null;
      try {
        const csrfResponse = await fetch("/session/csrf.json", {
          credentials: "same-origin",
          headers: { "x-requested-with": "XMLHttpRequest" },
        });
        const csrfPayload = await csrfResponse.json();
        csrfToken = csrfPayload?.csrf ?? null;
      } catch (_error) {
        csrfToken = null;
      }
      if (!csrfToken) {
        csrfToken = document.querySelector("meta[name='csrf-token']")?.getAttribute("content");
      }
      const headers = {
        "content-type": "application/json",
        "x-requested-with": "XMLHttpRequest",
      };
      if (csrfToken) {
        headers["x-csrf-token"] = csrfToken;
      }
      const requestPayload = {
        jsonrpc: "2.0",
        id: `pw-flow12-${method}-${Date.now()}`,
        method,
        params,
      };
      const response = await fetch("/fiber-link/rpc", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify(requestPayload),
      });
      let payload = null;
      let bodyText = "";
      try {
        payload = await response.json();
      } catch (_error) {
        bodyText = await response.text().catch(() => "");
      }
      return {
        ok: response.ok && !payload?.error,
        status: response.status,
        request: requestPayload,
        response: payload,
        rawBody: bodyText ? bodyText.slice(0, 500) : null,
      };
    }, { method, params });
  }

  await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });

  const accountButton = page.getByRole("button", { name: /notifications and account/i }).first();
  const alreadyLoggedIn = await accountButton.isVisible().catch(() => false);

  if (!alreadyLoggedIn) {
    let usernameInput = page.locator("#login-account-name:visible, #signin-account-name:visible, input[name='login']:visible").first();
    let passwordInput = page.locator("#login-password:visible, #signin_password:visible, input[type='password']:visible").first();
    const directFormVisible = await usernameInput.isVisible().catch(() => false);

    if (!directFormVisible) {
      const openLoginButton = page.getByRole("button", { name: /log in/i }).first();
      const openLoginButtonVisible = await openLoginButton.isVisible().catch(() => false);
      if (openLoginButtonVisible) {
        await openLoginButton.click();
      }
      usernameInput = page.locator("#login-account-name:visible, #signin-account-name:visible, input[name='login']:visible").first();
      passwordInput = page.locator("#login-password:visible, #signin_password:visible, input[type='password']:visible").first();
    }

    await usernameInput.waitFor({ timeout: 30_000 });
    await usernameInput.fill(username);
    await passwordInput.fill(password);

    const submitButton = page.locator("button#login-button, button:has-text('Log In')").first();
    await submitButton.click();
    await accountButton.waitFor({ timeout: 20_000 });
  }

  if (topicPath.trim()) {
    const normalizedPath = topicPath.startsWith("/") ? topicPath : `/${topicPath}`;
    await page.goto(`${baseUrl}${normalizedPath}`, { waitUntil: "domcontentloaded" });
  } else {
    await page.goto(`${baseUrl}/latest`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: topicTitle }).first().click();
  }

  const tipButton = page.getByRole("button", { name: /^tip$/i }).first();
  await tipButton.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: tipButtonScreenshotPath, fullPage: false });
  await tipButton.click();

  const amountInput = page.getByLabel(/amount/i).first();
  await amountInput.waitFor({ timeout: 15_000 });
  await amountInput.fill(tipAmount);

  await page.getByRole("button", { name: /generate invoice/i }).first().click();

  const invoiceLocator = page.locator(".fiber-link-tip-invoice").first();
  const invoice = await invoiceLocator
    .waitFor({ timeout: 30_000 })
    .then(async () => {
      const text = (await invoiceLocator.innerText()).trim();
      const match = text.match(/\b(?:fib[a-z0-9]{20,}|ln[a-z0-9]{20,})\b/i);
      if (match) {
        return match[0];
      }
      return text.length > 0 ? text : null;
    })
    .catch(() => null);

  await page.screenshot({ path: tipModalScreenshotPath, fullPage: false });

  const dashboardSummary = await rpcCall("dashboard.summary", {});
  const tipStatus = invoice
    ? await rpcCall("tip.status", { invoice })
    : {
      ok: false,
      status: 0,
      request: null,
      response: null,
      rawBody: "invoice is empty; skipped tip.status",
    };

  return {
    user: username,
    topicTitle,
    tipAmount,
    invoice,
    pageUrl: page.url(),
    screenshots: {
      tipButton: tipButtonScreenshotPath,
      tipModal: tipModalScreenshotPath,
    },
    rpc: {
      dashboardSummary,
      tipStatus,
    },
  };
}
