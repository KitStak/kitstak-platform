'use client';

/**
 * Billing form header fields (name, client, warehouse, calc. start date, frequency) used by
 * the full-page Create Billing Form and the Edit Info dialog, plus the live Summary card.
 */
import * as React from 'react';
import { CalendarRange, Building2, Receipt } from 'lucide-react';
import { useFormContext, useWatch } from 'react-hook-form';
import { BILLING_FREQUENCIES } from '@/lib/enums';
import { periodEnd, type ContractInput, type Frequency } from '@/lib/grid-defs/organization/billing';
import { DatePicker } from '@/components/ui/date-picker';
import { FormField, FormGrid } from '@/components/ui/form';
import { ComboField, SelectField, TextInput } from '@/components/facility/form-controls';
import { useWarehouseOptions } from '@/components/facility/facility-shared';
import { FREQUENCY_LABELS, PickerLoadError, useActiveClients, useBillingDates } from './billing-shared';

type F = ContractInput;

const toDay = (d: Date | null): string =>
  d
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    : '';
const fromDay = (s: string | null | undefined): Date | null => {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const [y, m, d] = s.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
};
const addDays = (s: string, n: number) =>
  new Date(Date.parse(`${s}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export function ContractFields({ lockedScope }: { readonly lockedScope?: string | null }) {
  const clients = useActiveClients();
  const warehouses = useWarehouseOptions();
  return (
    <FormGrid>
      <TextInput<F>
        name="name"
        label="Billing form name"
        required
        maxLength={100}
        placeholder="e.g. Copperline - 3PL Services 2027"
      />
      <div className="flex flex-col">
        <ComboField<F>
          name="clientId"
          label="Client"
          required
          options={clients.options}
          disabled={Boolean(lockedScope)}
          info={lockedScope ?? 'Only active clients are listed'}
          placeholder={clients.placeholder}
          emptyText={clients.emptyText}
        />
        {clients.error ? (
          <PickerLoadError message={clients.error} onRetry={clients.retry} retrying={clients.retrying} />
        ) : null}
      </div>
      <ComboField<F>
        name="warehouseId"
        label="Warehouse"
        required
        options={warehouses.options}
        disabled={Boolean(lockedScope)}
        info={lockedScope ?? undefined}
      />
      <FormField<F>
        name="calcStartDate"
        label="Calc. start date"
        required
        disabled={Boolean(lockedScope)}
        info={
          lockedScope
            ? `${lockedScope}: the billing schedule is fixed`
            : 'The first billing period starts on this day'
        }
      >
        {(c) => (
          <DatePicker
            id={c.id}
            value={fromDay(c.value as string)}
            onChange={(d) => c.onChange(toDay(d))}
            onBlur={c.onBlur}
            invalid={c.invalid}
            disabled={c.disabled}
            aria-label="Calc. start date"
          />
        )}
      </FormField>
      <SelectField<F>
        name="frequency"
        label="Billing frequency"
        required
        disabled={Boolean(lockedScope)}
        info={lockedScope ? `${lockedScope}: the billing schedule is fixed` : undefined}
        options={BILLING_FREQUENCIES.map((f) => ({ value: f, label: FREQUENCY_LABELS[f] ?? f }))}
      />
    </FormGrid>
  );
}

/** Live Summary card (right rail): who, where, the first three periods. */
export function ContractSummary({
  feeCount,
  extra,
}: {
  readonly feeCount?: number;
  readonly extra?: React.ReactNode;
}) {
  const { control } = useFormContext<F>();
  const v = useWatch({ control }) as Partial<F>;
  const clients = useActiveClients();
  const warehouses = useWarehouseOptions();
  const pretty = useBillingDates().day;
  const client = clients.options.find((o) => o.value === v.clientId)?.label;
  const wh = warehouses.options.find((o) => o.value === v.warehouseId)?.label;
  const periods: { start: string; end: string }[] = [];
  if (v.calcStartDate && v.frequency) {
    let start = v.calcStartDate;
    for (let i = 0; i < 3; i += 1) {
      const end = periodEnd(start, v.frequency as Frequency);
      periods.push({ start, end: addDays(end, -1) });
      start = end;
    }
  }
  const row = (icon: React.ReactNode, label: string, value: React.ReactNode) => (
    <div className="flex items-start gap-2.5">
      <span className="mt-0.5 text-secondary">{icon}</span>
      <div className="min-w-0">
        <div className="text-2xs font-semibold text-faint">{label}</div>
        <div className="truncate text-sm text-foreground">
          {value || <span className="text-faint">Not set</span>}
        </div>
      </div>
    </div>
  );
  return (
    <aside
      className="flex flex-col gap-4 rounded-xl border border-border bg-surface p-5 shadow-xs"
      aria-label="Summary"
    >
      <h2 className="text-base font-semibold text-foreground">Summary</h2>
      {row(<Receipt className="h-4 w-4" />, 'Billing form', v.name)}
      {row(
        <Building2 className="h-4 w-4" />,
        'Client · warehouse',
        client || wh ? `${client ?? '—'} · ${wh ?? '—'}` : '',
      )}
      {row(
        <CalendarRange className="h-4 w-4" />,
        'Frequency',
        v.frequency ? (FREQUENCY_LABELS[v.frequency] ?? v.frequency) : '',
      )}
      <div>
        <div className="mb-1.5 text-2xs font-semibold text-faint">Billing periods</div>
        {periods.length ? (
          <ol className="flex flex-col gap-1">
            {periods.map((p, i) => (
              <li
                key={p.start}
                className="flex items-center justify-between rounded-md bg-surface-sunken/70 px-2.5 py-1.5 text-xs"
              >
                <span className="font-medium text-secondary">Period {i + 1}</span>
                <span className="tabular-nums text-foreground">
                  {pretty(p.start)} – {pretty(p.end)}
                </span>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-xs text-faint">Pick a start date and frequency to preview the periods.</p>
        )}
      </div>
      {typeof feeCount === 'number'
        ? row(
            <Receipt className="h-4 w-4" />,
            'Fees',
            feeCount === 0 ? 'No fees yet' : `${feeCount} fee${feeCount === 1 ? '' : 's'}`,
          )
        : null}
      {extra}
    </aside>
  );
}
