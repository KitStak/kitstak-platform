import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type BrowserContext, type Page } from '@playwright/test';

/**
 * Shared helpers for the Pulse browser suite. Sign in happens once per login and the cookies are
 * kept in `test-results/.auth`, because the auth server rate limits sign-ins and every spec
 * shares it. Delete that folder (or set E2E_FRESH_LOGIN=1) to sign in again.
 */
export const ORIGIN = (): string => process.env.E2E_AUTH_ORIGIN ?? process.env.E2E_BASE_URL ?? 'http://localhost:3500';

export const LOGINS = {
  /** Org `kitstak`: warehouse data and the rich 3PL demo. */
  admin: { email: 'admin@kitstak.io', password: 'KitStak-Demo-2026!' },
  /** Org `northwind-robotics`: CRM and Projects data, no warehouse. */
  maya: { email: 'maya@northwind-robotics.example', password: 'Northwind-Demo-2026!' },
} as const;
export type Login = keyof typeof LOGINS;

type Cookie = Awaited<ReturnType<BrowserContext['cookies']>>[number];
const AUTH_DIR = path.join(__dirname, '..', 'test-results', '.auth');
const memory = new Map<Login, Cookie[]>();

/**
 * A dev server that is busy rebuilding can tell an open page to reload ("HMR hash mismatch") many
 * times a second, so no click lands. The suite drops those reload orders and the live code updates
 * on the dev socket, and passes everything else (the page needs the rest of it to start).
 */
export async function holdDevReloads(context: BrowserContext): Promise<void> {
  const marked = context as BrowserContext & { __holdDevReloads?: boolean };
  if (marked.__holdDevReloads) return;
  marked.__holdDevReloads = true;
  await context.routeWebSocket(/\/_next\/(webpack-)?hmr/, (socket) => {
    const server = socket.connectToServer();
    const seen = new Set<string>();
    server.onMessage((message) => {
      const kind = /"type":"([^"]+)"/.exec(String(message))?.[1];
      if (kind === 'reloadPage' || kind === 'turbopack-message' || kind === 'serverComponentChanges') return;
      if (kind === 'built' || kind === 'building' || kind === 'sync') {
        if (seen.has(kind)) return;
        seen.add(kind);
      }
      socket.send(message);
    });
    socket.onMessage((message) => server.send(message));
  });
}

export async function signIn(page: Page, who: Login = 'admin'): Promise<void> {
  await holdDevReloads(page.context());
  let cookies = memory.get(who) ?? null;
  const file = path.join(AUTH_DIR, `${who}-${new URL(ORIGIN()).port || 'default'}.json`);
  if (!cookies && who === 'admin' && process.env.E2E_COOKIES) cookies = JSON.parse(readFileSync(process.env.E2E_COOKIES, 'utf8')) as Cookie[];
  if (!cookies && !process.env.E2E_FRESH_LOGIN && existsSync(file)) {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Cookie[];
    await page.context().addCookies(saved);
    const me = await page.request.get('/api/v1/me');
    if (me.ok()) cookies = saved;
    else await page.context().clearCookies();
  }
  if (!cookies) {
    const response = await page.request.post('/api/auth/sign-in/email', { data: LOGINS[who], headers: { origin: ORIGIN() } });
    expect(response.ok(), `sign in as ${who} answered ${response.status()}`).toBeTruthy();
    cookies = await page.context().cookies();
    mkdirSync(AUTH_DIR, { recursive: true });
    writeFileSync(file, JSON.stringify(cookies));
  }
  memory.set(who, cookies);
  await page.context().addCookies(cookies);
}

/** Collects what a healthy page never has: script errors, console errors and failed requests. */
export function watchPage(page: Page): { problems: string[]; reset: () => void } {
  const problems: string[] = [];
  page.on('pageerror', (error) => problems.push(`script error: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const text = message.text();
    // The browser logs one line for each failed request; `response` below reports those with the address.
    if (/Download the React DevTools|Failed to load resource/.test(text)) return;
    problems.push(`console error: ${text.slice(0, 300)}`);
  });
  page.on('response', (response) => {
    const url = new URL(response.url());
    if (url.origin !== new URL(ORIGIN()).origin) return;
    if (response.status() >= 500) problems.push(`${response.status()} from ${url.pathname}${url.search}`);
  });
  return { problems, reset: () => void problems.splice(0) };
}

export const toast = (page: Page, text: string | RegExp) => page.locator('[data-sonner-toast]', { hasText: text });

export async function apiData<T>(page: Page, pathAndQuery: string): Promise<T> {
  const response = await page.request.get(`/api/v1/${pathAndQuery.replace(/^\/+/, '')}`);
  expect(response.ok(), `GET ${pathAndQuery} answered ${response.status()}`).toBeTruthy();
  return ((await response.json()) as { data: T }).data;
}

/** Opens a page and waits for the app to be ready to use (hydrated, first data in). */
export async function open(page: Page, url: string): Promise<number> {
  const response = await page.goto(url);
  await page.waitForLoadState('networkidle', { timeout: 30_000 }).catch(() => undefined);
  return response?.status() ?? 0;
}
