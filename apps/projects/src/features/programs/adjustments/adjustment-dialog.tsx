'use client';
/**
 * Add an adjustment (docs/programs/SPEC.md 5.20): a dated charge or credit outside the price card.
 * Date (open days only), Label, Amount with a Charge or Credit toggle, Reason (required), Variant
 * (optional) and "Counts toward minimum" (off by default). It shows on the statement under
 * Adjustments and changes the minimum only when the switch is on.
 */
import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Scale } from 'lucide-react';
import { addDays, formatCents, shortDate } from '@kitstak/programs-engine';
import { Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, IsoDatePicker, Select, Switch, Textarea, ToggleGroup } from '@/components/ui';
import { useServerAction } from '@/lib/hooks/use-action';
import { qk } from '@/lib/query-keys';
import type { IsoDate } from '@/lib/program-types';
import { addOneTimeChargeAction } from '@/server/actions/price-cards';
import { readMoney } from '../editors/price-model';
import { useCurrentProgram } from '../program-context';

export const COUNTS_TOWARD_MINIMUM_HELP = 'Turn on when this credit or charge is for work, so the minimum is checked against it.';

export interface AdjustmentDialogProps {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly defaultDate: IsoDate;
  readonly onAdded?: () => void;
}

export function AdjustmentDialog({ open, onOpenChange, defaultDate, onAdded }: AdjustmentDialogProps) {
  const { key, program, activeVariants } = useCurrentProgram();
  const queryClient = useQueryClient();
  const lockedThrough = program.locks.lockedThrough;
  const firstOpen = lockedThrough ? addDays(lockedThrough, 1) : null;
  const [date, setDate] = useState<IsoDate>(firstOpen && defaultDate < firstOpen ? firstOpen : defaultDate);
  const [label, setLabel] = useState('');
  const [amount, setAmount] = useState('');
  const [direction, setDirection] = useState<'charge' | 'credit'>('credit');
  const [reason, setReason] = useState('');
  const [variantId, setVariantId] = useState<string>('none');
  const [towardMinimum, setTowardMinimum] = useState(false);
  const [tried, setTried] = useState(false);
  const add = useServerAction(addOneTimeChargeAction, {
    errorTitle: "Couldn't add the adjustment",
    successMessage: (charge) => `${direction === 'credit' ? 'Credit' : 'Charge'} of ${formatCents((charge.amountCents ?? '0').replace('-', ''), { cents: true })} added for ${shortDate(charge.chargeOn)}.`,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: qk.program(key) });
      onAdded?.();
      onOpenChange(false);
    },
  });
  const money = readMoney(amount);
  const errors = {
    date: firstOpen && date < firstOpen ? `That month is closed. Pick ${shortDate(firstOpen)} or later.` : null,
    label: label.trim() ? null : 'Name the adjustment.',
    amount: money.ok ? null : money.message,
    reason: reason.trim() ? null : 'Say why. It shows on the statement.',
  };
  const valid = Object.values(errors).every((value) => value === null);
  const submit = () => {
    setTried(true);
    if (!valid || !money.ok) return;
    const cents = direction === 'credit' ? `-${money.cents}` : money.cents;
    void add.run({ key, kind: 'adjustment', chargeOn: date, amountCents: cents, label: label.trim(), reason: reason.trim(), variantId: variantId === 'none' ? null : variantId, countsTowardMinimum: towardMinimum });
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md" data-testid="adjustment-dialog">
        <DialogHeader
          icon={
            <span className="flex size-9 items-center justify-center rounded-lg bg-sunken text-icon">
              <Scale aria-hidden className="size-4" />
            </span>
          }
          title="Add an adjustment"
          description={`A one time charge or credit on ${key}. It is not part of the price card.`}
        />
        <DialogBody className="flex flex-col gap-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Date" required error={tried ? errors.date : null} hint={firstOpen ? `Open days start ${shortDate(firstOpen)}.` : undefined}>
              {({ inputId }) => <IsoDatePicker id={inputId} value={date} onChange={(value) => value && setDate(value)} aria-label="Adjustment date" />}
            </Field>
            <Field label="Charge or credit" required>
              {() => (
                <ToggleGroup
                  label="Charge or credit"
                  value={direction}
                  onValueChange={setDirection}
                  options={[
                    { value: 'credit', label: 'Credit' },
                    { value: 'charge', label: 'Charge' },
                  ]}
                />
              )}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
            <Field label="Label" required error={tried ? errors.label : null}>
              {({ inputId, invalid }) => <Input id={inputId} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={120} invalid={invalid} placeholder="Damaged liners credit" />}
            </Field>
            <Field label="Amount" required error={tried ? errors.amount : null}>
              {({ inputId, invalid }) => <Input id={inputId} value={amount} onChange={(event) => setAmount(event.target.value)} inputMode="decimal" invalid={invalid} leadingIcon={<span className="text-sm text-fg-muted">$</span>} placeholder="0.00" />}
            </Field>
          </div>
          <Field label="Reason" required error={tried ? errors.reason : null}>
            {({ inputId, invalid }) => <Textarea id={inputId} value={reason} onChange={(event) => setReason(event.target.value)} rows={2} maxLength={2000} invalid={invalid} placeholder="120 kits had torn liners and were rebuilt for free." />}
          </Field>
          <Field label="Variant" hint="Optional. Ties the adjustment to one kit on the statement.">
            {({ inputId }) => (
              <Select
                id={inputId}
                value={variantId}
                onValueChange={setVariantId}
                options={[{ value: 'none', label: 'No variant' }, ...activeVariants.map((variant) => ({ value: variant.id, label: variant.name }))]}
              />
            )}
          </Field>
          <Switch checked={towardMinimum} onCheckedChange={setTowardMinimum} label="Counts toward minimum" description={COUNTS_TOWARD_MINIMUM_HELP} />
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} loading={add.pending} data-testid="adjustment-save">
            Add {direction === 'credit' ? 'credit' : 'charge'}
            {money.ok ? ` of ${formatCents(money.cents, { cents: true })}` : ''}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
