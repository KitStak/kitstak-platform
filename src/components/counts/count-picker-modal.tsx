"use client";

/**
 * Add Location / Add Product / Add License Plate picker for the count wizard. Same behaviour as
 * the shared RecordPickerModal (full toolbar, filters, selection kept across pages), but the
 * grid takes the dialog's free height (flex-1), so the footer sits on the dialog's bottom edge
 * with no blank band below it. Search is debounced by the grid toolbar; previous rows stay on
 * screen while the next page loads.
 */
import * as React from "react";
import type { ColumnDef } from "@tanstack/react-table";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader } from "@/components/ui/dialog";
import { DisabledReason } from "@/components/ui/tooltip";
import { DataGrid } from "@/components/grid/data-grid";
import { GridToolbar } from "@/components/grid/grid-toolbar";
import type { FilterFieldDef } from "@/components/grid/grid-types";
import { useLocalGrid } from "@/components/grid/use-grid";
import { apiFetch } from "@/lib/api-client";
import { Spinner } from "@/components/ui/spinner";

export interface CountPickerModalProps<T> {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly description?: string;
  readonly gridKey: string;
  readonly path: string;
  readonly columns: ColumnDef<T, unknown>[];
  readonly fields?: readonly FilterFieldDef[];
  readonly getRowId: (row: T) => string;
  readonly extraQuery?: Readonly<Record<string, string>>;
  /** Already-added ids: shown but not selectable. */
  readonly excludeIds?: readonly string[];
  readonly confirmLabel?: string;
  readonly searchPlaceholder?: string;
  readonly onConfirm: (rows: readonly T[]) => void;
  /** Extra control shown above the grid (e.g. a location-type scope toggle). */
  readonly headerExtra?: React.ReactNode;
  /** Rows that can't be picked (e.g. already in another open count): not selectable, counted in the footer. */
  readonly isBlocked?: (row: T) => boolean;
  /** Footer note for blocked rows on the current page ("2 are in another open count"). */
  readonly blockedNote?: (n: number) => string;
}

/** Upper bound for a select-all-across-pages add (keeps one plan a workable size). */
export const PICKER_ALL_MAX = 20000;

/** "Add Location" -> "locations", "Add License Plate" -> "license plates". */
export function pluralNoun(title: string): string {
  const noun = title.replace(/^Add\s+/i, "").trim().toLowerCase();
  return noun ? `${noun}s` : "records";
}

function PickerBody<T>({ onOpenChange, title, description, gridKey, path, columns, fields = [], getRowId, extraQuery, excludeIds = [], confirmLabel = "Add", searchPlaceholder = "Search", onConfirm, headerExtra, isBlocked, blockedNote }: Omit<CountPickerModalProps<T>, "open">) {
  const g = useLocalGrid<T>({ gridKey, path, fields, extraQuery });
  const [picked, setPicked] = React.useState<ReadonlyMap<string, T>>(new Map());
  const excluded = React.useMemo(() => new Set(excludeIds), [excludeIds]);
  const onSelectionChange = (next: Readonly<Record<string, boolean>>) => {
    const merged = new Map(picked);
    for (const row of g.rows) {
      const id = getRowId(row);
      if (next[id]) merged.set(id, row);
      else merged.delete(id);
    }
    setPicked(merged);
    g.gridProps.onSelectionChange({ ...next });
  };
  const allMatching = g.gridProps.allMatchingSelected;
  const [loadingAll, setLoadingAll] = React.useState(false);
  const [allError, setAllError] = React.useState<string | null>(null);
  const count = allMatching ? Math.min(g.total, PICKER_ALL_MAX) : g.selectedIds.length;
  const blockedOnPage = isBlocked ? g.rows.filter((r) => isBlocked(r) && !excluded.has(getRowId(r))).length : 0;
  const reason = loadingAll ? "Loading every matching record…" : count === 0 ? "Select at least one record" : null;
  const selectable = (row: T) => !excluded.has(getRowId(row)) && !(isBlocked?.(row) ?? false);
  const confirm = async () => {
    if (!allMatching) {
      onConfirm(g.selectedIds.map((id) => picked.get(id)).filter((r): r is T => r !== undefined));
      onOpenChange(false);
      return;
    }
    // Select-all across pages: page through the same filtered query (1000 per request) so a
    // 5k+ SKU warehouse can be added in one go without paging by hand.
    setLoadingAll(true);
    setAllError(null);
    try {
      const base = new URLSearchParams(g.gridProps.queryString);
      for (const [k, v] of Object.entries(extraQuery ?? {})) base.set(k, v);
      base.set("pageSize", "1000");
      const out: T[] = [];
      for (let page = 1; out.length < PICKER_ALL_MAX; page++) {
        base.set("page", String(page));
        const rows = await apiFetch<T[]>(`${path}?${base.toString()}`);
        out.push(...rows);
        if (rows.length < 1000) break;
      }
      onConfirm(out.slice(0, PICKER_ALL_MAX).filter(selectable));
      onOpenChange(false);
    } catch (error) {
      setAllError(error instanceof Error ? error.message : "The records could not be loaded");
    } finally {
      setLoadingAll(false);
    }
  };

  return (
    <>
      <DialogHeader title={title} description={description} />
      <div className="flex min-h-0 flex-1 flex-col px-1 pt-1">
        {headerExtra}
        <GridToolbar {...g.toolbarProps} searchPlaceholder={searchPlaceholder} views={undefined} />
        {g.isLoading ? (
          // First page still on its way (large warehouses under load): say so plainly above the skeleton rows.
          <div role="status" aria-live="polite" className="mb-2 flex items-center gap-2 rounded-md border border-border bg-surface-sunken px-3 py-2 text-[12px] text-secondary">
            <Spinner className="h-3.5 w-3.5" />
            Loading {pluralNoun(title)}…
          </div>
        ) : null}
        <DataGrid<T> {...g.gridProps} gridKey={undefined} queryString={undefined} columns={columns} getRowId={getRowId} onSelectionChange={onSelectionChange}
          canSelectRow={(row) => !excluded.has(getRowId(row)) && !(isBlocked?.(row) ?? false)} onAllMatchingSelectedChange={g.gridProps.onAllMatchingSelectedChange} className="pb-3" />
      </div>
      <DialogFooter>
        <span className="mr-auto text-[12px] text-faint">{[g.isLoading ? "Loading the first page…" : null, excluded.size ? `${excluded.size} already in the plan` : null, blockedOnPage && blockedNote ? blockedNote(blockedOnPage) : null, allMatching ? `All ${count.toLocaleString()} matching records selected${g.total > PICKER_ALL_MAX ? ` (first ${PICKER_ALL_MAX.toLocaleString()})` : ""}; ones already in the plan or blocked are skipped` : null, allError].filter(Boolean).join(" · ")}</span>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>Cancel</Button>
        <DisabledReason reason={reason}>
          <Button variant="primary" disabled={Boolean(reason)} onClick={() => void confirm()}>{loadingAll ? <Spinner className="h-3.5 w-3.5" /> : null}{confirmLabel}{count ? ` (${count})` : ""}</Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}

export function CountPickerModal<T>({ open, ...props }: CountPickerModalProps<T>) {
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent size="full">{open ? <PickerBody<T> {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
