import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const outDir = "e2e/shots";
mkdirSync(outDir, { recursive: true });

const targets = [
  ["home", "/", 1440, 1100],
  ["home-mobile", "/", 420, 900],
  ["bot", "/play/bot", 1440, 900],
  ["local", "/play/local", 1440, 1000],
  ["login", "/login", 1440, 900],
  ["register", "/register", 1440, 1000],
  ["leaderboard", "/leaderboard", 1440, 700],
  ["room", "/play/room", 1440, 900],
];

const browser = await chromium.launch();

for (const [name, path, w, h] of targets) {
  const page = await browser.newPage({ viewport: { width: w, height: h } });
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${outDir}/${name}.png`, fullPage: name === "home" });
  console.log("captured", name);
  await page.close();
}

// Mid-game board: play a few moves so one board becomes the forced target.
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
await page.goto("http://localhost:3000/play/local", { waitUntil: "networkidle" });
const boards = page.locator(".local-board");
await boards.nth(4).locator("button").nth(6).click();
await page.waitForTimeout(300);
await boards.nth(6).locator("button").nth(2).click();
await page.waitForTimeout(300);
await boards.nth(2).locator("button").nth(4).click();
await page.waitForTimeout(600);
await page.screenshot({ path: `${outDir}/local-midgame.png` });
console.log("captured local-midgame");
await page.close();

await browser.close();
