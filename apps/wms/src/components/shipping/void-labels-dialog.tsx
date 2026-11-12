'use client';

/**
 * Void labels confirm (Carrier Shipment Details). Multi-package shipments void together at the
 * carrier, so the dialog first asks the server for every package that will be cancelled
 * (`/api/shipments/void/preview`) and lists them all, marking the siblings "Voids with" so the
 * user sees the second label before confirming. The toast reports the real count
 * ("2 labels voided (1 shipment)").
 */
import * as React from 'react';
import { AlertDialog } from 'radix-ui';
import { XCircle } from 'lucide-react';
import { voidSummary } from '@/lib/grid-defs/shipping/shipments';
import { Button } from '@/components/ui/button';
import { overlayClass } from '@/components/ui/dialog';
import { Spinner } from '@/components/ui/spinner';
import { Skeleton } from '@/components/ui/skeleton';
import { toast } from '@/components/ui/toast';
import { errorMessage, postJson, type BulkOutcome } from './shipping-client';
import { CarrierMark, LabelStatusPill, shipDateTime } from './column-kit';

interface PreviewRow {
  readonly id: string;
  readonly orderCode: string;
  readonly trackingNumber: string;
  readonly carrier: string;
  readonly labelCreatedAt: string;
  readonly labelStatus: string;
  readonly packageSeq: number | null;
  readonly selected: boolean;
  readonly voidBlockedReason: string | null;
}
interface Preview {
  readonly rows: readonly PreviewRow[];
  readonly labelCount: number;
  readonly shipmentCount: number;
}
interface VoidOutcome extends BulkOutcome {
  readonly labelsVoided: number;
  readonly shipmentsVoided: number;
}

export interface VoidLabelsDialogProps {
  /** Selected label ids, or null when closed. */
  readonly ids: readonly string[] | null;
  readonly onClose: () => void;
  /** Called after a void request settles with at least one success. */
  readonly onVoided: () => void;
}

