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
  const tipMessage = String(env.tipMessage ?? "Great post!");
  const artifactDir = String(env.artifactDir ?? ".");
  const payerRpcUrl = String(env.payerRpcUrl ?? "http://127.0.0.1:9227").trim();
  const paymentCurrency = String(env.paymentCurrency ?? "Fibt").trim() || "Fibt";
  const settleInvoice = String(env.settleInvoice ?? "1") !== "0";
  const viewportWidth = Number.parseInt(String(env.viewportWidth ?? "2560"), 10);
  const viewportHeight = Number.parseInt(String(env.viewportHeight ?? "1440"), 10);
  const viewport = {
    width: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 2560,
    height: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1440,
  };

  const tipButtonScreenshotPath = `${artifactDir}/playwright-flow1-tip-button.png`;
  const forumEntryPointsScreenshotPath = `${artifactDir}/playwright-step1-forum-tip-entrypoints.png`;
  const topicThreadScreenshotPath = `${artifactDir}/playwright-step2-topic-and-reply.png`;
  const tipModalStepGenerateScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-step1-generate.png`;
  const tipModalStepPayScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-step2-pay.png`;
  const tipModalScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-invoice.png`;
  const tipModalStepConfirmedScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-step3-confirmed.png`;
  const tipperDashboardScreenshotPath = `${artifactDir}/playwright-step4-tipper-dashboard.png`;
  const tipButtonMissingScreenshotPath = `${artifactDir}/playwright-flow12-tip-button-missing.png`;
  const topicThreadMissingScreenshotPath = `${artifactDir}/playwright-flow12-topic-thread-missing.png`;
  const topicThreadWaitTimeoutMs = 60_000;
  const tipButtonWaitTimeoutMs = 45_000;

  function buildRpcId(prefix) {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return `${prefix}-${crypto.randomUUID()}`;
    }
    return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function toHexIntegerString(value) {
    const normalized = String(value).trim();
    if (!/^\d+$/.test(normalized)) {
      throw new Error(`tip amount must be a positive integer for payer settlement, got '${value}'`);
    }
    return `0x${BigInt(normalized).toString(16)}`;
  }

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

  async function payerRpcCall(method, params) {
    const requestPayload = {
      jsonrpc: "2.0",
      id: buildRpcId(`pw-flow12-${method}`),
      method,
      params,
    };
    const response = await page.context().request.post(payerRpcUrl, {
      headers: { "content-type": "application/json" },
      data: requestPayload,
    });
    const payload = await response.json().catch(() => null);
    return {
      ok: response.ok() && !payload?.error,
      status: response.status(),
      request: requestPayload,
      response: payload,
    };
  }

  async function settleInvoiceFromPayer(invoice) {
    const parseInvoiceResult = await payerRpcCall("parse_invoice", [{ invoice }]);
    if (!parseInvoiceResult.ok) {
      throw new Error(`parse_invoice failed (${parseInvoiceResult.status})`);
    }

    const invoiceData = parseInvoiceResult.response?.result?.invoice?.data ?? {};
    const attrs = Array.isArray(invoiceData?.attrs) ? invoiceData.attrs : [];
    const paymentHash = invoiceData?.payment_hash;
    const targetPubkey = attrs.find((entry) => typeof entry?.payee_public_key === "string")?.payee_public_key ?? "";
    const finalTlcExpiryDelta = attrs.find((entry) => entry?.final_htlc_minimum_expiry_delta != null)?.final_htlc_minimum_expiry_delta;

    if (!paymentHash) {
      throw new Error("parse_invoice did not return payment_hash");
    }

    const paymentParams = {
      payment_hash: paymentHash,
      amount: toHexIntegerString(tipAmount),
      currency: paymentCurrency,
      request_id: buildRpcId("pw-flow12-send-payment"),
      invoice,
      allow_self_payment: true,
    };
    if (targetPubkey) {
      paymentParams.target_pubkey = targetPubkey;
    }
    if (finalTlcExpiryDelta !== undefined && finalTlcExpiryDelta !== null && finalTlcExpiryDelta !== "") {
      paymentParams.final_tlc_expiry_delta = finalTlcExpiryDelta;
    }

    const sendPaymentResult = await payerRpcCall("send_payment", [paymentParams]);
    if (!sendPaymentResult.ok) {
      const errorMessage = sendPaymentResult.response?.error?.message ?? "send_payment failed";
      throw new Error(errorMessage);
    }

    return {
      parseInvoiceResult,
      sendPaymentResult,
      txHash:
        sendPaymentResult.response?.result?.tx_hash ??
        sendPaymentResult.response?.result?.txHash ??
        sendPaymentResult.response?.result?.payment_hash ??
        sendPaymentResult.response?.result?.paymentHash ??
        sendPaymentResult.response?.result?.hash ??
        null,
    };
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

  async function collectPageDiagnostics() {
    return page.evaluate(() => ({
      url: window.location.href,
      title: document.title,
      topicPosts: document.querySelectorAll(".topic-post, article.topic-post, .topic-body").length,
      topicLinks: Array.from(document.querySelectorAll("a[href*='/t/']")).slice(0, 5).map((element) => ({
        href: element.getAttribute("href"),
        text: (element.textContent || "").trim(),
      })),
      bodyPreview: (document.body?.innerText || "").replace(/\s+/g, " ").slice(0, 500),
    }));
  }

  async function waitForAnyOrThrow(waiters, errorMessage) {
    try {
      await Promise.any(waiters);
      return;
    } catch (error) {
      const diagnostics = await collectPageDiagnostics().catch(() => ({
        url: page.url(),
        title: null,
        topicPosts: 0,
        topicLinks: [],
        bodyPreview: null,
      }));
      throw new Error(`${errorMessage}: ${JSON.stringify({
        diagnostics,
        promiseErrors: Array.isArray(error?.errors)
          ? error.errors.map((entry) => (entry instanceof Error ? entry.message : String(entry)))
          : [],
      })}`);
    }
  }

  async function waitForTopicThread(title) {
    const escapedBaseUrl = baseUrl.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const topicUrlPattern = new RegExp(`^${escapedBaseUrl}/t/`, "i");
    const topicPostLocator = page.locator(".topic-post, article.topic-post, .topic-body").first();
    let lastDiagnostics = null;

    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        await Promise.any([
          page.waitForURL(topicUrlPattern, { timeout: topicThreadWaitTimeoutMs }),
          topicPostLocator.waitFor({ timeout: topicThreadWaitTimeoutMs }),
          page.getByRole("heading", { name: title }).first().waitFor({ timeout: topicThreadWaitTimeoutMs }),
        ]);
        await page.waitForLoadState("domcontentloaded", { timeout: 10_000 }).catch(() => {});
        await page.waitForLoadState("networkidle", { timeout: 10_000 }).catch(() => {});
        await topicPostLocator.waitFor({ timeout: topicThreadWaitTimeoutMs });
        return;
      } catch (_error) {
        lastDiagnostics = await collectPageDiagnostics().catch(() => ({
          url: page.url(),
          title: null,
          topicPosts: 0,
          topicLinks: [],
          bodyPreview: null,
        }));
        if (attempt < 2) {
          await page.waitForTimeout(5_000);
          await page.reload({ waitUntil: "domcontentloaded" });
          continue;
        }
      }
    }

    await page.screenshot({ path: topicThreadMissingScreenshotPath, fullPage: true, timeout: 20_000 }).catch(() => {});
    throw new Error(`topic thread did not load for "${title}": ${JSON.stringify(lastDiagnostics)}`);
  }

  async function clickTopicLink(topicLink) {
    await topicLink.scrollIntoViewIfNeeded().catch(() => {});
    await Promise.allSettled([
      page.waitForURL(/\/t\//i, { timeout: 20_000 }),
      topicLink.click(),
    ]);
  }

  async function waitForTopicLink(linkLocator, { timeoutMs = 90_000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    let lastError = null;

    while (Date.now() < deadline) {
      try {
        await linkLocator.waitFor({ timeout: 5_000 });
        return;
      } catch (error) {
        lastError = error;
      }

      await page.waitForTimeout(5_000);
      if (Date.now() < deadline) {
        await page.reload({ waitUntil: "domcontentloaded" }).catch(() => {});
      }
    }

    if (lastError) {
      throw lastError;
    }

    await linkLocator.waitFor({ timeout: 1 });
  }

  async function openTopicByTitle(title, fallbackPath = "") {
    await page.goto(`${baseUrl}/latest`, { waitUntil: "domcontentloaded" });

    const latestTopicLink = page.getByRole("link", { name: title }).first();
    try {
      await waitForTopicLink(latestTopicLink);
      await clickTopicLink(latestTopicLink);
      await waitForTopicThread(title);
      return;
    } catch (_error) {
      // Fallback to search when the latest list has not rendered or the topic is not visible yet.
    }

    await page.goto(`${baseUrl}/search?q=${encodeURIComponent(title)}`, { waitUntil: "domcontentloaded" });
    const searchTopicLink = page.getByRole("link", { name: title }).first();
    try {
      await waitForTopicLink(searchTopicLink);
      await clickTopicLink(searchTopicLink);
      await waitForTopicThread(title);
      return;
    } catch (_error) {
      if (!fallbackPath.trim()) {
        throw _error;
      }
    }

    const normalizedPath = fallbackPath.startsWith("/") ? fallbackPath : `/${fallbackPath}`;
    await page.goto(`${baseUrl}${normalizedPath}`, { waitUntil: "domcontentloaded" });
    await waitForTopicThread(title);
  }

  async function screenshotHighlightedPosts(path, { fullPage = false } = {}) {
    const highlightedCount = await page.evaluate(() => {
      const buttons = Array.from(
        document.querySelectorAll(
          "[data-fiber-link-tip-button], .fiber-link-tip-entry__button, .post-action-menu__fiber-link-tip, button[aria-label='Tip']",
        ),
      ).filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });

      const targets = [];
      for (const button of buttons.slice(0, 2)) {
        const container =
          button.closest(".topic-post") ??
          button.closest(".topic-body") ??
          button.closest("article") ??
          button;
        if (!container || targets.includes(container)) {
          continue;
        }
        container.setAttribute("data-fiber-link-visual-acceptance-target", "true");
        container.style.outline = "3px solid #1d9bf0";
        container.style.outlineOffset = "6px";
        targets.push(container);
      }
      return targets.length;
    });

    if (!highlightedCount) {
      throw new Error("expected at least one visible tip entry point before screenshot");
    }

    await page.waitForTimeout(300);
    await page.screenshot({ path, fullPage, timeout: 20_000 });
    await page.evaluate(() => {
      for (const target of Array.from(document.querySelectorAll("[data-fiber-link-visual-acceptance-target='true']"))) {
        target.style.outline = "";
        target.style.outlineOffset = "";
        target.removeAttribute("data-fiber-link-visual-acceptance-target");
      }
    });
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

    await waitForAnyOrThrow([
      page.getByText(/fiber link dashboard/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/payments/i).first().waitFor({ timeout: 20_000 }),
      page.getByText(/balance/i).first().waitFor({ timeout: 20_000 }),
    ], "dashboard did not load expected content");
  }

  async function collectTipButtonDiagnostics() {
    const pageDiagnostics = await collectPageDiagnostics();
    const buttonDiagnostics = await page.evaluate(() => {
      const selector = "[data-fiber-link-tip-button], .fiber-link-tip-entry__button, .post-action-menu__fiber-link-tip, button[aria-label='Tip']";
      const buttons = Array.from(document.querySelectorAll(selector));
      const visibleButtons = buttons.filter((element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      });
      return {
        totalTipButtons: buttons.length,
        visibleTipButtons: visibleButtons.length,
        visibleTipButtonLabels: visibleButtons.map((element) =>
          (element.getAttribute("aria-label") || element.textContent || "").trim(),
        ),
      };
    });

    return { ...pageDiagnostics, ...buttonDiagnostics };
  }

  await page.setViewportSize(viewport);
  await login(username, password);

  await openTopicByTitle(topicTitle, topicPath);

  const tipButton = page
    .locator(
      "[data-fiber-link-tip-button]:visible, .fiber-link-tip-entry__button:visible, .post-action-menu__fiber-link-tip:visible, button[aria-label='Tip']:visible",
    )
    .first();
  try {
    await tipButton.waitFor({ timeout: tipButtonWaitTimeoutMs });
  } catch (_error) {
    await page.screenshot({ path: tipButtonMissingScreenshotPath, fullPage: true, timeout: 20_000 }).catch(() => {});
    const diagnostics = await collectTipButtonDiagnostics().catch(() => ({
      url: page.url(),
      title: null,
      topicPosts: 0,
      totalTipButtons: 0,
      visibleTipButtons: 0,
      visibleTipButtonLabels: [],
      bodyPreview: null,
    }));
    throw new Error(`tip button not visible after topic load: ${JSON.stringify(diagnostics)}`);
  }
  await screenshotHighlightedPosts(forumEntryPointsScreenshotPath, { fullPage: false });
  await screenshotHighlightedPosts(topicThreadScreenshotPath, { fullPage: true });
  await tipButton.evaluate((element) => {
    element.scrollIntoView({ block: "center", inline: "center", behavior: "instant" });
  });
  await page.waitForTimeout(300);
  await tipButton.evaluate((element) => {
    const screenshotTarget =
      element.closest(".topic-post") ??
      element.closest(".topic-body") ??
      element.closest("article") ??
      element;
    screenshotTarget.setAttribute("data-fiber-link-tip-screenshot-target", "true");
  });
  const tipPostScreenshotTarget = page
    .locator("[data-fiber-link-tip-screenshot-target='true']")
    .first();
  await tipPostScreenshotTarget.screenshot({ path: tipButtonScreenshotPath });
  await tipPostScreenshotTarget.evaluate((element) => {
    element.removeAttribute("data-fiber-link-tip-screenshot-target");
  });
  await tipButton.click();

  const modal = page.locator(".fiber-link-tip-modal .d-modal__container").first();
  await modal.waitFor({ timeout: 15_000 });
  const generateStep = modal.locator("[data-fiber-link-tip-modal-step='generate']").first();
  const payStep = modal.locator("[data-fiber-link-tip-modal-step='pay']").first();
  const confirmedStep = modal.locator("[data-fiber-link-tip-modal-step='confirmed']").first();
  await generateStep.waitFor({ timeout: 15_000 });
  if (await payStep.isVisible().catch(() => false)) {
    throw new Error("pay step should not be visible before invoice generation");
  }
  if (await confirmedStep.isVisible().catch(() => false)) {
    throw new Error("confirmed step should not be visible before invoice generation");
  }

  const amountInput = page.getByLabel(/amount/i).first();
  await amountInput.waitFor({ timeout: 15_000 });
  await amountInput.fill(tipAmount);

  const messageInput = page.getByLabel(/tip message/i).first();
  if (tipMessage) {
    await messageInput.fill(tipMessage);
  }

  await modal.screenshot({ path: tipModalStepGenerateScreenshotPath });

  await page.getByRole("button", { name: /generate invoice/i }).first().click();
  await payStep.waitFor({ timeout: 30_000 });
  if (await generateStep.isVisible().catch(() => false)) {
    throw new Error("generate step should not remain visible after invoice generation");
  }
  if (await confirmedStep.isVisible().catch(() => false)) {
    throw new Error("confirmed step should not be visible before settlement");
  }

  const walletLink = page.locator("[data-fiber-link-tip-modal='wallet-link']").first();
  const invoice = await walletLink
    .waitFor({ timeout: 30_000 })
    .then(async () => {
      const href = (await walletLink.getAttribute("href"))?.trim() ?? "";
      if (href.startsWith("fiber://invoice/")) {
        const value = href.slice("fiber://invoice/".length).trim();
        if (value) {
          return value;
        }
      }
      return null;
    })
    .catch(() => null);

  if (!invoice) {
    throw new Error("generated invoice is empty");
  }

  const invoiceQr = page.locator("[data-fiber-link-tip-modal='invoice-qr']").first();
  await invoiceQr.waitFor({ timeout: 15_000 });
  const invoiceQrVisible = await invoiceQr.isVisible();
  if (!invoiceQrVisible) {
    throw new Error("invoice QR did not become visible");
  }

  await modal.screenshot({ path: tipModalStepPayScreenshotPath });
  await modal.screenshot({ path: tipModalScreenshotPath });

  let payment = {
    attempted: settleInvoice,
    settled: false,
    txHash: null,
    payerRpcUrl,
  };

  if (settleInvoice) {
    const settlementResult = await settleInvoiceFromPayer(invoice);
    payment = {
      attempted: true,
      settled: true,
      txHash: settlementResult.txHash,
      payerRpcUrl,
      parseInvoice: settlementResult.parseInvoiceResult.response,
      sendPayment: settlementResult.sendPaymentResult.response,
    };

    await page.waitForFunction(
      () => {
        const confirmedStepElement = document.querySelector("[data-fiber-link-tip-modal-step='confirmed']");
        const payStepElement = document.querySelector("[data-fiber-link-tip-modal-step='pay']");
        const badge = confirmedStepElement?.querySelector(".fiber-link-tip-status-badge");
        return Boolean(confirmedStepElement) &&
          !payStepElement &&
          badge?.textContent?.includes("Payment received") === true;
      },
      undefined,
      { timeout: 45_000 },
    );

    await page.waitForTimeout(500);
    await modal.screenshot({ path: tipModalStepConfirmedScreenshotPath });
  }

  const dashboardSummary = await rpcCall("dashboard.summary", {});
  const tipStatus = await rpcCall("tip.status", { invoice });
  await openDashboard();
  await page.waitForTimeout(500);
  await page.screenshot({ path: tipperDashboardScreenshotPath, fullPage: true, timeout: 20_000 });

  return {
    user: username,
    topicTitle,
    tipAmount,
    tipMessage,
    invoice,
    invoiceQrVisible,
    pageUrl: page.url(),
    screenshots: {
      tipButton: tipButtonScreenshotPath,
      forumEntryPoints: forumEntryPointsScreenshotPath,
      topicThread: topicThreadScreenshotPath,
      tipModalStepGenerate: tipModalStepGenerateScreenshotPath,
      tipModalStepPay: tipModalStepPayScreenshotPath,
      tipModalStepConfirmed: tipModalStepConfirmedScreenshotPath,
      tipModal: tipModalScreenshotPath,
      tipperDashboard: tipperDashboardScreenshotPath,
    },
    payment,
    rpc: {
      dashboardSummary,
      tipStatus,
    },
  };
}
