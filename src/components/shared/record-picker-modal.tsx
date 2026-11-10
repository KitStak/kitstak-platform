"use client";

/**
 * Generic record picker (BUILD_PLAN F4.4): "Add Location" / "Add Product" modal with
 * the full toolbar (search mode, filter builder, chips) over any list endpoint, and
 * checkbox selection that survives paging. Grid state stays in memory (no URL change).
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

export interface RecordPickerProps<T> {
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
  readonly maxSelection?: number;
  readonly confirmLabel?: string;
  readonly searchPlaceholder?: string;
  readonly onConfirm: (rows: readonly T[]) => void | Promise<void>;
}

function PickerBody<T>({ onOpenChange, title, description, gridKey, path, columns, fields = [], getRowId, extraQuery, excludeIds = [], maxSelection, confirmLabel = "Add", searchPlaceholder = "Search", onConfirm }: Omit<RecordPickerProps<T>, "open">) {
  const g = useLocalGrid<T>({ gridKey, path, fields, extraQuery });
  const [picked, setPicked] = React.useState<ReadonlyMap<string, T>>(new Map());
  const [pending, setPending] = React.useState(false);
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
  const count = g.selectedIds.length;
  const reason = pending ? "Adding…" : count === 0 ? "Select at least one record" : maxSelection && count > maxSelection ? `Select at most ${maxSelection}` : null;

  const confirm = async () => {
    const rows = g.selectedIds.map((id) => picked.get(id)).filter((r): r is T => r !== undefined);
    setPending(true);
    try {
      await onConfirm(rows);
      onOpenChange(false);
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      <DialogHeader title={title} description={description} />
      <div className="flex h-[65vh] min-h-0 flex-col">
        <GridToolbar {...g.toolbarProps} searchPlaceholder={searchPlaceholder} views={undefined} />
        <DataGrid<T> {...g.gridProps} gridKey={undefined} queryString={undefined} columns={columns} getRowId={getRowId} onSelectionChange={onSelectionChange} canSelectRow={(row) => !excluded.has(getRowId(row))} onAllMatchingSelectedChange={undefined} className="pb-3" />
      </div>
      <DialogFooter>
        <span className="mr-auto text-[12px] text-secondary">
          Selected: <strong className="text-foreground">{count}</strong>
        </span>
        <Button variant="secondary" onClick={() => onOpenChange(false)}>
          Cancel
        </Button>
        <DisabledReason reason={reason}>
          <Button variant="primary" disabled={Boolean(reason)} onClick={() => void confirm()}>
            {confirmLabel}
            {count ? ` (${count})` : ""}
          </Button>
        </DisabledReason>
      </DialogFooter>
    </>
  );
}

export function RecordPickerModal<T>({ open, ...props }: RecordPickerProps<T>) {
  return (
    <Dialog open={open} onOpenChange={props.onOpenChange}>
      <DialogContent size="full">{open ? <PickerBody<T> {...props} /> : null}</DialogContent>
    </Dialog>
  );
}
