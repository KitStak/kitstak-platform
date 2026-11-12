/**
 * Browser-side probes for the dead-click audit. Each function is serialized
 * into the page by `page.evaluate`, so it must be self-contained.
 */
import type { Page } from "@playwright/test";
import type { ControlDescriptor } from "./dead-click-core";

export const AUDIT_ATTR = "data-audit-id";
const SETTLE_MS = 400;

/** Selector for everything that counts as an open overlay (dialog, drawer, popover, menu). */
export const OVERLAY_SELECTOR = [
  "[role=dialog]",
  "[role=alertdialog]",
  "[role=menu]",
  "[role=listbox]",
  "[data-radix-popper-content-wrapper]",
  "[data-state=open]",
].join(",");

export async function settle(page: Page): Promise<void> {
  await page.waitForLoadState("load");
  await page.waitForLoadState("networkidle", { timeout: 5_000 }).catch(() => undefined);
  await page.waitForTimeout(SETTLE_MS);
}

/** Collects every same-document href (the app shell exposes all nav routes as links). */
export async function collectHrefs(page: Page): Promise<readonly string[]> {
  return page.evaluate(() =>
    Array.from(document.querySelectorAll<HTMLAnchorElement>("a[href]")).map((a) => a.href)
  );
}

/** Tags every enabled, visible control with a sequential audit id and describes it. */
export async function tagControls(page: Page): Promise<readonly ControlDescriptor[]> {
  return page.evaluate((attr) => {
    const candidates = Array.from(
      document.querySelectorAll<HTMLElement>("button, [role=menuitem], a[href]")
    );
    const isEnabled = (el: HTMLElement): boolean =>
      !(el as HTMLButtonElement).disabled &&
      el.getAttribute("aria-disabled") !== "true" &&
      el.closest("[data-audit-skip], [inert], fieldset[disabled]") === null;
    const isVisible = (el: HTMLElement): boolean => {
      const rect = el.getBoundingClientRect();
      const style = window.getComputedStyle(el);
      return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
    };
    document.querySelectorAll(`[${attr}]`).forEach((el) => el.removeAttribute(attr));
    return candidates
      .filter((el) => isEnabled(el) && isVisible(el))
      .map((el, index) => {
        el.setAttribute(attr, String(index));
        const label = (el.getAttribute("aria-label") ?? el.textContent ?? el.getAttribute("title") ?? "")
          .replace(/\s+/g, " ")
          .trim()
          .slice(0, 80);
        return {
          auditId: index,
          tag: el.tagName.toLowerCase(),
          role: el.getAttribute("role"),
          label,
          href: el instanceof HTMLAnchorElement ? el.getAttribute("href") : null,
          inShell: el.closest("header, nav, aside, [data-app-shell]") !== null,
          isCurrent:
            !(el instanceof HTMLAnchorElement) &&
            (el.getAttribute("aria-selected") === "true" ||
              el.getAttribute("aria-pressed") === "true" ||
              // A checked radio (segmented control / option card) is already the current choice.
              (el.getAttribute("role") === "radio" && el.getAttribute("aria-checked") === "true")),
        };
      });
  }, AUDIT_ATTR);
}

export async function countOverlays(page: Page): Promise<number> {
  return page.evaluate((selector) => document.querySelectorAll(selector).length, OVERLAY_SELECTOR);
}

/** Starts counting DOM mutations (ignoring the audit's own attribute writes). */
export async function startMutationProbe(page: Page): Promise<void> {
  await page.evaluate((attr) => {
    const w = window as unknown as { __auditObserver?: MutationObserver; __auditMutations: number };
    w.__auditObserver?.disconnect();
    w.__auditMutations = 0;
    const observer = new MutationObserver((records) => {
      w.__auditMutations += records.filter((r) => r.attributeName !== attr).length;
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    w.__auditObserver = observer;
  }, AUDIT_ATTR);
}

export async function stopMutationProbe(page: Page): Promise<number> {
  return page
    .evaluate(() => {
      const w = window as unknown as { __auditObserver?: MutationObserver; __auditMutations?: number };
      w.__auditObserver?.disconnect();
      return w.__auditMutations ?? 0;
    })
    // The page navigated away: the probe is gone, navigation already counts.
    .catch(() => 0);
}
