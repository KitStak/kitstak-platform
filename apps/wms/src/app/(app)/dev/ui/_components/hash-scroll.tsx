"use client";

import * as React from "react";

/** How long late layout (fonts, grid rows, charts) may still move the target. */
const SETTLE_MS = 2500;
const USER_SCROLL_EVENTS = ["wheel", "touchstart", "keydown", "pointerdown"] as const;

/**
 * The showcase streams in after the browser resolved `#grid`, so a hard load of
 * /dev/ui#grid would stay at the top, and sections above can still grow after the
 * first scroll. Re-applies the hash whenever the page resizes during a short settle
 * window, and stops as soon as the user scrolls or interacts.
 */
export function HashScroll() {
  React.useEffect(() => {
    const id = decodeURIComponent(window.location.hash.slice(1));
    if (!id) return;
    let active = true;
    const apply = (): void => {
      if (active) document.getElementById(id)?.scrollIntoView({ block: "start" });
    };
    const stop = (): void => {
      active = false;
    };
    let timer: number | undefined;
    // The settle window starts at the first painted frame (a background tab paints later).
    const frame = requestAnimationFrame(() => {
      apply();
      timer = window.setTimeout(stop, SETTLE_MS);
    });
    const observer = new ResizeObserver(apply);
    observer.observe(document.body);
    USER_SCROLL_EVENTS.forEach((type) => window.addEventListener(type, stop, { passive: true, once: true }));
    return () => {
      stop();
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.clearTimeout(timer);
      USER_SCROLL_EVENTS.forEach((type) => window.removeEventListener(type, stop));
    };
  }, []);
  return null;
}
