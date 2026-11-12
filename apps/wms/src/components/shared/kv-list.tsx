/**
 * Key/value list for detail pages and summary rails. Empty values render the shared
 * em dash; `columns` lays items out in a responsive grid.
 */
import * as React from "react";
import { cn } from "@/lib/utils";
import { EMPTY_VALUE } from "@/lib/format";
import { InfoTip } from "@/components/ui/info-tip";

export interface KvItem {
  readonly key: string;
  readonly label: React.ReactNode;
  readonly value: React.ReactNode;
  readonly tip?: React.ReactNode;
  /** Span the full row. */
  readonly full?: boolean;
}

const COLS = { 1: "grid-cols-1", 2: "grid-cols-1 sm:grid-cols-2", 3: "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3", 4: "grid-cols-2 lg:grid-cols-4" } as const;

function isEmpty(value: React.ReactNode): boolean {
  return value === null || value === undefined || value === "" || value === false;
}

export function KvList({ items, columns = 2, layout = "stacked", className }: { readonly items: readonly KvItem[]; readonly columns?: keyof typeof COLS; readonly layout?: "stacked" | "inline"; readonly className?: string }) {
  return (
    <dl className={cn("grid gap-x-6 gap-y-3", COLS[columns], className)}>
      {items.map((item) => (
        <div key={item.key} className={cn(layout === "inline" ? "flex items-baseline justify-between gap-3" : "flex flex-col gap-0.5", item.full && "col-span-full")}>
          <dt className="flex items-center gap-1 text-2xs font-semibold text-faint">
            {item.label}
            {item.tip ? <InfoTip content={item.tip} /> : null}
          </dt>
          <dd className={cn("min-w-0 break-words text-sm text-foreground", layout === "inline" && "text-right")}>{isEmpty(item.value) ? <span className="text-faint">{EMPTY_VALUE}</span> : item.value}</dd>
        </div>
      ))}
    </dl>
  );
}
