"use client";

/**
 * 2px route-transition bar directly under the 56px header. App Router has no router
 * events, so a navigation "starts" when the user clicks an internal link to another
 * pathname or when code calls `startRouteProgress()` before `router.push`; it "ends"
 * when `usePathname()` changes. Search-param-only changes are ignored (grids write
 * those with replaceState).
 *
 * The click listener runs in the CAPTURE phase on <html>: next/link calls
 * preventDefault() in its own handler, so a bubble-phase listener never saw link
 * clicks. The unsaved-changes guard stops propagation one level up (document capture),
 * so a blocked navigation never reaches this listener.
 *
 * After PENDING_DIM_MS of loading, `<html data-route-pending>` dims the main content.
 */
import * as React from "react";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";

export const ROUTE_PROGRESS_START_EVENT = "ks:route-progress-start";

const TRICKLE_MS = 300;
const TRICKLE_CEILING = 0.9;
const TRICKLE_FACTOR = 0.08;
const INITIAL_VALUE = 0.08;
const FADE_MS = 260;
/** A navigation that never lands (error, blocked by a guard) stops showing after this. */
const SAFETY_MS = 20_000;
/** Slow navigations dim the old page so it reads as "on its way out". */
export const PENDING_DIM_MS = 400;
export const ROUTE_PENDING_ATTRIBUTE = "data-route-pending";

/** Show the bar for a programmatic navigation (`router.push`) to `href`. */
export function startRouteProgress(href: string): void {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent<string>(ROUTE_PROGRESS_START_EVENT, { detail: href }));
}

/** Next trickle value: approaches the ceiling, never reaches 100% until the route lands. */
export function trickle(value: number): number {
  return Math.min(TRICKLE_CEILING, value + (TRICKLE_CEILING - value) * TRICKLE_FACTOR);
}

/** Pathname of an in-app navigation target, or null for external / same-page / new-tab links. */
export function internalTargetPath(href: string, current: URL): string | null {
  let url: URL;
  try {
    url = new URL(href, current);
  } catch {
    return null;
  }
  if (url.origin !== current.origin || url.pathname === current.pathname) return null;
  if (url.pathname.startsWith("/api/")) return null;
  return url.pathname;
}

function linkFromClick(event: MouseEvent): HTMLAnchorElement | null {
  if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return null;
  const anchor = event.target instanceof Element ? event.target.closest("a[href]") : null;
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  if ((anchor.target && anchor.target !== "_self") || anchor.hasAttribute("download")) return null;
  return anchor;
}

type Phase = "idle" | "loading" | "done";

function useRouteProgress(): { readonly phase: Phase; readonly value: number } {
  const pathname = usePathname();
  const [state, setState] = React.useState<{ readonly phase: Phase; readonly value: number; readonly from: string }>({ phase: "idle", value: 0, from: pathname });

  React.useEffect(() => {
    const start = (path: string | null): void => {
      if (path) setState({ phase: "loading", value: INITIAL_VALUE, from: window.location.pathname });
    };
    const onClick = (event: MouseEvent): void => {
      const anchor = linkFromClick(event);
      if (anchor) start(internalTargetPath(anchor.href, new URL(window.location.href)));
    };
    const onStart = (event: Event): void => {
      const href = event instanceof CustomEvent && typeof event.detail === "string" ? event.detail : null;
      if (href) start(internalTargetPath(href, new URL(window.location.href)));
    };
    const root = document.documentElement;
    root.addEventListener("click", onClick, true);
    window.addEventListener(ROUTE_PROGRESS_START_EVENT, onStart);
    return () => {
      root.removeEventListener("click", onClick, true);
      window.removeEventListener(ROUTE_PROGRESS_START_EVENT, onStart);
    };
  }, []);

  // Landed: the pathname moved away from where the navigation started.
  if (state.phase === "loading" && pathname !== state.from) setState({ phase: "done", value: 1, from: pathname });

  React.useEffect(() => {
    if (state.phase === "loading") {
      const root = document.documentElement;
      const tick = setInterval(() => setState((s) => (s.phase === "loading" ? { ...s, value: trickle(s.value) } : s)), TRICKLE_MS);
      const safety = setTimeout(() => setState((s) => ({ ...s, phase: "done", value: 1 })), SAFETY_MS);
      const dim = setTimeout(() => root.setAttribute(ROUTE_PENDING_ATTRIBUTE, ""), PENDING_DIM_MS);
      return () => {
        clearInterval(tick);
        clearTimeout(safety);
        clearTimeout(dim);
        root.removeAttribute(ROUTE_PENDING_ATTRIBUTE);
      };
    }
    if (state.phase === "done") {
      const fade = setTimeout(() => setState((s) => ({ ...s, phase: "idle", value: 0 })), FADE_MS);
      return () => clearTimeout(fade);
    }
    return undefined;
  }, [state.phase]);

  return { phase: state.phase, value: state.value };
}

export function RouteProgress({ className }: { readonly className?: string }) {
  const { phase, value } = useRouteProgress();
  return (
    <div
      role="progressbar"
      aria-label="Loading page"
      aria-hidden={phase === "idle"}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(value * 100)}
      data-route-progress=""
      className={cn("pointer-events-none absolute inset-x-0 top-full h-[2px] overflow-hidden", className)}
    >
      <div
        data-phase={phase}
        className={cn(
          "h-full origin-left bg-primary shadow-[0_0_6px_color-mix(in_srgb,var(--primary)_60%,transparent)] transition-[transform,opacity] ease-out",
          phase === "idle" ? "opacity-0 duration-0" : "opacity-100 duration-300",
          phase === "done" && "opacity-0 delay-150"
        )}
        style={{ transform: `scaleX(${value})` }}
      />
    </div>
  );
}
