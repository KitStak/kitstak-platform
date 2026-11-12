"use client";

/**
 * Edge fades + scroll arrows for a horizontally scrolling strip rendered by a shared primitive
 * (the detail page's UnderlineTabs list, the wizard stepper). The strip already scrolls
 * (`overflow-x-auto`); this makes the overflow visible: a fade and a chevron button on each
 * edge that has hidden content. The scroller is found inside `children` by `selector`.
 * Arrows are pointer affordances (aria-hidden, tabIndex -1): keyboard users already reach
 * every tab / step with Tab or the arrow keys, which scroll it into view.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

export interface OverflowEdges {
  readonly start: boolean;
  readonly end: boolean;
}

/** Which edges hide content (1px slack absorbs sub-pixel scroll widths). */
export function overflowEdges(m: { readonly scrollLeft: number; readonly scrollWidth: number; readonly clientWidth: number }): OverflowEdges {
  const max = m.scrollWidth - m.clientWidth;
  if (max <= 1) return { start: false, end: false };
  return { start: m.scrollLeft > 1, end: m.scrollLeft < max - 1 };
}

export function OverflowFade({
  selector,
  children,
  className,
  fadeClassName = "from-surface",
  label = "items",
}: {
  readonly selector: string;
  readonly children: React.ReactNode;
  readonly className?: string;
  /** Gradient start colour, matching the strip's background. */
  readonly fadeClassName?: string;
  readonly label?: string;
}) {
  const rootRef = React.useRef<HTMLDivElement>(null);
  const [edges, setEdges] = React.useState<OverflowEdges>({ start: false, end: false });

  const scroller = React.useCallback((): HTMLElement | null => rootRef.current?.querySelector<HTMLElement>(selector) ?? null, [selector]);

  React.useEffect(() => {
    const el = scroller();
    if (!el) return;
    const update = () => {
      const next = overflowEdges(el);
      setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
    };
    update();
    el.addEventListener("scroll", update, { passive: true });
    const ro = typeof ResizeObserver !== "undefined" ? new ResizeObserver(update) : null;
    ro?.observe(el);
    if (el.firstElementChild) ro?.observe(el.firstElementChild);
    // Keep the active tab / current step in view when it changes (keyboard or programmatic).
    const keepActiveVisible = () => {
      const active = el.querySelector<HTMLElement>('[aria-selected="true"], [aria-current="step"]');
      if (!active) return;
      const a = active.getBoundingClientRect();
      const r = el.getBoundingClientRect();
      if (a.left < r.left || a.right > r.right) active.scrollIntoView({ block: "nearest", inline: "nearest" });
    };
    const mo = typeof MutationObserver !== "undefined" ? new MutationObserver(() => { keepActiveVisible(); update(); }) : null;
    mo?.observe(el, { subtree: true, attributes: true, attributeFilter: ["aria-selected", "aria-current"], childList: true });
    keepActiveVisible();
    return () => {
      el.removeEventListener("scroll", update);
      ro?.disconnect();
      mo?.disconnect();
    };
  }, [scroller]);

  const nudge = (dir: -1 | 1) => {
    const el = scroller();
    if (!el) return;
    el.scrollBy({ left: dir * Math.max(120, Math.round(el.clientWidth * 0.6)), behavior: "smooth" });
  };

  return (
    <div ref={rootRef} className={cn("relative min-w-0", className)} data-overflow-start={edges.start || undefined} data-overflow-end={edges.end || undefined}>
      {children}
      {edges.start ? (
        <div className={cn("pointer-events-none absolute inset-y-0 left-0 flex w-12 items-center bg-gradient-to-r to-transparent", fadeClassName)}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            title={`Scroll ${label} left`}
            onClick={() => nudge(-1)}
            className="pointer-events-auto ml-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-secondary shadow-xs hover:text-foreground"
          >
            <ChevronLeft className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
      {edges.end ? (
        <div className={cn("pointer-events-none absolute inset-y-0 right-0 flex w-12 items-center justify-end bg-gradient-to-l to-transparent", fadeClassName)}>
          <button
            type="button"
            tabIndex={-1}
            aria-hidden
            title={`Scroll ${label} right`}
            onClick={() => nudge(1)}
            className="pointer-events-auto mr-0.5 flex h-7 w-7 items-center justify-center rounded-full border border-border bg-surface text-secondary shadow-xs hover:text-foreground"
          >
            <ChevronRight className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}
    </div>
  );
}
