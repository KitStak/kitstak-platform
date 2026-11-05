"use client";

import * as React from "react";
import { cn } from "@/lib/utils";

export interface SettingsTabItem {
  key: string;
  label: string;
  count?: number;
}

export interface SettingsTabsProps {
  tabs: SettingsTabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * Local tab strip for the Settings page.
 *
 * Unlike the shared UnderlineTabs, inactive tabs carry no underline of their
 * own (no per-tab bottom bars that read as scroll-track artifacts): the row
 * draws one continuous 1px bottom border and only the active tab renders the
 * 2px primary indicator, absolutely positioned so switching tabs never
 * shifts layout.
 */
export function SettingsTabs({ tabs, active, onChange, className }: SettingsTabsProps) {
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
              "relative flex items-center gap-1.5 rounded-sm pb-2 pt-2.5 text-[12px] font-semibold uppercase tracking-[0.02em] transition-colors",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2",
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
