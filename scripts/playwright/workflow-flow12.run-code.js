async (page) => {
  const env = typeof globalThis === "object" && globalThis.__PW_FLOW12_ENV__ && typeof globalThis.__PW_FLOW12_ENV__ === "object"
    ? globalThis.__PW_FLOW12_ENV__
    : {};
  const baseUrl = String(env.baseUrl ?? "http://127.0.0.1:9292").replace(/\/+$/, "");
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

  const tipButtonScreenshotPath = `${artifactDir}/playwright-flow1-tip-button.png`;
  const tipModalStepGenerateScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-step1-generate.png`;
  const tipModalStepPayScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-step2-pay.png`;
  const tipModalScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-invoice.png`;
  const tipModalStepConfirmedScreenshotPath = `${artifactDir}/playwright-flow1-tip-modal-step3-confirmed.png`;

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

  async function openTopicByTitle(title) {
    await page.goto(`${baseUrl}/latest`, { waitUntil: "domcontentloaded" });

    const latestTopicLink = page.getByRole("link", { name: title }).first();
    try {
      await latestTopicLink.waitFor({ timeout: 15_000 });
      await latestTopicLink.click();
      return;
    } catch (_error) {
      // Fallback to search when the latest list has not rendered or the topic is not visible yet.
    }

    await page.goto(`${baseUrl}/search?q=${encodeURIComponent(title)}`, { waitUntil: "domcontentloaded" });
    const searchTopicLink = page.getByRole("link", { name: title }).first();
    await searchTopicLink.waitFor({ timeout: 20_000 });
    await searchTopicLink.click();
  }

  await login(username, password);

  if (topicPath.trim()) {
    const normalizedPath = topicPath.startsWith("/") ? topicPath : `/${topicPath}`;
    await page.goto(`${baseUrl}${normalizedPath}`, { waitUntil: "domcontentloaded" });
  } else {
    await openTopicByTitle(topicTitle);
  }

  const tipButton = page
    .locator(
      ".fiber-link-tip-entry__button:visible, .post-action-menu__fiber-link-tip:visible, button[aria-label='Tip']:visible",
    )
    .first();
  await tipButton.waitFor({ timeout: 20_000 });
  await page.screenshot({ path: tipButtonScreenshotPath, fullPage: false });
  await tipButton.click();

  const modal = page.locator(".fiber-link-tip-modal").first();
  await modal.waitFor({ timeout: 15_000 });

  const amountInput = page.getByLabel(/amount/i).first();
  await amountInput.waitFor({ timeout: 15_000 });
  await amountInput.fill(tipAmount);

  const messageInput = page.getByLabel(/tip message/i).first();
  if (tipMessage) {
    await messageInput.fill(tipMessage);
  }

  await page.screenshot({ path: tipModalStepGenerateScreenshotPath, fullPage: false });

  await page.getByRole("button", { name: /generate invoice/i }).first().click();

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

  await page.screenshot({ path: tipModalStepPayScreenshotPath, fullPage: false });
  await page.screenshot({ path: tipModalScreenshotPath, fullPage: false });

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
        const badge = document.querySelector(".fiber-link-tip-status-badge");
        return badge?.textContent?.includes("Payment received") === true;
      },
      undefined,
      { timeout: 45_000 },
    );

    await page.waitForTimeout(500);
    await page.screenshot({ path: tipModalStepConfirmedScreenshotPath, fullPage: false });
  }

  const dashboardSummary = await rpcCall("dashboard.summary", {});
  const tipStatus = await rpcCall("tip.status", { invoice });

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
      tipModalStepGenerate: tipModalStepGenerateScreenshotPath,
      tipModalStepPay: tipModalStepPayScreenshotPath,
      tipModalStepConfirmed: tipModalStepConfirmedScreenshotPath,
      tipModal: tipModalScreenshotPath,
    },
    payment,
    rpc: {
      dashboardSummary,
      tipStatus,
    },
  };
}
