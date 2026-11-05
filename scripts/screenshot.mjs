#!/usr/bin/env node
/**
 * Screenshot harness for visual critique.
 * Usage: node scripts/screenshot.mjs <outDir> <path1> [path2 ...]
 * Logs in with the demo admin first, then captures each path at 1440x900.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
import path from "node:path";

const BASE = process.env.SHOT_BASE_URL ?? "http://localhost:3000";
const EMAIL = "admin@kitstak.io";
const PASSWORD = "KitStak!demo2026";

const [outDir, ...paths] = process.argv.slice(2);
if (!outDir || paths.length === 0) {
  console.error("Usage: node scripts/screenshot.mjs <outDir> <path1> [path2 ...]");
  process.exit(1);
}
mkdirSync(outDir, { recursive: true });

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const page = await context.newPage();

// login once
await page.goto(`${BASE}/login`, { waitUntil: "networkidle" });
await page.fill('input[type="email"], input[name="email"]', EMAIL);
await page.fill('input[type="password"], input[name="password"]', PASSWORD);
await page.click('button[type="submit"]');
await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15000 });

for (const p of paths) {
  const name = p.replaceAll("/", "_").replaceAll("?", "-").replaceAll("=", "-").replace(/^_/, "") || "home";
  await page.goto(`${BASE}${p}`, { waitUntil: "networkidle" });
  await page.waitForTimeout(900); // charts/skeletons settle
  const file = path.join(outDir, `${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`saved ${file}`);
}

await browser.close();
