"use client";

/**
 * Filter ▾ popover (BUILD_PLAN F4.3): "New" tab (field search, pinned favourites, typed
 * editor, Apply) and "Saved" tab (apply a saved view). Applying a field filter replaces
 * any existing filter on the same field.
 */
import * as React from "react";
import { ArrowLeft, Bookmark, ChevronRight, ListFilter, Plus, Search, Star } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GridFilter } from "@/server/query/grid-query";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { TextField } from "@/components/ui/text-field";
import { DisabledReason } from "@/components/ui/tooltip";
import { SegmentedTabs } from "@/components/ui/tabs";
import type { FilterFieldDef } from "../grid-types";
import type { SavedView } from "../use-saved-views";
import { useLocalList } from "../use-local-list";
import { FieldEditor } from "./field-editors";
import { draftToFilter, filterToDraft, orderByPinned, searchFields, type FilterDraft } from "./filter-model";

type Tab = "new" | "saved";

export interface FilterPopoverProps {
  readonly gridKey: string;
  readonly fields: readonly FilterFieldDef[];
  readonly filters: readonly GridFilter[];
  readonly onApply: (filter: GridFilter) => void;
  readonly savedViews?: readonly SavedView[];
  readonly onApplyView?: (view: SavedView) => void;
  /** Field to open directly (chip click). */
  readonly initialField?: string | null;
  /** Custom trigger element (e.g. a filter chip); must accept a ref. */
  readonly trigger?: React.ReactNode;
}

