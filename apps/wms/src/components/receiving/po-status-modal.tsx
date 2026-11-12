'use client';

/**
 * "Change Purchase Order Status" (rail pencil). Logiwa parity: the four statuses as radio
 * pills with the current one marked and the ones the state machine forbids disabled (with
 * the reason). KitStaks adds a required reason, written to the change log.
 */
import * as React from 'react';
import { z } from 'zod';
import { StatusPill } from '@/components/ui/status-pill';
import { Button } from '@/components/ui/button';
import { Callout } from '@/components/ui/callout';
import { Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader } from '@/components/ui/dialog';
import { Form, useZodForm } from '@/components/ui/form';
import { Spinner } from '@/components/ui/spinner';
import { toast } from '@/components/ui/toast';
import { apiRequest } from '@/lib/api-client';
import { applyServerFieldErrors } from '@/lib/query-client';
import { cn } from '@/lib/utils';
import { AreaF } from './fields';
import { statusOptionReason } from './wizard/po-form-model';
import { errorMessage, type PoDetail } from './receiving-shared';

const schema = z.object({
  status: z.string().min(1, 'Choose the new status'),
  reason: z
    .string()
    .trim()
    .min(3, 'Enter a reason (at least 3 characters)')
    .max(250, 'Use at most 250 characters'),
});

const HINTS: Readonly<Record<string, string>> = {
  Started: 'Marks the order as being received.',
  Completed:
    'Closes the order. Actual receiving and completed dates are stamped. Re-open it later by changing the status to Started.',
  Cancelled: "Cancels the order. It can't be received or changed afterwards.",
  Pending: 'Returns the order to Pending.',
};

/** Completed -> Started re-opens the order (Logiwa parity): the completion stamps are cleared. */
const REOPEN_HINT =
  'Re-opens the order. Completed and Actual receiving dates are cleared, so it can be received again and its receipts can be cancelled.';
const hintFor = (current: string, target: string): string | undefined =>
  current === 'Completed' && target === 'Started' ? REOPEN_HINT : HINTS[target];

const MANUAL = ['Pending', 'Started', 'Completed', 'Cancelled'] as const;

/** The machine's own reason when the server sent one ("Cancel the received lines…"), else the generic copy. */
function reasonFor(po: PoDetail, s: string): string | null {
  const generic = statusOptionReason(po.status, s, po.allowedStatuses);
  if (!generic) return null;
  const current = s === po.status || (po.status === 'Receiving' && s === 'Started');
  return current ? generic : (po.statusReasons?.[s] ?? generic);
}

function StatusRadios({
  po,
  value,
  onChange,
}: {
  readonly po: PoDetail;
  readonly value: string;
  readonly onChange: (v: string) => void;
}) {
  const refs = React.useRef<(HTMLButtonElement | null)[]>([]);
  const enabled = MANUAL.filter((s) => !reasonFor(po, s));
  const move = (from: string, delta: number) => {
    if (enabled.length === 0) return;
    const i = enabled.indexOf(from as (typeof MANUAL)[number]);
    const next = enabled[(i + delta + enabled.length) % enabled.length]!;
    onChange(next);
    refs.current[MANUAL.indexOf(next)]?.focus();
  };
  return (
    <div role="radiogroup" aria-label="New status" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {MANUAL.map((s, i) => {
        const reason = reasonFor(po, s);
        const current = s === po.status || (po.status === 'Receiving' && s === 'Started');
        const checked = value === s;
        return (
          <button
            key={s}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-disabled={Boolean(reason) || undefined}
            disabled={Boolean(reason)}
            title={reason ?? hintFor(po.status, s)}
            tabIndex={checked || (!value && s === enabled[0]) ? 0 : -1}
            onClick={() => onChange(s)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowRight' || e.key === 'ArrowDown') {
                e.preventDefault();
                move(s, 1);
              }
              if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') {
                e.preventDefault();
                move(s, -1);
              }
            }}
            className={cn(
              'flex flex-col items-center gap-1 rounded-md border px-2 py-2.5 outline-none transition-colors focus-visible:ring-2 focus-visible:ring-primary/35',
              checked ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-surface-sunken',
              reason && 'cursor-not-allowed opacity-50 hover:bg-surface',
            )}
          >
            <StatusPill status={s} domain="purchaseOrder" size="sm" />
            <span className="text-2xs text-faint">
              {current ? 'Current' : reason ? 'Not available' : 'Available'}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export function PoStatusModal({
  po,
  open,
  onOpenChange,
  onChanged,
}: {
  readonly po: PoDetail;
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly onChanged: (po: PoDetail) => void;
}) {
  const form = useZodForm(schema, { status: po.allowedStatuses[0] ?? '', reason: '' });
  const [busy, setBusy] = React.useState(false);
  const status = form.watch('status');
  const options = po.allowedStatuses;

  const save = async (v: z.output<typeof schema>) => {
    setBusy(true);
    try {
      const { data } = await apiRequest<PoDetail>(`/api/purchase-orders/${po.id}/status`, {
        method: 'POST',
        body: { ...v, version: po.version },
      });
      toast.success('Success', `${po.code} is now ${data.status}.`);
      onChanged(data);
      onOpenChange(false);
    } catch (error) {
      applyServerFieldErrors(form, error);
      toast.error('Error', errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="Change Purchase Order Status"
          description={`${po.code} is ${po.status}. Statuses the order can't move to are disabled.`}
        />
        <Form form={form} onSubmit={save}>
          <DialogBody className="flex flex-col gap-4">
            {options.length === 0 ? (
              <Callout
                variant="info"
                title="No status change available"
              >{`A ${po.status.toLowerCase()} purchase order can't move to another status.`}</Callout>
            ) : (
              <>
                <StatusRadios
                  po={po}
                  value={status}
                  onChange={(v) => form.setValue('status', v, { shouldValidate: true, shouldDirty: true })}
                />
                {status && hintFor(po.status, status) ? (
                  <p className="-mt-1 text-xs text-secondary" aria-live="polite">
                    {hintFor(po.status, status)}
                  </p>
                ) : null}
                {MANUAL.filter(
                  (s) =>
                    s !== po.status &&
                    !(po.status === 'Receiving' && s === 'Started') &&
                    po.statusReasons?.[s],
                ).map((s) => (
                  <p key={s} className="-mt-2 text-2xs text-faint">
                    <span className="font-medium text-secondary">{s}:</span> {po.statusReasons?.[s]}
                  </p>
                ))}
                {form.formState.errors.status?.message ? (
                  <p role="alert" className="-mt-2 text-xs font-medium text-danger">
                    {form.formState.errors.status.message}
                  </p>
                ) : null}
                <AreaF
                  name="reason"
                  label="Reason"
                  required
                  maxLength={250}
                  rows={3}
                  placeholder="Why is the status changing?"
                />
              </>
            )}
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" type="button" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button variant="primary" type="submit" disabled={busy || options.length === 0} aria-busy={busy}>
              {busy ? <Spinner className="h-3.5 w-3.5" label="Saving" /> : null}
              Change status
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
