import { expect, test, type Browser, type Page } from "@playwright/test";

/**
 * Private rooms end to end — requires web + realtime:
 *   npm run dev:realtime:memory
 *   npm run dev:web
 *
 * Every player needs their own context so they get their own guest cookie.
 */

async function newPlayer(browser: Browser): Promise<Page> {
  const context = await browser.newContext();
  return context.newPage();
}

async function playUntilStuck(page: Page, moves: number) {
  for (let i = 0; i < moves; i++) {
    const cells = page.locator(".board-cell.can-play");
    if ((await cells.count()) === 0) return;
    await cells.first().click();
    await page.waitForTimeout(250);
  }
}

test.describe("private rooms", () => {
  test("create, join by link, resign, rematch", async ({ browser }) => {
    const host = await newPlayer(browser);
    const guest = await newPlayer(browser);

    await host.goto("/play/room?create=1");
    const code = (await host.locator(".room-code").innerText({ timeout: 20_000 })).trim();
    expect(code).toHaveLength(5);

    // The code lands in the URL without a navigation, so the socket the room
    // was created on has to survive it.
    await expect(host).toHaveURL(new RegExp(`/play/room/${code}$`));
    await expect(host.locator(".card-error")).toHaveCount(0);

    await guest.goto(`/play/room/${code}`);
    await expect(host.locator(".ultimate-board")).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator(".ultimate-board")).toBeVisible({ timeout: 20_000 });

    await playUntilStuck(host, 2);
    await playUntilStuck(guest, 2);

    await host.getByRole("button", { name: /pes et|resign/i }).click();
    await expect(guest.getByRole("heading").first()).toHaveText(/kazandın|you win/i, {
      timeout: 20_000,
    });
    await expect(host.getByRole("heading").first()).toHaveText(/kaybettin|you lose/i);

    await host.getByRole("button", { name: /hazırım|i'm ready/i }).click();
    await guest.getByRole("button", { name: /hazırım|i'm ready/i }).click();
    await expect(host.locator(".ultimate-board")).toBeVisible({ timeout: 20_000 });
    await expect(guest.locator(".ultimate-board")).toBeVisible({ timeout: 20_000 });

    await host.context().close();
    await guest.context().close();
  });

  test("a new opponent gets a clean slate, and the host can reopen at once", async ({
    browser,
  }) => {
    const host = await newPlayer(browser);
    const guest = await newPlayer(browser);

    await host.goto("/play/room?create=1");
    const code = (await host.locator(".room-code").innerText({ timeout: 20_000 })).trim();
    await guest.goto(`/play/room/${code}`);
    await expect(host.locator(".ultimate-board")).toBeVisible({ timeout: 20_000 });

    // Walking out of a live game is a resignation, so the host should see the
    // win rather than being dumped straight back to an empty lobby.
    await guest.getByRole("button", { name: /odadan çık|leave room/i }).click();
    await expect(host.getByRole("heading").first()).toHaveText(/kazandın|you win/i, {
      timeout: 20_000,
    });
    await guest.context().close();

    // A different player is a different scoreline, so this is a first game
    // again: it starts on its own and the old result is off the screen.
    const newcomer = await newPlayer(browser);
    await newcomer.goto(`/play/room/${code}`);
    await expect(host.locator(".ultimate-board")).toBeVisible({ timeout: 20_000 });
    await expect(host.getByRole("heading").first()).not.toHaveText(/kazandın|you win/i);
    await newcomer.context().close();

    // A finished match lingers server-side for late reconnects; it must not
    // read as "you are still busy".
    await host.getByRole("button", { name: /odadan çık|leave room/i }).click();
    await host.getByRole("button", { name: /oda oluştur|create room/i }).click();
    const second = (await host.locator(".room-code").innerText({ timeout: 20_000 })).trim();
    expect(second).not.toBe(code);
    await expect(host.locator(".card-error")).toHaveCount(0);

    await host.context().close();
  });

  test("the same opponent can step out and back in without stranding the room", async ({
    browser,
  }) => {
    const host = await newPlayer(browser);
    const guest = await newPlayer(browser);

    await host.goto("/play/room?create=1");
    const code = (await host.locator(".room-code").innerText({ timeout: 20_000 })).trim();
    await guest.goto(`/play/room/${code}`);
    await expect(guest.locator(".ultimate-board")).toBeVisible({ timeout: 20_000 });

    await guest.getByRole("button", { name: /pes et|resign/i }).click();
    await expect(host.locator(".scoreboard-grid")).toBeVisible({ timeout: 20_000 });

    await guest.getByRole("button", { name: /odadan çık|leave room/i }).click();
    await guest.goto(`/play/room/${code}`);

    // Past the opening game nothing auto-starts, so both sides need the ready
    // button — including the one who just walked back in with no result on
    // screen to hang it off.
    await expect(guest.getByRole("button", { name: /hazırım|i'm ready/i })).toBeVisible({
      timeout: 20_000,
    });
    await expect(host.getByRole("button", { name: /hazırım|i'm ready/i })).toBeVisible();

    await guest.getByRole("button", { name: /hazırım|i'm ready/i }).click();
    await host.getByRole("button", { name: /hazırım|i'm ready/i }).click();
    await expect(guest.locator(".ultimate-board")).toBeVisible({ timeout: 20_000 });

    await host.context().close();
    await guest.context().close();
  });
});
