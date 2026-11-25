'use client';
/**
 * Setup fees (and other dated one time charges) editor (docs/programs/SPEC.md 5.4 Step 3, 5.20):
 * rows of name, amount and "Charge on" date, "+ Add another setup fee". New price versions never
 * charge them again. Controlled; problems come from `oneTimeProblems`.
 */
import { Plus, Trash2 } from 'lucide-react';
import { Button, IconButton, Input, IsoDatePicker, cn } from '@/components/ui';
import type { IsoDate } from '@/lib/program-types';
import { localId } from './variant-model';
import { oneTimeProblems, type OneTimeRow } from './price-model';

export interface OneTimeChargesEditorProps {
  readonly rows: readonly OneTimeRow[];
  readonly onChange: (rows: OneTimeRow[]) => void;
  /** New rows default to this day (the program start date). */
  readonly defaultDate: IsoDate;
  /** Rows cannot be charged before this day. */
  readonly notBefore?: IsoDate | null;
  readonly addLabel?: string;
  readonly disabled?: boolean;
  /** Show problems (after Continue was pressed). */
  readonly showErrors?: boolean;
}

export function OneTimeChargesEditor({ rows, onChange, defaultDate, notBefore, addLabel, disabled, showErrors }: OneTimeChargesEditorProps) {
  const problems = showErrors ? oneTimeProblems(rows, { notBefore }) : {};
  const update = (id: string, patch: Partial<OneTimeRow>) => onChange(rows.map((row) => (row.id === id ? { ...row, ...patch } : row)));
  const add = () => onChange([...rows, { id: localId('r'), label: 'Setup fee', amount: '', chargeOn: defaultDate }]);
  return (
    <section className="flex flex-col gap-2" aria-label="Setup fees" data-testid="one-time-editor">
      <div className="flex flex-col gap-0.5">
        <h3 className="text-sm font-semibold text-fg">Setup fee</h3>
        <p className="text-xs text-fg-muted">Setup fees are charged once on their date. New price versions never charge them again.</p>
      </div>
      {rows.length ? (
        <ul className="flex flex-col gap-2">
          {rows.map((row) => {
            const problem = problems[row.id];
            return (
              <li key={row.id} className={cn('grid gap-2 rounded-lg border bg-panel p-2.5 sm:grid-cols-[1fr_140px_180px_auto] sm:items-center', problem ? 'border-danger' : 'border-border-default')} data-testid="one-time-row">
                <Input aria-label="Name on statement" value={row.label} onChange={(event) => update(row.id, { label: event.target.value })} maxLength={80} disabled={disabled} />
                <span className="relative">
                  <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-fg-muted">
                    $
                  </span>
                  <Input aria-label="Amount" inputMode="decimal" value={row.amount} onChange={(event) => update(row.id, { amount: event.target.value.replace(/^\$/, '') })} disabled={disabled} className="pl-6 text-right tabular-nums" />
                </span>
                <IsoDatePicker aria-label="Charge on" value={row.chargeOn} onChange={(chargeOn) => update(row.id, { chargeOn: chargeOn ?? defaultDate })} disabled={disabled} />
                <IconButton label={`Remove ${row.label || 'this charge'}`} icon={<Trash2 aria-hidden />} size="sm" disabled={disabled} onClick={() => onChange(rows.filter((entry) => entry.id !== row.id))} />
                {problem ? (
                  <p className="text-xs text-danger-text sm:col-span-4" role="alert">
                    {problem}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      ) : null}
      <Button variant="ghost" size="sm" leadingIcon={<Plus aria-hidden />} onClick={add} disabled={disabled} className="w-fit" data-testid="one-time-add">
        {addLabel ?? (rows.length ? 'Add another setup fee' : 'Add a setup fee')}
      </Button>
    </section>
  );
}
