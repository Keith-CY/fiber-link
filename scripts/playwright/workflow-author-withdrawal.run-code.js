async (page) => {
  const env = typeof globalThis === "object" && globalThis.__PW_AUTHOR_WITHDRAWAL_ENV__ && typeof globalThis.__PW_AUTHOR_WITHDRAWAL_ENV__ === "object"
    ? globalThis.__PW_AUTHOR_WITHDRAWAL_ENV__
    : {};
  const baseUrl = String(env.baseUrl ?? "http://127.0.0.1:9292").replace(/\/+$/, "");
  const authorUser = String(env.authorUser ?? "fiber_author");
  const authorPassword = String(env.authorPassword ?? "fiber-local-pass-1");
  const withdrawAmount = String(env.withdrawAmount ?? "61");
  const withdrawToAddress = String(env.withdrawToAddress ?? "");
  const artifactDir = String(env.artifactDir ?? ".");
  const authorBalanceScreenshotPath = `${artifactDir}/playwright-step5-author-dashboard.png`;
  const authorWithdrawalScreenshotPath = `${artifactDir}/playwright-step6-author-withdrawal.png`;

  async function safeScreenshot(path) {
    try {
      await page.screenshot({ path, fullPage: false, timeout: 15000 });
      return path;
    } catch (_error) {
      return null;
    }
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

  async function login(username, password) {
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
        try {
          payload = { raw: await response.text() };
        } catch (_innerError) {
          payload = null;
        }
      }
      return { ok: response.ok, status: response.status, payload };
    }, { login: username, password });

    const loginErrors = Array.isArray(loginResult?.payload?.errors) ? loginResult.payload.errors : [];
    if (!loginResult.ok || loginResult.payload?.error || loginErrors.length > 0) {
      const details = [loginResult.payload?.error, ...loginErrors].filter(Boolean).join("; ");
      throw new Error(`login failed for ${username}${details ? `: ${details}` : ""}`);
    }

    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await waitForSessionLoggedIn(30_000);
  }

  async function openDashboard() {
    await page.goto(`${baseUrl}/fiber-link?withdrawalState=ALL&settlementState=ALL`, { waitUntil: "domcontentloaded" });
    const routingError = await page
      .getByText(/No route matches \[GET\] "\/fiber-link"/i)
      .first()
      .isVisible()
      .catch(() => false);
    if (routingError) {
      throw new Error("dashboard route /fiber-link is not available (Routing Error)");
    }
    await Promise.any([
      page.getByText(/available:/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/balance/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/tips/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/withdrawals/i).first().waitFor({ timeout: 20_000 }),
    ]).catch(() => {});
  }

  async function readAuthorDashboard() {
    const summary = await page.evaluate(async () => {
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
      const response = await fetch("/fiber-link/rpc", {
        method: "POST",
        credentials: "same-origin",
        headers,
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `pw-dash-${Date.now()}`,
          method: "dashboard.summary",
          params: {},
        }),
      });
      const payload = await response.json().catch(() => null);
      if (payload?.error) {
        return null;
      }
      return payload?.result ?? null;
    });
    return {
      balance: summary?.balance ?? null,
      tipsCount: Array.isArray(summary?.tips) ? summary.tips.length : null,
    };
  }

  async function requestWithdrawalInAuthorSession() {
    if (!withdrawToAddress) {
      throw new Error("withdrawToAddress is required when initiating withdrawal in browser");
    }
    const amountInput = page.locator('[data-fiber-link-withdrawal-input="amount"]').first();
    const addressInput = page.locator('[data-fiber-link-withdrawal-input="address"]').first();
    const submitButton = page.locator('[data-fiber-link-withdrawal-action="submit"]').first();

    await amountInput.waitFor({ timeout: 20_000 });
    await amountInput.fill(withdrawAmount);
    await addressInput.fill(withdrawToAddress);

    const withdrawalResponsePromise = page.waitForResponse(async (response) => {
      if (!response.url().includes("/fiber-link/rpc")) {
        return false;
      }
      if (response.request().method() !== "POST") {
        return false;
      }
      const body = response.request().postData() || "";
      return body.includes("\"withdrawal.request\"");
    }, { timeout: 30_000 });

    await submitButton.click();

    const response = await withdrawalResponsePromise;
    const requestPayload = response.request().postDataJSON();
    let responsePayload = null;
    try {
      responsePayload = await response.json();
    } catch (_error) {
      throw new Error(`withdrawal.request returned non-JSON response (status ${response.status()})`);
    }
    if (responsePayload?.error) {
      throw new Error(`withdrawal.request failed: ${responsePayload.error.message || "unknown error"}`);
    }

    await page.locator('[data-fiber-link-withdrawal-result="success"]').first().waitFor({ timeout: 15_000 });

    return {
      id: responsePayload?.result?.id ?? null,
      state: responsePayload?.result?.state ?? null,
      requestPayload,
      responsePayload,
    };
  }

  try {
    await login(authorUser, authorPassword);
    await openDashboard();
    const authorDashboard = await readAuthorDashboard();
    const authorBalance = authorDashboard.balance;
    const authorTipHistoryCount = authorDashboard.tipsCount;
    const authorBalanceScreenshot = await safeScreenshot(authorBalanceScreenshotPath);
    const requested = await requestWithdrawalInAuthorSession();
    const authorWithdrawalScreenshot = await safeScreenshot(authorWithdrawalScreenshotPath);

    return {
      authorUser,
      authorBalance,
      authorTipHistoryCount,
      withdrawalId: requested.id,
      withdrawalRequestedState: requested.state,
      withdrawalRequestTrace: {
        request: requested.requestPayload ?? null,
        response: requested.responsePayload ?? null,
      },
      screenshots: {
        authorBalance: authorBalanceScreenshot,
        authorWithdrawal: authorWithdrawalScreenshot,
      },
    };
  } catch (error) {
    return {
      authorUser,
      error: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
      pageUrl: page.url(),
      screenshots: {
        authorBalance: authorBalanceScreenshotPath,
        authorWithdrawal: authorWithdrawalScreenshotPath,
      },
    };
  }
}
