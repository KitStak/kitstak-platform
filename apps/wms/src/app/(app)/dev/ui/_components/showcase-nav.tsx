"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { SHOWCASE_SECTIONS, type ShowcaseKey } from "./showcase-section";

/** Sticky header height (56px) plus breathing room; matches the sections' scroll margin. */
const HEADER_OFFSET_PX = 72;

/**
 * Picks the active section: the last one whose top has scrolled past the header line.
 * Pure so it can be unit tested without layout.
 */
export function pickActiveSection(tops: readonly { readonly key: ShowcaseKey; readonly top: number }[], offset = HEADER_OFFSET_PX): ShowcaseKey | null {
  const ordered = [...tops].sort((a, b) => a.top - b.top);
  let active: ShowcaseKey | null = ordered[0]?.key ?? null;
  for (const entry of ordered) if (entry.top - offset <= 1) active = entry.key;
  return active;
}

export interface SectionRect {
  readonly key: ShowcaseKey;
  readonly top: number;
  readonly bottom: number;
}

/** Visible height of a section between the sticky header line and the viewport bottom. */
export function visibleHeight(rect: SectionRect, viewportHeight: number, offset = HEADER_OFFSET_PX): number {
  return Math.max(0, Math.min(rect.bottom, viewportHeight) - Math.max(rect.top, offset));
}

/**
 * Picks the section occupying the most screen (ties go to the earlier section), so a
 * short section entering the viewport never steals the highlight from the one being read.
 * Pure so it can be unit tested without layout.
 */
export function pickMostVisibleSection(rects: readonly SectionRect[], viewportHeight: number, offset = HEADER_OFFSET_PX): ShowcaseKey | null {
  let best: { readonly key: ShowcaseKey; readonly visible: number } | null = null;
  for (const rect of [...rects].sort((a, b) => a.top - b.top)) {
    const visible = visibleHeight(rect, viewportHeight, offset);
    if (visible > 0 && (best === null || visible > best.visible)) best = { key: rect.key, visible };
  }
  return best?.key ?? pickActiveSection(rects, offset);
}

/** Thresholds every 5% so the observer reports while a section scrolls through. */
const OBSERVER_THRESHOLDS: readonly number[] = Array.from({ length: 21 }, (_, i) => i / 20);

function readHash(): ShowcaseKey | null {
  const id = decodeURIComponent(window.location.hash.slice(1));
  return SHOWCASE_SECTIONS.some((s) => s.key === id) ? (id as ShowcaseKey) : null;
}

/** Section side-nav with scroll-spy (IntersectionObserver) for /dev/ui. */
export function ShowcaseNav() {
  const [active, setActive] = React.useState<ShowcaseKey | null>(null);

  React.useEffect(() => {
    const nodes = SHOWCASE_SECTIONS.map((s) => document.getElementById(s.key)).filter((n): n is HTMLElement => n !== null);
    if (nodes.length === 0) return;
    const update = (): void => {
      const rects = nodes.map((node) => {
        const box = node.getBoundingClientRect();
        return { key: node.id as ShowcaseKey, top: box.top, bottom: box.bottom };
      });
      const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
      setActive(atBottom ? (rects[rects.length - 1]?.key ?? null) : pickMostVisibleSection(rects, window.innerHeight));
    };
    const observer = new IntersectionObserver(update, { rootMargin: `-${HEADER_OFFSET_PX}px 0px 0px 0px`, threshold: [...OBSERVER_THRESHOLDS] });
    nodes.forEach((node) => observer.observe(node));
    // First paint: honour a #hash deep link (HashScroll scrolls to it), else measure.
    const hash = readHash();
    const frame = requestAnimationFrame(() => (hash ? setActive(hash) : update()));
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, []);

  return (
    <nav aria-label="Showcase sections" className="hidden lg:block">
      <ul className="sticky top-20 space-y-0.5">
        {SHOWCASE_SECTIONS.map((s) => {
          const isActive = s.key === active;
          return (
            <li key={s.key}>
              <a
                href={`#${s.key}`}
                aria-current={isActive ? "location" : undefined}
                onClick={(event) => {
                  setActive(s.key);
                  // Drop focus after a mouse click so the old item never keeps a focus tint.
                  if (event.detail > 0) event.currentTarget.blur();
                }}
                className={cn(
                  "relative block rounded-md px-3 py-1.5 text-sm transition-colors hover:bg-neutral-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/60",
                  // Active = 2px indigo rail + indigo text; hover only ever changes the background.
                  "before:absolute before:inset-y-1 before:left-0 before:w-[2px] before:rounded-full before:bg-transparent before:transition-colors",
                  "aria-[current=location]:font-semibold aria-[current=location]:text-primary aria-[current=location]:before:bg-primary",
                  isActive ? "" : "text-body",
                )}
              >
                {s.label}
              </a>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
