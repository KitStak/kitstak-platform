'use client';

/**
 * Ship result window (Logiwa parity, outbound live capture §6): always shown after Ship.
 * Title "All orders shipped" / "Some orders couldn't be shipped" / "No orders could be shipped",
 * Success N / Error N badges and a Plan | SO code | Result | Description table, one row per order
 * (plan-level failures such as "no orders" get one row with an em dash for the order).
 */
import * as React from 'react';
import Link from 'next/link';
import { ArrowRightLeft, CheckCircle2, XCircle } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { shipResultTitle, type ShipResultRow } from './ship-result';

export { shipResultRows, shipStatusNotes, type ShipResultRow } from './ship-result';

export function ShipResultDialog({
  rows,
  notes = [],
  onClose,
}: {
  readonly rows: readonly ShipResultRow[] | null;
  readonly notes?: readonly string[];
  readonly onClose: () => void;
}) {
  const list = rows ?? [];
  const success = list.filter((r) => r.ok).length;
  const errors = list.length - success;
  return (
    <Dialog open={rows !== null} onOpenChange={(o) => (o ? undefined : onClose())}>
      <DialogContent size="lg" aria-describedby={undefined}>
        <DialogHeader
          title={shipResultTitle(list)}
          description={
            errors === 0
              ? 'Every order left inventory and is on its way.'
              : success > 0
                ? 'Shipped orders already left inventory. Fix the reasons below, then ship the rest.'
                : 'Nothing left inventory. Fix the reasons below and ship again.'
          }
        >
          <div className="mt-2 flex items-center gap-2" role="status">
            <Badge tone="success" icon={CheckCircle2}>
              Success {success}
            </Badge>
            <Badge tone={errors > 0 ? 'danger' : 'neutral'} icon={XCircle}>
              Error {errors}
            </Badge>
          </div>
          {notes.length > 0 ? (
            <ul
              className="mt-2 flex flex-col gap-1 rounded-md bg-info-soft px-3 py-2 text-xs text-body"
              aria-label="Plan status changes"
            >
              {notes.map((n) => (
                <li key={n} className="flex items-start gap-1.5">
                  <ArrowRightLeft className="mt-0.5 h-3.5 w-3.5 shrink-0 text-info" aria-hidden />
                  {n}
                </li>
              ))}
            </ul>
          ) : null}
        </DialogHeader>
        <DialogBody className="p-0">
          {list.length === 0 ? (
            <p className="px-5 py-6 text-center text-secondary">No orders were processed.</p>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 bg-surface-sunken">
                <tr>
                  {['Plan', 'SO code', 'Result', 'Description'].map((h) => (
                    <th
                      key={h}
                      scope="col"
                      className="border-b border-border px-4 py-2 text-2xs font-semibold text-faint"
                    >
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {list.map((r, i) => (
                  <tr
                    key={`${r.planCode}-${r.orderCode ?? 'plan'}-${i}`}
                    className="border-b border-border last:border-b-0"
                  >
                    <td className="px-4 py-2 font-medium text-body">{r.planCode}</td>
                    <td className="px-4 py-2">
                      {r.orderCode ? (
                        <Link
                          href={`/orders/${encodeURIComponent(r.orderCode)}`}
                          className="text-primary hover:underline"
                        >
                          {r.orderCode}
                        </Link>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-2">
                      <span
                        className={
                          r.ok
                            ? 'inline-flex items-center gap-1 text-success'
                            : 'inline-flex items-center gap-1 text-danger'
                        }
                      >
                        {r.ok ? (
                          <CheckCircle2 className="h-3.5 w-3.5" aria-hidden />
                        ) : (
                          <XCircle className="h-3.5 w-3.5" aria-hidden />
                        )}
                        {r.ok ? 'Success' : 'Error'}
                      </span>
                    </td>
                    <td className="px-4 py-2 text-body">{r.description}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </DialogBody>
        <DialogFooter>
          <Button onClick={onClose} autoFocus>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
