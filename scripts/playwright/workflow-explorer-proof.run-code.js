async (page) => {
  const env = typeof globalThis === "object" && globalThis.__PW_EXPLORER_ENV__ && typeof globalThis.__PW_EXPLORER_ENV__ === "object"
    ? globalThis.__PW_EXPLORER_ENV__
    : {};
  const txHash = String(env.txHash ?? "").trim();
  const template = String(env.explorerTxUrlTemplate ?? "").trim();
  const artifactDir = String(env.artifactDir ?? ".");
  const viewportWidth = Number.parseInt(String(env.viewportWidth ?? "2560"), 10);
  const viewportHeight = Number.parseInt(String(env.viewportHeight ?? "1440"), 10);
  const viewport = {
    width: Number.isFinite(viewportWidth) && viewportWidth > 0 ? viewportWidth : 2560,
    height: Number.isFinite(viewportHeight) && viewportHeight > 0 ? viewportHeight : 1440,
  };
  const screenshotPath = `${artifactDir}/playwright-flow4-explorer-withdrawal-tx.png`;

  function buildExplorerUrl(rawTemplate, hash) {
    if (rawTemplate.includes("{txHash}")) {
      return rawTemplate.replaceAll("{txHash}", encodeURIComponent(hash));
    }
    if (rawTemplate.includes("${txHash}")) {
      return rawTemplate.replaceAll("${txHash}", encodeURIComponent(hash));
    }
    if (rawTemplate.includes("%s")) {
      return rawTemplate.replaceAll("%s", encodeURIComponent(hash));
    }
    return `${rawTemplate.replace(/\/+$/, "")}/${encodeURIComponent(hash)}`;
  }

  if (!txHash) {
    throw new Error("txHash is required");
  }
  if (!template) {
    throw new Error("explorerTxUrlTemplate is required");
  }

  const explorerUrl = buildExplorerUrl(template, txHash);
  await page.setViewportSize(viewport);
  await page.goto(explorerUrl, { waitUntil: "domcontentloaded" });

  const txPrefix = txHash.slice(0, 12);
  const txVisible = await page.getByText(new RegExp(txPrefix, "i")).first().isVisible().catch(() => false);
  if (!txVisible) {
    await page.waitForTimeout(4000);
  }

  let rawOpened = false;
  const rawButton = page.getByRole("button", { name: /^Raw$/i }).first();
  if (await rawButton.isVisible().catch(() => false)) {
    await rawButton.click().catch(() => {});
    rawOpened = true;
  }

  await Promise.any([
    page.getByText(/Confirmations|Untracked|Pending|Committed/i).first().waitFor({ timeout: 10000 }),
    page.getByText(/Input \(\d+\)|Output \(\d+\)/i).first().waitFor({ timeout: 10000 }),
  ]).catch(() => {});

  const statusText = await page
    .getByText(/Confirmations|Untracked|Pending|Committed/i)
    .first()
    .innerText()
    .catch(() => null);
  const detailSectionVisible = await page
    .getByText(/Input \(\d+\)|Output \(\d+\)/i)
    .first()
    .isVisible()
    .catch(() => false);

  await page.screenshot({ path: screenshotPath, fullPage: true });

  return {
    explorerUrl,
    txHash,
    txPrefix,
    txVisible,
    rawOpened,
    statusText,
    detailSectionVisible,
    screenshotPath,
    pageUrl: page.url(),
  };
}
