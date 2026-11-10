/**
 * Station fixtures + end-to-end walk with real data (local dev only).
 *   node tests/e2e/stations-returns/station-fixtures.cjs [outDir]
 * Seeds (or tops up) the M04 fixtures with seed-station-fixtures.ts: orders in a tote LP at PACK-01,
 * in location stock at PACK-02 and in a cell of putwall MC-01, plus HOSP-01 holding a pack-short
 * order. Then packs each through the pack screen (tote / location / putwall modes) in headless
 * Chromium and saves screenshots. Needs the dev server on :3000 and .data/e2e-auth/admin.json.
 */
const path = require("path");
const ROOT = path.resolve(__dirname, "../../..");
const { chromium } = require(path.join(ROOT, "node_modules/playwright"));
const Database = require(path.join(ROOT, "node_modules/better-sqlite3"));
const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? path.join(ROOT, ".data");
const EXE = process.env.PW_CHROMIUM ?? `${process.env.LOCALAPPDATA}/ms-playwright/chromium_headless_shell-1254/chrome-headless-shell-win64/chrome-headless-shell.exe`;
const SKU_A = "APX-TEE-WHT-M", SKU_B = "APX-TEE-NVY-M";

(async () => {
  const browser = await chromium.launch({ executablePath: EXE });
  const ctx = await browser.newContext({ storageState: path.join(ROOT, ".data/e2e-auth/admin.json"), viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.goto(`${base}/packing-station`, { timeout: 420000 });
  const csrf = async () => (await ctx.cookies(base)).find((c) => c.name === "ks_csrf")?.value ?? "";
  const get = async (p) => { const r = await ctx.request.get(base + p, { timeout: 420000 }); const j = await r.json(); if (!r.ok()) throw new Error(`${p} ${r.status()} ${j.error}`); return j.data; };
  const post = async (p, data) => { const r = await ctx.request.post(base + p, { data, headers: { "x-csrf-token": await csrf(), Origin: base }, timeout: 420000 }); const j = await r.json(); if (!r.ok()) throw new Error(`${p} ${r.status()} ${j.error} ${JSON.stringify(j.fieldErrors ?? {})}`); return j.data; };
  const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

  const me = await get("/api/me");
  const wh = me.contextOptions.warehouses.find((w) => w.code === "MLT1");
  const stations = await get(`/api/packing/stations?warehouseId=${wh.id}`);
  const st = (code) => stations.find((s) => s.code === code);

  // Fixtures: seeded through the domain (idempotent), then read back. See seed-station-fixtures.ts.
  const seed = require("child_process").spawnSync(process.platform === "win32" ? "npx.cmd" : "npx", ["tsx", "tests/e2e/stations-returns/seed-station-fixtures.ts"], { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" });
  log(seed.stdout.trim()); if (seed.status !== 0) throw new Error(seed.stderr);
  const db = new Database(path.join(ROOT, ".data/kitstak.db"), { readonly: true });
  const fx = (tag) => db.prepare("SELECT id, code FROM shipment_orders WHERE warehouse_id = ? AND store_order_number LIKE ? AND status IN ('Ready to Pack','Packing Started') AND pack_short_status <> 'Open' ORDER BY created_at DESC").get(wh.id, `KS-FIX-M04-${tag}-%`);
  const oTote = fx("TOTE"), oLoc = fx("LOC"), oCart = fx("CART");
  const toteNo = db.prepare("SELECT DISTINCT lp.number FROM inventory_allocations a JOIN inventory i ON i.id = a.inventory_id JOIN license_plates lp ON lp.id = i.lp_id WHERE a.order_id = ?").get(oTote.id).number;
  db.close();
  log("fixtures", { tote: toteNo, oTote: oTote.code, oLoc: oLoc.code, oCart: oCart.code });

  async function packVia(mode, stationCode, sourceCode, order) {
    const t0 = Date.now();
    await page.goto(`${base}/packing-station/${st(stationCode).id}/${mode}`, { timeout: 420000 });
    await page.locator("#pack-source").waitFor({ timeout: 300000 });
    log(mode, "screen ready", Date.now() - t0, "ms");
    await page.locator("#pack-source").fill(sourceCode); await page.keyboard.press("Enter");
    await page.locator("#pack-product").waitFor({ state: "visible", timeout: 240000 });
    await page.waitForTimeout(800);
    await page.screenshot({ path: path.join(OUT, `e2e-${mode}-loaded.png`) });
    for (const sku of [SKU_A, SKU_A, SKU_B]) { await page.locator("#pack-product").fill(sku); await page.keyboard.press("Enter"); await page.waitForTimeout(400); }
    await page.locator("#pkg-1").focus(); await page.keyboard.press("Enter");
    await page.getByRole("option", { name: /BOX-S/ }).first().click();
    await page.getByLabel("Package 1 weight pounds").fill("1");
    await page.getByRole("button", { name: "Get rate" }).click();
    await page.getByText(/\$\d+\.\d{2}/).first().waitFor({ timeout: 240000 });
    await page.locator("#pack-product").focus(); await page.keyboard.press("F9");
    await page.getByText(/Ready to Ship|Packing complete|packed/i).first().waitFor({ timeout: 300000 });
    await page.screenshot({ path: path.join(OUT, `e2e-${mode}-done.png`) });
    const d = await get(`/api/orders/${order.id}`);
    log(mode, order.code, "→", d.order?.status ?? d.status);
    return d.order?.status ?? d.status;
  }
  const results = {};
  results.tote = await packVia("tote", "PACK-01", toteNo, oTote);
  results.location = await packVia("location", "PACK-02", "PACK-02", oLoc);
  results.putwall = await packVia("putwall", "PACK-03", "MC-01", oCart);
  log("pack results", results, "page errors", errors.length);
  console.log(JSON.stringify({ results, tote: toteNo, orders: [oTote.code, oLoc.code, oCart.code], errors }));
  await browser.close();
})().catch((e) => { console.error(e); process.exit(1); });
