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
  const withdrawAmount = String(env.withdrawAmount ?? "61");
  const withdrawToAddress = String(env.withdrawToAddress ?? "");
  const initiateWithdrawal = String(env.initiateWithdrawal ?? "0") === "1";
  const artifactDir = String(env.artifactDir ?? ".");
  const authorBalanceScreenshotPath = `${artifactDir}/playwright-step5-author-dashboard.png`;
  const authorWithdrawalScreenshotPath = `${artifactDir}/playwright-step6-author-withdrawal.png`;
  const adminScreenshotPath = `${artifactDir}/playwright-step7-admin-withdrawal.png`;
  const terminalStates = ["COMPLETED", "FAILED"];
  const knownStates = ["COMPLETED", "FAILED", "PROCESSING", "RETRY_PENDING", "PENDING"];

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

  async function waitForSessionLoggedOut(timeoutMs = 30_000) {
    await page.waitForFunction(
      async () => {
        const response = await fetch("/session/current.json", {
          credentials: "same-origin",
          headers: { "x-requested-with": "XMLHttpRequest" },
        });
        return response.status === 404;
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
      const body = new URLSearchParams({
        login,
        password,
      });
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
      return {
        ok: response.ok,
        status: response.status,
        payload,
      };
    }, { login: username, password });

    const loginErrors = Array.isArray(loginResult?.payload?.errors) ? loginResult.payload.errors : [];
    if (!loginResult.ok || loginResult.payload?.error || loginErrors.length > 0) {
      const details = [
        loginResult.payload?.error,
        ...loginErrors,
      ].filter(Boolean).join("; ");
      throw new Error(`login failed for ${username}${details ? `: ${details}` : ""}`);
    }

    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    try {
      await waitForSessionLoggedIn(30_000);
    } catch (error) {
      const hasAuthError = await page
        .locator(".alert-error:visible, .login-error:visible, .error:visible")
        .first()
        .isVisible()
        .catch(() => false);
      if (hasAuthError) {
        throw new Error(`login failed for ${username}`);
      }
      throw error;
    }
  }

  async function logout(username) {
    const logoutResult = await page.evaluate(async ({ username }) => {
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

      const headers = { "x-requested-with": "XMLHttpRequest" };
      if (csrfToken) {
        headers["x-csrf-token"] = csrfToken;
      }

      const response = await fetch(`/session/${encodeURIComponent(username)}`, {
        method: "DELETE",
        credentials: "same-origin",
        headers,
      });

      return { ok: response.ok, status: response.status };
    }, { username });

    if (!logoutResult.ok) {
      throw new Error(`logout failed for ${username} (status ${logoutResult.status})`);
    }
    await page.goto(`${baseUrl}/`, { waitUntil: "domcontentloaded" });
    await waitForSessionLoggedOut(30_000);
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

  async function readAuthorBalance() {
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
      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        payload = null;
      }
      if (payload?.error) {
        return null;
      }
      return payload?.result ?? null;
    });
    return summary?.balance ?? null;
  }

  async function readAdminWithdrawal(targetWithdrawalId) {
    if (!targetWithdrawalId) {
      return { containsWithdrawalId: null, extractedState: null };
    }

    return page.evaluate(async ({ withdrawalId }) => {
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
          id: `pw-admin-dash-${Date.now()}`,
          method: "dashboard.summary",
          params: {
            includeAdmin: true,
            filters: {
              withdrawalState: "ALL",
              settlementState: "ALL",
            },
          },
        }),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        return { containsWithdrawalId: false, extractedState: null };
      }
      const rows = Array.isArray(payload?.result?.admin?.withdrawals) ? payload.result.admin.withdrawals : [];
      const row = rows.find((item) => item?.id === withdrawalId) ?? null;
      return {
        containsWithdrawalId: Boolean(row),
        extractedState: row?.state ?? null,
      };
    }, { withdrawalId: targetWithdrawalId });
  }

  async function requestWithdrawalInAuthorSession() {
    if (!withdrawToAddress) {
      throw new Error("withdrawToAddress is required when initiating withdrawal in browser");
    }
    return page.evaluate(async ({ amount, toAddress }) => {
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
          id: `pw-withdraw-${Date.now()}`,
          method: "withdrawal.request",
          params: {
            asset: "CKB",
            amount,
            toAddress,
          },
        }),
      });
      let payload = null;
      try {
        payload = await response.json();
      } catch (_error) {
        const rawBody = await response.text().catch(() => "");
        throw new Error(
          `withdrawal.request returned non-JSON response (status ${response.status}): ${rawBody.slice(0, 200)}`,
        );
      }
      if (payload?.error) {
        throw new Error(`withdrawal.request failed: ${payload.error.message || "unknown error"}`);
      }
      return {
        id: payload?.result?.id ?? null,
        state: payload?.result?.state ?? null,
      };
    }, { amount: withdrawAmount, toAddress: withdrawToAddress });
  }

  async function waitForWithdrawalState(targetWithdrawalId) {
    if (!targetWithdrawalId) {
      return { containsWithdrawalId: null, extractedState: null };
    }

    await openDashboard();
    const maxAttempts = 40;
    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
      const current = await readAdminWithdrawal(targetWithdrawalId);
      if (current.extractedState && terminalStates.includes(current.extractedState)) {
        return current;
      }
      if (current.containsWithdrawalId && current.extractedState && knownStates.includes(current.extractedState)) {
        return current;
      }
      if (attempt < maxAttempts) {
        await page.waitForTimeout(3000);
      }
    }

    return readAdminWithdrawal(targetWithdrawalId);
  }

  try {
    await login(authorUser, authorPassword);
    await openDashboard();
    const authorBalance = await readAuthorBalance();
    const authorBalanceScreenshot = await safeScreenshot(authorBalanceScreenshotPath);

    let requestedWithdrawalId = withdrawalId || null;
    let requestedWithdrawalState = null;

    if (!requestedWithdrawalId && initiateWithdrawal) {
      const requested = await requestWithdrawalInAuthorSession();
      requestedWithdrawalId = requested.id;
      requestedWithdrawalState = requested.state;
    }

    const authorWithdrawalScreenshot = await safeScreenshot(authorWithdrawalScreenshotPath);

    await logout(authorUser);
    await login(adminUser, adminPassword);
    const adminView = await waitForWithdrawalState(requestedWithdrawalId);
    const adminScreenshot = await safeScreenshot(adminScreenshotPath);

    return {
      authorUser,
      authorBalance,
      adminUser,
      withdrawalId: requestedWithdrawalId,
      withdrawalRequestedState: requestedWithdrawalState,
      adminContainsWithdrawalId: adminView.containsWithdrawalId,
      adminExtractedState: adminView.extractedState,
      screenshots: {
        authorBalance: authorBalanceScreenshot,
        authorWithdrawal: authorWithdrawalScreenshot,
        admin: adminScreenshot,
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
        authorBalance: authorBalanceScreenshotPath,
        authorWithdrawal: authorWithdrawalScreenshotPath,
        admin: adminScreenshotPath,
      },
    };
  }
}
