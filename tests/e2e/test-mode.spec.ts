import { expect, test } from "@playwright/test";

test("test mode mirrors the installed recording and library language", async ({ page }) => {
  await page.goto("/");
  if (await page.getByRole("heading", { name: "VideoFlow needs configuration" }).isVisible().catch(() => false)) {
    test.skip(true, "Local test mode is not enabled for this installation");
  }

  await expect(page.getByRole("heading", { name: "What do you want to record?" })).toBeVisible();
  await expect(page.getByText("Stored only in this browser")).toBeVisible();
  await expect(page.getByText("Everything on this device stays local. AI and real external delivery remain off.").first()).toBeVisible();

  await page.getByRole("button", { name: /Screen \+ camera/ }).click();
  await expect(page.getByRole("dialog", { name: "Record a video" })).toBeVisible();
  await expect(page.getByText("Nothing in this window is uploaded.")).toBeVisible();
  await expect(page.getByText("Camera bubble", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Square" }).click();
  await page.getByRole("button", { name: "Top right" }).click();
  await page.getByRole("button", { name: "Large camera bubble" }).click();
  await page.getByRole("button", { name: "Close" }).click();

  await page.getByRole("button", { name: "Library" }).click();
  await expect(page.getByRole("heading", { name: "Video library" })).toBeVisible();
  await expect(page.getByPlaceholder("Search your videos")).toBeVisible();
  await expect(page.getByText("0 videos", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Your first video starts here" })).toBeVisible();
});
