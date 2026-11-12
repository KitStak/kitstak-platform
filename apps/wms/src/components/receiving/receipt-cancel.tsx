'use client';

/** Cancel one receipt (shared confirm + optimistic grid patch). Used by Receiving History and the PO detail page. */
import * as React from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Ban } from 'lucide-react';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { toast } from '@/components/ui/toast';
import { apiRequest } from '@/lib/api-client';
import { formatZoned } from '@/lib/grid-defs/receiving/zoned-time';
import type { ReceiptRow } from './receipt-columns';
import { errorMessage, Nowrap, useInvalidateReceiving } from './receiving-shared';

export const CANCEL_RECEIPT_TITLE = 'Are you sure you want to cancel the receiving?';

/** Patches every cached grid page that holds the receipt so it reads as cancelled immediately. */
export function markReceiptCancelled(qc: ReturnType<typeof useQueryClient>, id: string, at: string): void {
  qc.setQueriesData<{ data?: unknown }>({ queryKey: ['grid'] }, (old) => {
    if (!old || !Array.isArray(old.data)) return old;
    let hit = false;
    const data = (old.data as ReceiptRow[]).map((r) => {
      if (r?.id !== id || r.cancelledAt) return r;
      hit = true;
      return { ...r, cancelledAt: at, cancelBlockedReason: 'This receipt is already cancelled.' };
    });
    return hit ? { ...old, data } : old;
  });
}

/** Cancels one receipt with the shared confirm; used by the history grid and the PO detail page. */
export function useCancelReceipt(onDone?: () => void) {
  const invalidate = useInvalidateReceiving();
  const qc = useQueryClient();
  const [target, setTarget] = React.useState<ReceiptRow | null>(null);
  const run = async (row: ReceiptRow) => {
    try {
      await apiRequest(`/api/receipts/${row.id}/cancel`, { method: 'POST', body: {} });
      // Show the Cancelled chip at once (the background refetch below confirms it).
      markReceiptCancelled(qc, row.id, new Date().toISOString());
      toast.success(
        'Success',
        `Receipt ${row.masterId} cancelled. ${row.quantity.toLocaleString()} ${row.packType} of ${row.sku} were reversed from ${row.locationCode}.`,
      );
      onDone?.();
    } catch (error) {
      toast.error('Error', errorMessage(error));
    } finally {
      // Background refetch: the confirm closes as soon as the cancel resolves.
      void invalidate();
    }
  };
  const dialog = (
    <ConfirmDialog
      open={target !== null}
      onOpenChange={(open) => !open && setTarget(null)}
      variant="danger"
      icon={Ban}
      title={CANCEL_RECEIPT_TITLE}
      description="This action cannot be undone."
      records={
        target
          ? {
              columns: [
                { key: 'id', label: 'Master ID' },
                { key: 'po', label: 'PO number' },
                { key: 'sku', label: 'SKU' },
                { key: 'qty', label: 'Quantity' },
                { key: 'loc', label: 'Location' },
                { key: 'at', label: 'Received' },
              ],
              rows: [
                {
                  id: <Nowrap mono>{target.masterId}</Nowrap>,
                  po: <Nowrap mono>{target.poCode ?? '—'}</Nowrap>,
                  sku: <Nowrap mono>{target.sku}</Nowrap>,
                  qty: <Nowrap>{`${target.quantity.toLocaleString()} ${target.packType}`}</Nowrap>,
                  loc: <Nowrap>{target.locationCode}</Nowrap>,
                  at: <Nowrap>{formatZoned(target.receivedAt, target.timeZone)}</Nowrap>,
                },
              ],
            }
          : undefined
      }
      confirmLabel="Yes"
      cancelLabel="No"
      onConfirm={() => (target ? run(target) : undefined)}
    />
  );
  return { ask: setTarget, dialog };
}
