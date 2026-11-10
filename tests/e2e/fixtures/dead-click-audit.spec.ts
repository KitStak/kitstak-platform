/**
 * Dead-click audit (`npm run audit:dead-clicks`).
 *
 * Crawls every nav route (nav-config plus links rendered in the shell) as admin and clicks every
 * enabled `button`, `[role=menuitem]` and `a`. Each click must navigate, send a
 * request, open a dialog/drawer/popover/menu, download, open a popup or mutate
 * the DOM. The test fails listing every offender.
 *
 * Run it against a freshly reset database (`npm run db:reset`): clicks are real.
 * Options (env):
 *   AUDIT_ROUTES=/orders,/products   only audit these routes (and their sub-routes)
 *   AUDIT_START=/dashboard           page whose links seed the crawl
 * Opt a control out with `data-audit-skip` (use sparingly, explain in code).
 */
import { expect, test, type Page } from "@playwright/test";
import {
  applyRouteFilter,
  clickEffects,
  controlSignature,
  describeControl,
  formatOffenders,
  isNoiseRequest,
  parseRouteFilter,
  shouldSkipControl,
  uniqueRoutes,
  type ClickSignals,
  type ControlDescriptor,
  type Offender,
} from "./dead-click-core";
import {
  AUDIT_ATTR,
  collectHrefs,
  countOverlays,
  settle,
  startMutationProbe,
  stopMutationProbe,
  tagControls,
} from "./dead-click-page";
import { loadNavConfigHrefs } from "./nav-routes";
import { storageStatePath } from "./roles";

const CLICK_TIMEOUT_MS = 3_000;
const EFFECT_WAIT_MS = 600;
const HOVER_SETTLE_MS = 150;

test.use({ storageState: storageStatePath("admin") });

interface ClickOutcome {
  readonly signals: ClickSignals | null;
  readonly needsReload: boolean;
  readonly error?: string;
}

async function gotoRoute(page: Page, route: string): Promise<readonly ControlDescriptor[]> {
  await page.goto(route);
  await settle(page);
  return tagControls(page);
}

async function clickAndObserve(page: Page, control: ControlDescriptor): Promise<ClickOutcome> {
  const locator = page.locator(`[${AUDIT_ATTR}="${control.auditId}"]`);
  const startUrl = page.url();
  try {
    await locator.hover({ timeout: CLICK_TIMEOUT_MS });
    await page.waitForTimeout(HOVER_SETTLE_MS);
  } catch (error: unknown) {
    return { signals: null, needsReload: true, error: errorMessage(error) };
  }

  let requests = 0;
  let downloads = 0;
  let popups = 0;
  let navigated = false;
  const onRequest = (req: { url(): string }): void => {
    if (!isNoiseRequest(req.url())) requests += 1;
  };
  const onNavigated = (frame: { parentFrame(): unknown }): void => {
    if (frame.parentFrame() === null) navigated = true;
  };
  const onDownload = (): void => void (downloads += 1);
  const onPopup = (popup: Page): void => {
    popups += 1;
    void popup.close().catch(() => undefined);
  };

  const overlaysBefore = await countOverlays(page);
  await startMutationProbe(page);
  page.on("request", onRequest);
  page.on("framenavigated", onNavigated);
  page.on("download", onDownload);
  page.on("popup", onPopup);
  try {
    await locator.click({ timeout: CLICK_TIMEOUT_MS, noWaitAfter: true });
    await page.waitForTimeout(EFFECT_WAIT_MS);
  } catch (error: unknown) {
    return { signals: null, needsReload: true, error: errorMessage(error) };
  } finally {
    page.off("request", onRequest);
    page.off("framenavigated", onNavigated);
    page.off("download", onDownload);
    page.off("popup", onPopup);
  }

  const mutations = await stopMutationProbe(page);
  const urlChanged = page.url() !== startUrl;
  const overlaysAfter = urlChanged ? 0 : await countOverlays(page).catch(() => 0);
  const signals: ClickSignals = {
    navigated: navigated || urlChanged,
    requests,
    overlaysBefore,
    overlaysAfter,
    mutations,
    downloads,
    popups,
  };
  return { signals, needsReload: await needsReload(page, startUrl, overlaysBefore, signals) };
}

/** Tries Escape to close what the click opened; reload when the page is not back to baseline. */
async function needsReload(
  page: Page,
  startUrl: string,
  overlaysBefore: number,
  signals: ClickSignals
): Promise<boolean> {
  if (page.url() !== startUrl) return true;
  if (clickEffects(signals).length === 0) return false;
  await page.keyboard.press("Escape").catch(() => undefined);
  await page.waitForTimeout(HOVER_SETTLE_MS);
  return page.url() !== startUrl || (await countOverlays(page).catch(() => -1)) !== overlaysBefore;
}

function errorMessage(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.split("\n")[0] ?? message;
}

async function auditRoute(
  page: Page,
  route: string,
  seenShellControls: Set<string>
): Promise<{ offenders: readonly Offender[]; unclickable: readonly string[] }> {
  const offenders: Offender[] = [];
  const unclickable: string[] = [];
  const controls = await gotoRoute(page, route);
  let stale = false;

  for (const control of controls) {
    if (shouldSkipControl(control)) continue;
    if (control.inShell) {
      const signature = controlSignature(control);
      if (seenShellControls.has(signature)) continue;
      seenShellControls.add(signature);
    }
    if (stale) {
      await gotoRoute(page, route);
      stale = false;
    }
    const outcome = await clickAndObserve(page, control);
    stale = outcome.needsReload;
    if (outcome.signals === null) {
      unclickable.push(`${route}: ${describeControl(control)} (${outcome.error ?? "not clickable"})`);
    } else if (clickEffects(outcome.signals).length === 0) {
      offenders.push({ route, control });
    }
  }
  return { offenders, unclickable };
}

test("every enabled control on every nav route does something observable", async ({ page, baseURL }) => {
  test.setTimeout(0);
  const origin = new URL(baseURL ?? page.url()).origin;
  const start = process.env.AUDIT_START ?? "/dashboard";

  await page.goto(start);
  await settle(page);
  expect(new URL(page.url()).pathname, "audit must run logged in").not.toBe("/login");

  const routes = applyRouteFilter(
    uniqueRoutes([start, ...loadNavConfigHrefs(), ...(await collectHrefs(page))], origin),
    parseRouteFilter(process.env.AUDIT_ROUTES)
  );
  expect(routes.length, "no nav routes matched; check AUDIT_ROUTES / AUDIT_START").toBeGreaterThan(0);
  test.info().annotations.push({ type: "routes", description: routes.join(", ") });

  const seenShellControls = new Set<string>();
  const offenders: Offender[] = [];
  const unclickable: string[] = [];
  for (const route of routes) {
    await test.step(route, async () => {
      const result = await auditRoute(page, route, seenShellControls);
      offenders.push(...result.offenders);
      unclickable.push(...result.unclickable);
    });
  }

  if (unclickable.length > 0) {
    test.info().annotations.push({ type: "unclickable", description: unclickable.join("\n") });
  }
  expect(formatOffenders(offenders)).toBe(formatOffenders([]));
});
