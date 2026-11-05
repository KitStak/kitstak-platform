"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface PoTab {
  key: string;
  label: string;
  count?: number;
}

/**
 * Local underline tabs for the receiving module.
 *
 * The shared `UnderlineTabs` (read-only here) draws the active indicator as a
 * `border-b-2` pulled over the container rule with `-mb-px`, which can bleed
 * past the label and leave hairline fragments under inactive tabs. This
 * version renders the 2px accent as an absolutely-positioned span that spans
 * exactly the tab's padding box, and inactive tabs carry no border at all.
 */
export function PoTabs({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: PoTab[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn("flex items-center gap-6 border-b border-border px-6", className)}
    >
      {tabs.map((tab) => {
        const isActive = tab.key === active;
        return (
          <button
            key={tab.key}
            role="tab"
            type="button"
            aria-selected={isActive}
            onClick={() => onChange(tab.key)}
            className={cn(
              "relative flex items-center gap-1.5 pb-2.5 pt-2.5 text-[12px] font-semibold uppercase tracking-[0.02em]",
              "outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/40",
              isActive ? "text-primary" : "text-faint hover:text-secondary"
            )}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] tabular-nums",
                  isActive ? "bg-primary-soft text-primary" : "bg-neutral-soft text-neutral"
                )}
              >
                {tab.count}
              </span>
            ) : null}
            {isActive ? (
              <span
                aria-hidden
                className="absolute inset-x-0 -bottom-px h-0.5 rounded-full bg-primary"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
