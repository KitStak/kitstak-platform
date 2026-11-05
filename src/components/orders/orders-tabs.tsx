"use client";

import { cn } from "@/lib/utils";

export interface OrdersTabItem {
  key: string;
  label: string;
  count?: number;
}

export interface OrdersTabsProps {
  tabs: OrdersTabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * Local tab row for the Shipment Orders page.
 *
 * Unlike the shared UnderlineTabs, inactive tabs carry no border or shadow at
 * all — the 2px accent underline is drawn as an ::after bar on the active tab
 * only, so the single 1px hairline on the container runs the full row width
 * with no fragments under inactive tabs.
 */
export function OrdersTabs({ tabs, active, onChange, className }: OrdersTabsProps) {
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
              "relative flex items-center gap-1.5 border-0 pb-2 pt-2.5 text-[12px] font-semibold uppercase tracking-[0.02em] shadow-none transition-colors",
              isActive
                ? "text-primary after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:bg-primary"
                : "text-faint hover:text-secondary"
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
          </button>
        );
      })}
    </div>
  );
}