export function VoidLabelsDialog({ ids, onClose, onVoided }: VoidLabelsDialogProps) {
  const open = ids !== null;
  const [loaded, setLoaded] = React.useState<{
    readonly key: string;
    readonly preview: Preview | null;
    readonly error: string | null;
  } | null>(null);
  const [pending, setPending] = React.useState(false);
  const [attempt, setAttempt] = React.useState(0);
  const key = ids ? `${ids.join(',')}#${attempt}` : '';

  React.useEffect(() => {
    if (!key) return;
    let live = true;
    postJson<Preview>('/api/shipments/void/preview', { ids: key.split('#')[0]?.split(',') ?? [] })
      .then((p) => {
        if (live) setLoaded({ key, preview: p, error: null });
      })
      .catch((e: unknown) => {
        if (live)
          setLoaded({ key, preview: null, error: errorMessage(e, "Couldn't load the packages to void") });
      });
    return () => {
      live = false;
    };
  }, [key]);

  const current = loaded && loaded.key === key ? loaded : null;
  const preview = current?.preview ?? null;
  const loadError = current?.error ?? null;

  const close = (next: boolean) => {
    if (next || pending) return;
    onClose();
  };

  const confirm = async (event: React.SyntheticEvent) => {
    event.preventDefault();
    if (!ids || pending) return;
    setPending(true);
    try {
      const r = await postJson<VoidOutcome>('/api/shipments/void', { ids });
      const labels = new Map((preview?.rows ?? []).map((row) => [row.id, row.trackingNumber]));
      const ok = r.labelsVoided > 0 ? voidSummary(r.labelsVoided, r.shipmentsVoided) : null;
      if (r.failed.length === 0) toast.success('Success', ok ?? 'Nothing to void');
      else {
        const reasons = r.failed
          .slice(0, 3)
          .map((f) =>
            f.message.includes(labels.get(f.id) ?? '\u0000')
              ? f.message
              : `${labels.get(f.id) ?? 'Label'}: ${f.message}`,
          )
          .join(' · ');
        (ok ? toast.warning : toast.error)(
          ok ? `${ok} · ${r.failed.length} failed` : 'Nothing voided',
          reasons,
        );
      }
      if (r.succeeded.length > 0) onVoided();
      onClose();
    } catch (error) {
      toast.error('Void failed', errorMessage(error));
    } finally {
      setPending(false);
    }
  };

  const siblings = preview ? preview.rows.filter((r) => !r.selected).length : 0;
  const blocked = preview?.rows.filter((r) => r.selected && r.voidBlockedReason) ?? [];
  const title = preview && preview.labelCount > 1 ? `Void ${preview.labelCount} labels?` : 'Void this label?';

  return (
    <AlertDialog.Root open={open} onOpenChange={close}>
      <AlertDialog.Portal>
        <AlertDialog.Overlay className={overlayClass} />
        <AlertDialog.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100vh-48px)] w-[calc(100vw-32px)] max-w-[720px] -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-xl bg-surface shadow-lg outline-none">
          <div className="flex items-start gap-2.5 bg-danger px-5 py-3.5 text-white">
            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            <AlertDialog.Title className="text-base font-semibold leading-5">{title}</AlertDialog.Title>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 ks-scroll">
            <AlertDialog.Description className="text-sm leading-5 text-body">
              The carrier cancels {preview && preview.labelCount > 1 ? 'these labels' : 'the label'} and the{' '}
              {preview && preview.labelCount > 1 ? 'packages leave' : 'package leaves'} today&apos;s end of
              the day manifest. This can&apos;t be undone.
              {siblings > 0 ? (
                <span className="mt-1.5 block rounded-md bg-warning-soft px-2.5 py-1.5 text-xs text-body">
                  <strong className="font-semibold">
                    {siblings} more {siblings === 1 ? 'package is' : 'packages are'} on the same multi-package
                    shipment
                  </strong>{' '}
                  and will be voided with your selection.
                </span>
              ) : null}
            </AlertDialog.Description>
            <div className="mt-3 max-h-[300px] overflow-auto rounded-md border border-border ks-scroll">
              <table className="w-full border-collapse text-left text-xs">
                <thead className="sticky top-0 bg-surface-sunken">
                  <tr>
                    {['Order', 'Package', 'Tracking number', 'Carrier', 'Label created', 'Status'].map(
                      (h) => (
                        <th
                          key={h}
                          scope="col"
                          className="whitespace-nowrap border-b border-border px-2.5 py-1.5 text-2xs font-semibold text-faint"
                        >
                          {h}
                        </th>
                      ),
                    )}
                  </tr>
                </thead>
                <tbody>
                  {preview ? (
                    preview.rows.map((r) => (
                      <tr
                        key={r.id}
                        className={
                          r.selected
                            ? 'border-b border-border last:border-b-0'
                            : 'border-b border-border bg-warning-soft/40 last:border-b-0'
                        }
                      >
                        <td className="whitespace-nowrap px-2.5 py-1.5 font-medium text-foreground">
                          {r.orderCode}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 text-body">
                          {r.packageSeq ? `#${r.packageSeq}` : '—'}
                          {r.selected ? null : (
                            <span className="ml-1.5 rounded-full bg-warning-soft px-1.5 py-0.5 text-2xs font-medium text-warning">
                              also voided
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 font-mono text-2xs text-body">
                          {r.trackingNumber}
                        </td>
                        <td className="max-w-[150px] px-2.5 py-1.5 text-body">
                          <CarrierMark code={r.carrier} />
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1.5 tabular-nums text-body">
                          {shipDateTime(r.labelCreatedAt)}
                        </td>
                        <td className="whitespace-nowrap px-2.5 py-1.5">
                          <LabelStatusPill status={r.labelStatus} />
                        </td>
                      </tr>
                    ))
                  ) : loadError ? (
                    <tr>
                      <td colSpan={6} className="px-2.5 py-3 text-center text-xs text-secondary">
                        The packages could not be loaded.{' '}
                        <button
                          type="button"
                          className="font-medium text-primary underline-offset-2 hover:underline"
                          onClick={() => setAttempt((n) => n + 1)}
                        >
                          Try again
                        </button>
                      </td>
                    </tr>
                  ) : (
                    [0, 1].map((i) => (
                      <tr key={i}>
                        <td colSpan={6} className="px-2.5 py-2">
                          <Skeleton className="h-4 w-full" />
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            {preview && preview.shipmentCount !== preview.labelCount ? (
              <p className="mt-2 text-xs text-secondary">
                {preview.labelCount} labels across {preview.shipmentCount}{' '}
                {preview.shipmentCount === 1 ? 'shipment' : 'shipments'}.
              </p>
            ) : null}
            {blocked.length > 0 ? (
              <p role="status" className="mt-2 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
                {blocked.length === 1
                  ? `${blocked[0]?.trackingNumber}: ${blocked[0]?.voidBlockedReason}.`
                  : `${blocked.length} selected labels can't be voided and will be skipped.`}
              </p>
            ) : null}
            {loadError ? (
              <p role="alert" className="mt-3 rounded-md bg-danger-soft px-2.5 py-1.5 text-xs text-danger">
                {loadError}
              </p>
            ) : null}
          </div>
          <div className="flex shrink-0 justify-end gap-2 border-t border-border bg-surface-sunken px-5 py-3">
            <AlertDialog.Cancel asChild>
              <Button variant="secondary" disabled={pending}>
                No
              </Button>
            </AlertDialog.Cancel>
            <AlertDialog.Action asChild>
              <Button
                variant="danger"
                onClick={confirm}
                disabled={pending || !preview || preview.labelCount === 0}
                aria-busy={pending}
              >
                {pending ? <Spinner className="h-3.5 w-3.5" label="Voiding" /> : null}
                {preview && preview.labelCount > 1 ? `Yes, void ${preview.labelCount}` : 'Yes, void'}
              </Button>
            </AlertDialog.Action>
          </div>
        </AlertDialog.Content>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  );
}
