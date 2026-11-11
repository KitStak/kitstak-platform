"use client";

/**
 * Quick-search mode picker (Logiwa parity): Equal / Starts With, chosen in a popover and
 * confirmed with Apply. Rendered as the left addon of the grid search box.
 */
import * as React from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { QuickSearchMode } from "@/server/query/grid-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

export const SEARCH_MODE_LABELS: Readonly<Record<QuickSearchMode, string>> = { eq: "Equal", sw: "Starts With" };
const MODES: readonly QuickSearchMode[] = ["eq", "sw"];

export function SearchMode({ value, onChange }: { readonly value: QuickSearchMode; readonly onChange: (mode: QuickSearchMode) => void }) {
  const [open, setOpen] = React.useState(false);
  const [draft, setDraft] = React.useState<QuickSearchMode>(value);
  return (
    <Popover
      open={open}
      onOpenChange={(next) => {
        if (next) setDraft(value);
        setOpen(next);
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Search mode: ${SEARCH_MODE_LABELS[value]}`}
          className="inline-flex h-8 shrink-0 items-center gap-1 rounded-l-md border border-r-0 border-border-strong/70 bg-surface-sunken px-2.5 text-[12px] font-medium text-secondary transition-colors hover:text-body focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30"
        >
          {SEARCH_MODE_LABELS[value]}
          <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-52 p-2">
        <div role="radiogroup" aria-label="Search mode" className="flex flex-col gap-0.5">
          {MODES.map((mode) => (
            <label key={mode} className={cn("flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[13px] hover:bg-surface-sunken", draft === mode ? "text-primary" : "text-body")}>
              <input type="radio" name="grid-search-mode" className="accent-[var(--color-primary)]" checked={draft === mode} onChange={() => setDraft(mode)} />
              {SEARCH_MODE_LABELS[mode]}
            </label>
          ))}
        </div>
        <div className="mt-2 flex justify-end border-t border-border pt-2">
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              onChange(draft);
              setOpen(false);
            }}
          >
            Apply
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
