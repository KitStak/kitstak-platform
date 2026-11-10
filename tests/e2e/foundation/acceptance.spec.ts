/**
 * BUILD_PLAN F8 — foundation acceptance gate (items 2 and 3).
 *
 *   2. Every registered route (F4.7) resolves; legacy `?tab=` URLs redirect.
 *   3. Access control: viewer has no Settings menu, viewer gets the 403 page on
 *      /settings/users and 403 on POST /api/tags, a POST without the CSRF token is
 *      rejected, and deactivating a user kills their session on the next request.
 *
 * Runs against the shared app (E2E_BASE_URL, default http://localhost:3000) on a
 * freshly reset database: `npm run db:reset && npx playwright test --project=e2e tests/e2e/foundation`.
 */
import path from "node:path";
import Database from "better-sqlite3";
import type { APIRequestContext, BrowserContext, Page } from "@playwright/test";
import { ROUTE_PATTERNS, ROUTE_REGISTRY } from "../../../src/config/route-registry";
import { LEGACY_TAB_REDIRECTS } from "../../../next.config";
import { expect, test } from "../fixtures/auth";
import { loginViaApi } from "../fixtures/login";
import { ROLE_EMAILS, e2eBaseUrl } from "../fixtures/roles";

const SENTINEL_ID = "00000000-0000-4000-8000-000000000000";
const DYNAMIC_SEGMENT = /\[[^\]/]+\]/g;
const ERROR_BOUNDARY_TEXT = "Something went wrong";
const PLACEHOLDER_TEXT = "Module in progress";
const FORBIDDEN_TEXT = "You don't have access to this page";
const ROUTE_TIMEOUT_MS = 120_000;
const DB_PATH = process.env.KITSTAK_DB_PATH ?? path.join(process.cwd(), ".data", "kitstak.db");

const baseUrl = e2eBaseUrl();
const sameOrigin = { Origin: baseUrl, Referer: `${baseUrl}/dashboard` } as const;

async function csrfToken(context: BrowserContext): Promise<string> {
  const existing = (await context.cookies(baseUrl)).find((c) => c.name === "ks_csrf")?.value;
  if (existing) return existing;
  const res = await context.request.get(`${baseUrl}/api/auth/csrf`);
  expect(res.ok()).toBe(true);
  const issued = (await context.cookies(baseUrl)).find((c) => c.name === "ks_csrf")?.value;
  if (!issued) throw new Error("GET /api/auth/csrf did not set the ks_csrf cookie");
  return issued;
}

async function errorCode(res: Awaited<ReturnType<APIRequestContext["post"]>>): Promise<string | undefined> {
  const body = (await res.json()) as { code?: string };
  return body.code;
}

function setUserActive(email: string, active: boolean): void {
  const db = new Database(DB_PATH, { fileMustExist: true });
  try {
    db.pragma("busy_timeout = 10000");
    const result = db.prepare("UPDATE users SET is_active = ? WHERE email = ?").run(active ? 1 : 0, email);
    if (result.changes !== 1) throw new Error(`Expected one user with email ${email}, updated ${result.changes}`);
  } finally {
    db.close();
  }
}

test.describe("F8.2 every registered route resolves", () => {
  for (const pattern of ROUTE_PATTERNS) {
    const isDynamic = pattern.includes("[");
    const url = pattern.replace(DYNAMIC_SEGMENT, SENTINEL_ID);
    test(`GET ${pattern}`, async ({ adminPage }) => {
      test.setTimeout(ROUTE_TIMEOUT_MS);
      const res = await adminPage.request.get(`${baseUrl}${url}`, { timeout: ROUTE_TIMEOUT_MS });
      const html = await res.text();
      expect(res.status(), `${pattern} status`).toBeLessThan(isDynamic ? 500 : 400);
      expect(html, `${pattern} rendered the error boundary`).not.toContain(ERROR_BOUNDARY_TEXT);
      if (html.includes(PLACEHOLDER_TEXT)) {
        const label = ROUTE_REGISTRY.get(pattern)?.label ?? "";
        expect(html, `${pattern} placeholder shows its label`).toContain(label.replace(/&/g, "&amp;"));
      }
    });
  }
});

test.describe("F8.2 legacy ?tab= URLs redirect", () => {
  for (const entry of LEGACY_TAB_REDIRECTS) {
    test(`${entry.source}?tab=${entry.tab} -> ${entry.destination}`, async ({ adminPage }) => {
      const res = await adminPage.request.get(`${baseUrl}${entry.source}?tab=${entry.tab}`, { maxRedirects: 0 });
      expect(res.status()).toBe(308);
      const location = res.headers()["location"] ?? "";
      expect(new URL(location, baseUrl).pathname).toBe(entry.destination);
    });
  }
});

test.describe("F8.3 access control", () => {
  test("admin sees the Settings menu; viewer does not", async ({ adminPage, viewerPage }) => {
    const settingsTrigger = (page: Page) =>
      page.getByRole("navigation", { name: "Main navigation" }).getByRole("button", { name: "Settings", exact: true });
    await adminPage.goto("/dashboard");
    await expect(settingsTrigger(adminPage)).toBeVisible();
    await viewerPage.goto("/dashboard");
    await expect(viewerPage.getByRole("navigation", { name: "Main navigation" })).toBeVisible();
    await expect(settingsTrigger(viewerPage)).toHaveCount(0);
  });

  test("viewer opening /settings/users lands on the 403 page", async ({ viewerPage }) => {
    await viewerPage.goto("/settings/users");
    await expect(viewerPage).toHaveURL(/\/forbidden/);
    await expect(viewerPage.getByText(FORBIDDEN_TEXT)).toBeVisible();
  });

  test("viewer POST /api/tags is forbidden (with a valid CSRF token)", async ({ viewerPage }) => {
    await viewerPage.goto("/dashboard");
    const token = await csrfToken(viewerPage.context());
    const res = await viewerPage.request.post(`${baseUrl}/api/tags`, {
      headers: { ...sameOrigin, "x-csrf-token": token },
      data: { name: "f8-viewer-tag", scope: "order", color: "blue" },
    });
    expect(res.status()).toBe(403);
    expect(await errorCode(res)).toBe("FORBIDDEN");
  });

  test("a POST without the CSRF token is rejected", async ({ adminPage }) => {
    await adminPage.goto("/dashboard");
    const res = await adminPage.request.post(`${baseUrl}/api/tags`, {
      headers: sameOrigin,
      data: { name: "f8-no-csrf-tag", scope: "order", color: "blue" },
    });
    expect(res.status()).toBe(403);
    expect(await errorCode(res)).toBe("CSRF");
  });

  test("deactivating a user kills their open session on the next request", async ({ browser }) => {
    const email = ROLE_EMAILS.operator;
    const context = await browser.newContext();
    try {
      await loginViaApi(context.request, "operator");
      expect((await context.request.get(`${baseUrl}/api/me`)).status()).toBe(200);
      setUserActive(email, false);
      try {
        const api = await context.request.get(`${baseUrl}/api/me`);
        expect(api.status()).toBe(401);
        const page = await context.newPage();
        await page.goto("/dashboard");
        await expect(page).toHaveURL(/\/login/);
      } finally {
        setUserActive(email, true);
      }
    } finally {
      await context.close();
    }
  });
});
