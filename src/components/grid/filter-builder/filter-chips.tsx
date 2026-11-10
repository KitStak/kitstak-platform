"use client";

/**
 * Applied-filter chips (BUILD_PLAN F4.3): two-line chips (field label / value), a remove
 * button on each, click-to-edit, and a "+N" overflow popover once more than
 * `maxVisible` filters are applied.
 */
import * as React from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GridFilter } from "@/server/query/grid-query";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import type { FilterFieldDef } from "../grid-types";
import type { SavedView } from "../use-saved-views";
import { FilterPopover } from "./filter-popover";
import { splitChips, toChips, type FilterChipModel } from "./filter-model";

export const DEFAULT_VISIBLE_CHIPS = 3;

interface ChipProps {
  readonly chip: FilterChipModel;
  readonly onRemove: () => void;
  readonly editor?: (trigger: React.ReactNode) => React.ReactNode;
}

const ChipBody = React.forwardRef<HTMLButtonElement, { readonly chip: FilterChipModel } & React.ButtonHTMLAttributes<HTMLButtonElement>>(function ChipBody({ chip, className, ...props }, ref) {
  return (
    <button ref={ref} type="button" title={`${chip.label}: ${chip.value}`} className={cn("flex min-w-0 max-w-[220px] flex-col items-start py-0.5 pl-2.5 pr-1 text-left leading-tight focus-visible:outline-none", className)} {...props}>
      <span className="block w-full truncate whitespace-nowrap text-[10px] font-semibold uppercase tracking-[0.04em] text-info/80">{chip.label}</span>
      <span className="w-full truncate text-[12px] font-medium text-foreground">{chip.value}</span>
    </button>
  );
});

function Chip({ chip, onRemove, editor }: ChipProps) {
  const body = <ChipBody chip={chip} aria-label={`Edit ${chip.label} filter`} />;
  return (
    <span className="inline-flex h-9 shrink-0 items-center rounded-lg border border-info/30 bg-info-soft transition-colors focus-within:ring-2 focus-within:ring-info/30 hover:border-info/60">
      {editor ? editor(body) : body}
      <button type="button" aria-label={`Remove ${chip.label} filter`} onClick={onRemove} className="mr-1.5 flex h-5 w-5 items-center justify-center rounded text-info/70 transition-colors hover:bg-info/10 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30">
        <X className="h-3 w-3" aria-hidden />
      </button>
    </span>
  );
}

export interface FilterChipsProps {
  readonly gridKey: string;
  readonly fields: readonly FilterFieldDef[];
  readonly filters: readonly GridFilter[];
  readonly onRemove: (field: string) => void;
  readonly onApply: (filter: GridFilter) => void;
  readonly onClearAll?: () => void;
  readonly savedViews?: readonly SavedView[];
  readonly maxVisible?: number;
}

export function FilterChips({ gridKey, fields, filters, onRemove, onApply, onClearAll, savedViews, maxVisible = DEFAULT_VISIBLE_CHIPS }: FilterChipsProps) {
  const chips = toChips(filters, fields);
  if (chips.length === 0) return null;
  const { visible, overflow } = splitChips(chips, maxVisible);
  const editorFor = (chip: FilterChipModel) =>
    fields.some((f) => f.field === chip.field)
      ? (trigger: React.ReactNode) => <FilterPopover gridKey={gridKey} fields={fields} filters={filters} onApply={onApply} savedViews={savedViews} initialField={chip.field} trigger={trigger} />
      : undefined;

  return (
    <div className="flex min-w-[8.5rem] flex-nowrap items-center gap-1.5 overflow-x-auto p-0.5 [scrollbar-width:thin]" aria-label="Applied filters">
      {visible.map((chip) => (
        <Chip key={chip.key} chip={chip} onRemove={() => onRemove(chip.field)} editor={editorFor(chip)} />
      ))}
      {overflow.length > 0 ? (
        <Popover>
          <PopoverTrigger asChild>
            <button type="button" aria-label={`Show ${overflow.length} more filters`} className="inline-flex h-9 shrink-0 items-center rounded-lg border border-info/30 bg-surface px-2.5 text-[12px] font-semibold text-info hover:bg-info-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-info/30">
              +{overflow.length}
            </button>
          </PopoverTrigger>
          <PopoverContent align="start" className="flex w-[280px] flex-col gap-1.5 p-2">
            {overflow.map((chip) => (
              <Chip key={chip.key} chip={chip} onRemove={() => onRemove(chip.field)} />
            ))}
          </PopoverContent>
        </Popover>
      ) : null}
      {onClearAll ? (
        <button type="button" onClick={onClearAll} className="px-1.5 text-[12px] font-semibold text-secondary hover:text-danger focus-visible:outline-none focus-visible:underline">
          Clear
        </button>
      ) : null}
    </div>
  );
}
