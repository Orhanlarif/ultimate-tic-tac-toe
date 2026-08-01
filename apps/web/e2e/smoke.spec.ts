import { test, expect } from "@playwright/test";

/**
 * Smoke E2E — requires web (+ realtime for online play):
 *   npm run dev:realtime:memory
 *   npm run dev:web
 */
test.describe("landing and bot", () => {
  test("home page renders and opens bot mode", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading").first()).toBeVisible();
    await page.getByRole("link", { name: /bot|bota/i }).first().click();
    await expect(page).toHaveURL(/play\/bot/);
    await expect(page.getByRole("heading").first()).toBeVisible();
  });

  test("casual play page loads queue UI", async ({ page }) => {
    await page.goto("/play?mode=casual");
    await expect(page.getByText(/aranıyor|finding|searching|rakip/i).first()).toBeVisible({
      timeout: 15_000,
    });
  });
});

/** Requires Postgres, since accounts are stored there. */
test.describe("email and password accounts", () => {
  const password = "SuperSecret123";

  test("register, sign out, sign back in", async ({ page }) => {
    const email = `e2e_${Date.now()}@example.com`;
    const displayName = "E2E Tester";

    await page.goto("/register");
    await page.fill('input[name="displayName"]', displayName);
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.fill('input[name="confirmPassword"]', password);
    await page.click('button[type="submit"]');

    await expect(page.getByText(displayName).first()).toBeVisible({ timeout: 20_000 });

    await page.getByRole("button", { name: /çıkış|sign out/i }).first().click();
    await expect(page.getByRole("link", { name: /giriş yap|sign in/i }).first()).toBeVisible();

    await page.goto("/login");
    await page.fill('input[name="email"]', email);
    await page.fill('input[name="password"]', password);
    await page.click('button[type="submit"]');
    await expect(page.getByText(displayName).first()).toBeVisible({ timeout: 20_000 });
  });

  test("wrong password shows an inline error", async ({ page }) => {
    await page.goto("/login");
    await page.fill('input[name="email"]', "nobody@example.com");
    await page.fill('input[name="password"]', "WrongPassword1");
    await page.click('button[type="submit"]');
    await expect(page.locator(".form-alert")).toBeVisible({ timeout: 20_000 });
    await expect(page).toHaveURL(/\/login/);
  });
});
