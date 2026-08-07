import { expect, test } from "@playwright/test";

test("an unconfigured clean install gives actionable setup guidance", async ({ page }) => {
  await page.goto("/");
  if (await page.locator("header").getByText("Test mode", { exact: true }).isVisible().catch(() => false)) {
    test.skip(true, "Local test mode is enabled for this installation");
  }
  await expect(page.getByRole("heading", { name: "VideoFlow needs configuration" })).toBeVisible();
  await expect(page.getByText("NEXT_PUBLIC_CONVEX_URL")).toBeVisible();
  await expect(page.getByText("npm run doctor")).toBeVisible();
  await expect(page.locator("body")).not.toContainText(/CRM|internal admin/i);
});
