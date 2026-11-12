"use client";

/**
 * "All 100 on this page are selected · Select all 2,340 matching" banner. Selection is
 * id-based, so it survives paging; "all matching" lets bulk endpoints act on the query.
 */
import * as React from "react";
import { useFormat } from "@/lib/format";

export interface SelectionBannerProps {
  readonly pageCount: number;
  readonly pageAllSelected: boolean;
  readonly total: number;
  readonly selectedCount: number;
  readonly allMatching: boolean;
  readonly onSelectAllMatching?: () => void;
  readonly onClear: () => void;
}

export function SelectionBanner({ pageCount, pageAllSelected, total, selectedCount, allMatching, onSelectAllMatching, onClear }: SelectionBannerProps) {
  const fmt = useFormat();
  const offerAll = !allMatching && pageAllSelected && total > pageCount && Boolean(onSelectAllMatching);
  const showSelectedElsewhere = !allMatching && !pageAllSelected && selectedCount > 0 && selectedCount > pageCount;
  if (!allMatching && !offerAll && !showSelectedElsewhere) return null;
  return (
    <div role="status" className="flex items-center justify-center gap-2 border-b border-primary/20 bg-primary-soft px-4 py-1.5 text-xs text-body">
      {allMatching ? (
        <span>
          All <strong className="tabular-nums">{fmt.number(total)}</strong> matching records are selected.
        </span>
      ) : offerAll ? (
        <>
          <span>
            All <strong className="tabular-nums">{fmt.number(pageCount)}</strong> on this page are selected.
          </span>
          <button type="button" onClick={onSelectAllMatching} className="font-semibold text-primary hover:underline focus-visible:outline-none focus-visible:underline">
            Select all {fmt.number(total)} matching
          </button>
        </>
      ) : (
        <span>
          <strong className="tabular-nums">{fmt.number(selectedCount)}</strong> selected across pages.
        </span>
      )}
      <button type="button" onClick={onClear} className="font-semibold text-secondary hover:text-danger focus-visible:outline-none focus-visible:underline">
        Clear selection
      </button>
    </div>
  );
}
