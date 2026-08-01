import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const out = "e2e/shots/audit";
mkdirSync(out, { recursive: true });
const browser = await chromium.launch();

const email = `audit_${Date.now()}@example.com`;
const password = "SuperSecret123";
// Distinct prefix so the throwaway accounts can be purged after the run.
const displayName = "Zqa Orhan";

// Signed-in desktop header
const desk = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await desk.goto("http://localhost:3000/register", { waitUntil: "networkidle" });
await desk.fill('input[name="displayName"]', displayName);
await desk.fill('input[name="email"]', email);
await desk.fill('input[name="password"]', password);
await desk.fill('input[name="confirmPassword"]', password);
await desk.click('button[type="submit"]');
await desk.waitForURL("http://localhost:3000/", { timeout: 20_000 });
await desk.waitForTimeout(1200);
await desk.locator(".site-header").screenshot({ path: `${out}/header-desktop.png` });
await desk.locator(".account-trigger").click();
await desk.waitForTimeout(500);
await desk.screenshot({
  path: `${out}/header-desktop-open.png`,
  clip: { x: 700, y: 0, width: 740, height: 300 },
});
await desk.goto("http://localhost:3000/leaderboard", { waitUntil: "networkidle" });
await desk.waitForTimeout(1500);
await desk.screenshot({ path: `${out}/leaderboard.png` });
const storage = await desk.context().storageState();
await desk.close();

// Signed-in mobile
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  storageState: storage,
  isMobile: true,
  hasTouch: true,
});
const m = await ctx.newPage();
const mobileShots = [
  ["m-home", "/"],
  ["m-leaderboard", "/leaderboard"],
  ["m-friends", "/friends"],
  ["m-bot", "/play/bot"],
  ["m-local", "/play/local"],
  ["m-room", "/play/room"],
  ["m-login", "/login"],
  ["m-register", "/register"],
];
for (const [name, path] of mobileShots) {
  await m.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  await m.waitForTimeout(1000);
  await m.screenshot({ path: `${out}/${name}.png`, fullPage: true });
  const overflow = await m.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  if (overflow > 0) console.log(`HORIZONTAL OVERFLOW on ${path}: ${overflow}px`);
}

await m.goto("http://localhost:3000/", { waitUntil: "networkidle" });
await m.locator(".menu-toggle").click();
await m.waitForTimeout(700);
await m.screenshot({ path: `${out}/m-menu.png` });
await ctx.close();

await browser.close();
console.log("audit done");
