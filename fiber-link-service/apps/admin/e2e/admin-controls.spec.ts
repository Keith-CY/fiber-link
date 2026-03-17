import { expect, test } from "@playwright/test";

test("updates admin controls and captures operator screenshots", async ({ page }, testInfo) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Admin controls" })).toBeVisible();

  const dashboardShot = testInfo.outputPath("01-admin-controls-dashboard.png");
  await page.screenshot({ path: dashboardShot, fullPage: true });

  const betaForm = page.locator('[data-testid="policy-form-app-beta"]');
  await expect(betaForm).toBeVisible();
  await betaForm.locator('input[name="allowedAssets"][value="USDI"]').check();
  await betaForm.locator('input[name="allowedAssets"][value="CKB"]').uncheck();
  await betaForm.locator('input[name="maxPerRequest"]').fill("1500");
  await betaForm.locator('input[name="perUserDailyMax"]').fill("4500");
  await betaForm.locator('input[name="perAppDailyMax"]').fill("25000");
  await betaForm.locator('input[name="cooldownSeconds"]').fill("45");

  const draftShot = testInfo.outputPath("02-admin-controls-draft.png");
  await page.screenshot({ path: draftShot, fullPage: true });

  await betaForm.getByRole("button", { name: "Save policy" }).click();
  await expect(page.getByRole("status")).toContainText("Policy saved for app-beta");
  await expect(betaForm.locator('input[name="maxPerRequest"]')).toHaveValue("1500");
  await expect(betaForm.locator('input[name="perUserDailyMax"]')).toHaveValue("4500");
  await expect(betaForm.locator('input[name="perAppDailyMax"]')).toHaveValue("25000");
  await expect(betaForm.locator('input[name="cooldownSeconds"]')).toHaveValue("45");

  const savedShot = testInfo.outputPath("03-admin-controls-saved.png");
  await page.screenshot({ path: savedShot, fullPage: true });
});
