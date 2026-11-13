'use client';

/**
 * Logiwa "Inventory Transaction Summary": SKU · LOCATION · CURRENT QTY · QTY CHANGE (signed,
 * green/red) · AFTER. CURRENT QTY is the on-hand at the row's location (0 when none); a row
 * still loading shows a labelled "Loading…", and one that could not be read shows "n/a".
 */
import * as React from 'react';
import { Spinner } from '@/components/ui/spinner';
import { cn } from '@/lib/utils';
import { signed, type DeltaLine } from '@/lib/grid-defs/work-orders/kit-steps';

export function KitDeltaTable({
  lines,
  caption,
  currentLabel = 'Current qty',
  flags,
  unavailable,
  actions,
}: {
  readonly lines: readonly DeltaLine[];
  readonly caption: string;
  readonly currentLabel?: string;
  /** Optional per-row marker (e.g. short / locked), keyed by line key. */
  readonly flags?: Readonly<Record<string, React.ReactNode>>;
  /** Line keys whose current quantity could not be loaded (shown as "n/a", not a spinner). */
  readonly unavailable?: ReadonlySet<string>;
  /** Optional per-row actions (e.g. print barcode, edit attributes), keyed by line key. */
  readonly actions?: Readonly<Record<string, React.ReactNode>>;
}) {
  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full border-collapse text-xs">
        <caption className="sr-only">{caption}</caption>
        <thead className="bg-surface-sunken text-left text-2xs font-semibold text-faint">
          <tr>
            <th scope="col" className="px-3 py-2">
              SKU
            </th>
            <th scope="col" className="px-3 py-2">
              Location
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              {currentLabel}
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              Qty change
            </th>
            <th scope="col" className="px-3 py-2 text-right">
              After
            </th>
            {actions ? (
              <th scope="col" className="w-20 px-2 py-2">
                <span className="sr-only">Actions</span>
              </th>
            ) : null}
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => {
            const na = unavailable?.has(l.key) ?? false;
            const current = l.current ?? null;
            return (
              <tr key={l.key} className="border-t border-border">
                <td className="px-3 py-1.5 font-semibold text-foreground">{l.sku}</td>
                <td className="px-3 py-1.5 text-secondary">{l.location}</td>
                <td className="px-3 py-1.5 text-right tabular-nums text-secondary">
                  <span className="inline-flex items-center gap-1">
                    {flags?.[l.key]}
                    {current !== null ? (
                      current
                    ) : na ? (
                      <span title="Current quantity could not be loaded" className="text-faint">
                        n/a
                      </span>
                    ) : (
                      <span role="status" className="inline-flex items-center gap-1 text-faint">
                        <Spinner className="h-3 w-3" label="Loading current quantity" />
                        Loading…
                      </span>
                    )}
                  </span>
                </td>
                <td
                  className={cn(
                    'px-3 py-1.5 text-right font-semibold tabular-nums',
                    l.change > 0 ? 'text-success' : l.change < 0 ? 'text-danger' : 'text-faint',
                  )}
                >
                  {signed(l.change)}
                </td>
                <td className="px-3 py-1.5 text-right tabular-nums text-foreground">
                  {current !== null ? current + l.change : 'None'}
                </td>
                {actions ? (
                  <td className="px-2 py-1 text-right">
                    <span className="inline-flex items-center justify-end gap-0.5">
                      {actions[l.key] ?? null}
                    </span>
                  </td>
                ) : null}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function QtyChip({ label, value }: { readonly label: string; readonly value: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-surface-sunken px-2 py-0.5 text-2xs text-secondary">
      {label} <strong className="tabular-nums text-foreground">{value}</strong>
    </span>
  );
}
