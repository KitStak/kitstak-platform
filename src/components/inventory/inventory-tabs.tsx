"use client";

import { cn, formatNumber } from "@/lib/utils";

export interface InventoryTabItem {
  key: string;
  label: string;
  count?: number;
}

interface InventoryTabsProps {
  tabs: InventoryTabItem[];
  active: string;
  onChange: (key: string) => void;
  className?: string;
}

/**
 * Local tab strip for the inventory page, matching Logiwa's TOTAL INVENTORY
 * strip: one continuous 1px hairline runs under the full width of the row and
 * only the active tab's 2px blue underline sits on top of it (-mb-px).
 * Inactive tabs never draw their own underline — not even on hover — so no
 * detached gray stub ever ends mid-air. Counts render with thousands
 * separators ("1,089", not "1089").
 *
 * Local alternative to the shared UnderlineTabs (read-only), which renders
 * raw counts and whose hairline treatment we cannot change from here.
 */
export function InventoryTabs({ tabs, active, onChange, className }: InventoryTabsProps) {
  return (
    <div
      role="tablist"
      className={cn("flex w-full items-center gap-6 border-b border-border px-6", className)}
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
              "-mb-px flex items-center gap-1.5 border-b-2 pb-2 pt-2.5 text-[12px] font-semibold uppercase tracking-[0.02em] transition-colors",
              isActive
                ? "border-primary text-primary"
                : "border-transparent text-faint hover:text-secondary"
            )}
            /* Inline style, not a class: a global (read-only) stylesheet rule
               overrides every Tailwind border-color utility — even
               `border-transparent` computes to the gray --border token — which
               painted a faint 2px gray bar under each INACTIVE tab and turned
               the active underline gray. The inline declaration wins the
               cascade: inactive tabs keep the reserved 2px space but render
               nothing; only the active tab draws the blue bar. */
            style={{
              borderBottomColor: isActive ? "var(--primary)" : "transparent",
            }}
          >
            {tab.label}
            {typeof tab.count === "number" ? (
              <span
                className={cn(
                  "rounded-full px-1.5 py-px text-[10px] tabular-nums",
                  isActive ? "bg-primary-soft text-primary" : "bg-neutral-soft text-neutral"
                )}
              >
                {formatNumber(tab.count)}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
