"use client";

/**
 * Grid footer: density (Large/Small), page size (100–1000), Total / Selected counts and
 * the `|< < [n] / N > >|` pager. The page input commits on Enter or blur.
 */
import * as React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useFormat } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";
import { GRID_DENSITIES, PAGE_SIZE_OPTIONS, type GridDensity } from "./grid-types";

export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(Math.max(0, total) / Math.max(1, pageSize)));
}

export function clampPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page)) return 1;
  return Math.min(pageCount, Math.max(1, Math.trunc(page)));
}

/** Page-size choices; a legacy non-standard size is kept so the select stays valid. */
export function pageSizeChoices(current: number): readonly number[] {
  return PAGE_SIZE_OPTIONS.includes(current) ? PAGE_SIZE_OPTIONS : [...PAGE_SIZE_OPTIONS, current].sort((a, b) => a - b);
}

function PageInput({ page, pageCount, onPageChange }: { readonly page: number; readonly pageCount: number; readonly onPageChange: (page: number) => void }) {
  const [text, setText] = React.useState<string | null>(null);
  const commit = () => {
    if (text === null) return;
    const next = clampPage(Number(text), pageCount);
    setText(null);
    if (next !== page) onPageChange(next);
  };
  return (
    <span className="flex items-center gap-1.5 px-1 text-[12px] text-secondary">
      <input
        aria-label="Page number"
        inputMode="numeric"
        value={text ?? String(page)}
        onChange={(e) => setText(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setText(null);
        }}
        className="h-7 w-11 rounded-md border border-border-strong/70 bg-surface text-center text-[12px] font-semibold tabular-nums text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/25"
      />
      <span className="tabular-nums">/ {pageCount.toLocaleString()}</span>
    </span>
  );
}

export interface GridFooterProps {
  readonly total: number;
  readonly page: number;
  readonly pageSize: number;
  readonly selectedCount: number;
  readonly density: GridDensity;
  readonly onDensityChange: (density: GridDensity) => void;
  readonly onPageChange: (page: number) => void;
  readonly onPageSizeChange?: (size: number) => void;
  readonly trailing?: React.ReactNode;
}

export function GridFooter({ total, page, pageSize, selectedCount, density, onDensityChange, onPageChange, onPageSizeChange, trailing }: GridFooterProps) {
  const fmt = useFormat();
  const pageCount = pageCountOf(total, pageSize);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-surface px-4 py-2">
      <div className="flex items-center gap-3">
        <div role="radiogroup" aria-label="Row density" className="flex rounded-md border border-border p-0.5">
          {GRID_DENSITIES.map((d) => (
            <button key={d} type="button" role="radio" aria-checked={density === d} onClick={() => onDensityChange(d)} className={cn("rounded px-2 py-0.5 text-[11px] font-semibold transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/30", density === d ? "bg-primary text-white" : "text-secondary hover:bg-surface-sunken")}>
              {d}
            </button>
          ))}
        </div>
        {onPageSizeChange ? (
          <div className="w-[128px]">
            <Select
              aria-label="Rows per page"
              size="sm"
              value={String(pageSize)}
              options={pageSizeChoices(pageSize).map((n) => ({ value: String(n), label: `Show ${n} items` }))}
              onChange={(next) => {
                if (next !== null) onPageSizeChange(Number(next));
              }}
              className="h-7 text-[11px] font-medium text-secondary"
              contentClassName="text-[12px]"
            />
          </div>
        ) : null}
        <span className="text-[12px] text-secondary" aria-live="polite">
          Total: <span className="font-semibold tabular-nums text-foreground">{fmt.number(total)}</span>
          <span className="mx-2 text-border-strong">|</span>
          Selected: <span className={cn("font-semibold tabular-nums", selectedCount > 0 ? "text-primary" : "text-foreground")}>{fmt.number(selectedCount)}</span>
        </span>
      </div>
      <nav aria-label="Pagination" className="flex items-center gap-0.5">
        <Button variant="ghost" size="icon-sm" aria-label="First page" disabled={page <= 1} onClick={() => onPageChange(1)}>
          <ChevronsLeft className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Previous page" disabled={page <= 1} onClick={() => onPageChange(page - 1)}>
          <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <PageInput key={page} page={page} pageCount={pageCount} onPageChange={onPageChange} />
        <Button variant="ghost" size="icon-sm" aria-label="Next page" disabled={page >= pageCount} onClick={() => onPageChange(page + 1)}>
          <ChevronRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <Button variant="ghost" size="icon-sm" aria-label="Last page" disabled={page >= pageCount} onClick={() => onPageChange(pageCount)}>
          <ChevronsRight className="h-3.5 w-3.5" aria-hidden />
        </Button>
      </nav>
      <div className="flex items-center gap-3">{trailing}</div>
    </div>
  );
}