function FieldList({ fields, pinned, onPin, onPick }: { readonly fields: readonly FilterFieldDef[]; readonly pinned: readonly string[]; readonly onPin: (field: string) => void; readonly onPick: (def: FilterFieldDef) => void }) {
  const [query, setQuery] = React.useState("");
  const shown = orderByPinned(searchFields(fields, query), pinned);
  return (
    <div className="flex flex-col gap-2">
      <TextField size="sm" autoFocus value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search fields" aria-label="Search filter fields" leading={<Search className="h-3.5 w-3.5" aria-hidden />} />
      <ul className="ks-scroll flex max-h-72 flex-col overflow-auto" aria-label="Filter fields">
        {shown.length === 0 ? <li className="py-4 text-center text-[12px] text-faint">No fields match &ldquo;{query}&rdquo;</li> : null}
        {shown.map((def) => {
          const isPinned = pinned.includes(def.field);
          return (
            // Stable hooks per field row: the row is labelled by the field, the pick button's
            // accessible name is exactly the label (the description is its description).
            <li key={def.field} aria-label={def.label} data-filter-field={def.field} className="group flex items-center gap-1 rounded-md hover:bg-surface-sunken">
              <button
                type="button"
                aria-label={isPinned ? `Unpin ${def.label}` : `Pin ${def.label}`}
                aria-pressed={isPinned}
                onClick={() => onPin(def.field)}
                className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30", isPinned ? "text-warning" : "text-faint opacity-60 group-hover:opacity-100")}
              >
                <Star className={cn("h-3.5 w-3.5", isPinned && "fill-current")} aria-hidden />
              </button>
              <button type="button" aria-label={def.label} aria-describedby={def.description ? `ff-desc-${def.field}` : undefined} data-filter-pick={def.field} onClick={() => onPick(def)} className="flex min-w-0 flex-1 items-center justify-between gap-2 py-1.5 pr-2 text-left text-[13px] text-body focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30">
                <span className="min-w-0">
                  <span className="block truncate">{def.label}</span>
                  {def.description ? <span id={`ff-desc-${def.field}`} className="block truncate text-[11px] text-faint">{def.description}</span> : null}
                </span>
                <ChevronRight className="h-3.5 w-3.5 shrink-0 text-faint" aria-hidden />
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function EditorPanel({ def, existing, onBack, onApply }: { readonly def: FilterFieldDef; readonly existing: GridFilter | undefined; readonly onBack: () => void; readonly onApply: (filter: GridFilter) => void }) {
  const [draft, setDraft] = React.useState<FilterDraft>(() => filterToDraft(def, existing));
  const result = draftToFilter(def, draft);
  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        // Portalled out of the DOM but not the React tree: keep the submit from reaching a parent form (wizards).
        e.stopPropagation();
        if (result.ok) onApply(result.filter);
      }}
    >
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon-sm" aria-label="Back to fields" onClick={onBack}>
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
        </Button>
        <p className="text-[13px] font-semibold text-foreground">{def.label}</p>
      </div>
      <FieldEditor def={def} draft={draft} onChange={setDraft} />
      <div className="flex justify-end gap-2 border-t border-border pt-3">
        <Button variant="ghost" size="sm" onClick={onBack}>
          Cancel
        </Button>
        <DisabledReason reason={result.ok ? null : result.reason}>
          <Button type="submit" variant="primary" size="sm" disabled={!result.ok}>
            Apply
          </Button>
        </DisabledReason>
      </div>
    </form>
  );
}

function SavedList({ views, onApply }: { readonly views: readonly SavedView[]; readonly onApply: (view: SavedView) => void }) {
  if (views.length === 0) {
    return (
      <div className="flex flex-col items-center gap-1 py-6 text-center">
        <Bookmark className="h-5 w-5 text-faint" aria-hidden />
        <p className="text-[13px] font-semibold text-foreground">No saved views yet</p>
        <p className="text-[12px] text-faint">Apply filters, then use Save view to keep them.</p>
      </div>
    );
  }
  return (
    <ul className="ks-scroll flex max-h-72 flex-col overflow-auto" aria-label="Saved views">
      {views.map((v) => (
        <li key={v.id}>
          <button type="button" onClick={() => onApply(v)} className="flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-[13px] text-body hover:bg-surface-sunken focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/30">
            <span className="truncate">{v.name}</span>
            <span className="flex shrink-0 gap-1 text-[10px] font-semibold uppercase text-faint">
              {v.isDefault ? <span className="text-primary">Default</span> : null}
              {v.isShared ? <span>Shared</span> : null}
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function FilterPopover({ gridKey, fields, filters, onApply, savedViews = [], onApplyView, initialField, trigger }: FilterPopoverProps) {
  const [open, setOpenState] = React.useState(false);
  const [tab, setTab] = React.useState<Tab>("new");
  const [activeField, setActiveField] = React.useState<string | null>(null);
  const [storedPins, setPinned] = useLocalList(`ks:filter-pins:${gridKey}`);
  // Until the viewer pins their own fields, the grid's preset fields (FilterFieldDef.preset) are pinned.
  const presetPins = React.useMemo(() => fields.filter((f) => f.preset).map((f) => f.field), [fields]);
  const pinned = storedPins.length > 0 ? storedPins : presetPins;

  const setOpen = (next: boolean) => {
    if (next) {
      setActiveField(initialField ?? null);
      setTab("new");
    }
    setOpenState(next);
  };

  const active = fields.find((f) => f.field === activeField);
  const count = filters.length;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        {trigger ?? (
          <Button variant="secondary" className={cn("shrink-0", open && "border-primary text-primary")} disabled={fields.length === 0} aria-label={count ? `Filter, ${count} applied` : "Filter"}>
            <ListFilter className="h-3.5 w-3.5" aria-hidden />
            Filter
            {count > 0 ? <span className="rounded-full bg-primary px-1.5 text-[10px] font-bold text-white">{count}</span> : null}
          </Button>
        )}
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[320px] p-3">
        <div className="mb-3 flex items-center justify-between gap-2">
          <SegmentedTabs size="sm" ariaLabel="Filter mode" tabs={[{ key: "new", label: "New", icon: Plus }, { key: "saved", label: "Saved", count: savedViews.length }]} active={tab} onChange={(k) => setTab(k as Tab)} />
        </div>
        {tab === "saved" ? (
          <SavedList
            views={savedViews}
            onApply={(v) => {
              onApplyView?.(v);
              setOpen(false);
            }}
          />
        ) : active ? (
          <EditorPanel
            key={active.field}
            def={active}
            existing={filters.find((f) => f.field === active.field)}
            onBack={() => setActiveField(null)}
            onApply={(filter) => {
              onApply(filter);
              setOpen(false);
            }}
          />
        ) : (
          <FieldList fields={fields} pinned={pinned} onPin={(f) => setPinned(pinned.includes(f) ? pinned.filter((x) => x !== f) : [...pinned, f])} onPick={(def) => setActiveField(def.field)} />
        )}
      </PopoverContent>
    </Popover>
  );
}
