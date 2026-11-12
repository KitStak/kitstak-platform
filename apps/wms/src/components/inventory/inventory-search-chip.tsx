'use client';

/**
 * Active quick-search chip (Logiwa parity: "Product SKU equals X ×"). The search text and its
 * comparator already live in the URL (`?q=X&qm=eq`, Starts With is the default and omitted),
 * so a shared link reproduces the view; the chip makes that state visible and removable
 * next to the other toolbar controls.
 */
import { X } from 'lucide-react';
import type { QuickSearchMode } from '@/server/query/grid-query';

/** "SKU equals" / "SKU or barcode starts with". */
export function searchChipLabel(mode: QuickSearchMode, noun: string): string {
  return `${noun} ${mode === 'eq' ? 'equals' : 'starts with'}`;
}

/** "MLT1 - Main Fulfillment" → "MLT1" (labels without a code are returned unchanged). */
export function warehouseCodeOf(label: string): string {
  const i = label.indexOf(' - ');
  return i > 0 ? label.slice(0, i) : label;
}

export function SearchChip({
  grid,
  noun,
}: {
  readonly grid: {
    readonly query: { readonly q?: string; readonly qm: QuickSearchMode };
    readonly setSearch: (q: string) => void;
  };
  readonly noun: string;
}) {
  const q = grid.query.q?.trim();
  if (!q) return null;
  const label = searchChipLabel(grid.query.qm, noun);
  return (
    // Neutral blue (info) chip, never brand red: red reads as a validation error.
    <span
      className="inline-flex h-8 max-w-[260px] shrink-0 items-center rounded-md border border-info/30 bg-info-soft"
      data-testid="search-chip"
    >
      <span className="flex min-w-0 flex-col py-0.5 pl-2.5 pr-1 leading-tight" title={`${label} ${q}`}>
        <span className="truncate text-2xs font-semibold text-info">{label}</span>
        <span className="truncate text-xs font-medium text-foreground">{q}</span>
      </span>
      <button
        type="button"
        aria-label={`Remove search ${label} ${q}`}
        onClick={() => grid.setSearch('')}
        className="mr-1.5 flex h-5 w-5 shrink-0 items-center justify-center rounded text-info/80 transition-colors hover:bg-info/10 hover:text-info focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus/40"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </span>
  );
}
