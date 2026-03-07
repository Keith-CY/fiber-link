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

  async function waitForSessionLoggedIn(timeoutMs = 30_000) {
    await page.waitForFunction(
      async () => {
        const response = await fetch("/session/current.json", {
          credentials: "same-origin",
          headers: { "x-requested-with": "XMLHttpRequest" },
        });
        if (!response.ok) {
          return false;
        }
        const payload = await response.json().catch(() => null);
        return Boolean(payload?.current_user?.id);
      },
      undefined,
      { timeout: timeoutMs },
    );
  }

  async function login(loginUsername, loginPassword) {
    await page.goto(`${baseUrl}/login`, { waitUntil: "domcontentloaded" });
    const loginResult = await page.evaluate(async ({ login, password }) => {
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
        "content-type": "application/x-www-form-urlencoded; charset=UTF-8",
        "x-requested-with": "XMLHttpRequest",
      };
      if (csrfToken) {
        headers["x-csrf-token"] = csrfToken;
      }
      const body = new URLSearchParams({ login, password });
      const response = await fetch("/session", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: body.toString(),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }
      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    }, { login: loginUsername, password: loginPassword });

    const loginErrors = Array.isArray(loginResult?.payload?.errors) ? loginResult.payload.errors : [];
    if (!loginResult.ok || loginResult.payload?.error || loginErrors.length > 0) {
      const details = [loginResult.payload?.error, ...loginErrors].filter(Boolean).join("; ");
      throw new Error(`login failed for ${loginUsername}${details ? `: ${details}` : ""}`);
    }

    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await waitForSessionLoggedIn(30_000);
  }

  await login(username, password);

  if (topicPath.trim()) {
    const normalizedPath = topicPath.startsWith("/") ? topicPath : `/${topicPath}`;
    await page.goto(`${baseUrl}${normalizedPath}`, { waitUntil: "domcontentloaded" });
  } else {
    await page.goto(`${baseUrl}/latest`, { waitUntil: "domcontentloaded" });
    await page.getByRole("link", { name: topicTitle }).first().click();
  }

  const tipButton = page
    .locator(
      ".fiber-link-tip-entry__button:visible, .post-action-menu__fiber-link-tip:visible, button[aria-label='Tip']:visible",
    )
    .first();
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
