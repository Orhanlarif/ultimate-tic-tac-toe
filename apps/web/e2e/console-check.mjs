import { chromium } from "@playwright/test";

const paths = [
  "/",
  "/play/bot",
  "/play/local",
  "/login",
  "/register",
  "/leaderboard",
  "/friends",
  "/play/room",
];
const browser = await chromium.launch();

for (const path of paths) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const problems = [];
  page.on("console", (msg) => {
    if (msg.type() === "error" || msg.type() === "warning") {
      problems.push(`[${msg.type()}] ${msg.text()}`);
    }
  });
  page.on("pageerror", (err) => problems.push(`[pageerror] ${err.message}`));
  await page.goto(`http://localhost:3000${path}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(1500);
  console.log(`\n=== ${path} ===`);
  if (problems.length === 0) console.log("  clean");
  else for (const p of [...new Set(problems)]) console.log("  " + p);
  await page.close();
}

await browser.close();
