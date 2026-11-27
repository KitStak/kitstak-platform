'use client';
/**
 * Price lines editor (docs/programs/SPEC.md 5.4 Step 3, 5.12): Work charges (per unit with Rates by
 * variant, per batch, per hour), Fixed (monthly fee) and Minimum, each with a switch, the amount, a
 * one line help and an optional "Name on statement". Setup fees are the OneTimeChargesEditor.
 * Controlled; errors come from `priceLinesProblems`.
 */
import { useState, type ReactNode } from 'react';
import { ChevronDown, ChevronRight, Pencil } from 'lucide-react';
import { PRORATE_SWITCH_HELP } from '@kitstak/programs-engine/month';
import { Checkbox, Input, Switch, cn } from '@/components/ui';
import type { UnitLabel } from '@/lib/program-types';
import { VariantDot } from '../kit/chips';
import type { FixedLineValue, PriceLineField, PriceLinesValue } from './price-model';

export interface PriceLinesVariant {
  readonly key: string;
  readonly name: string;
  readonly color: string | null;
  /** "$2.20 · rule" style hint when a rule prices it. */
  readonly hint?: string | null;
}

export interface PriceLinesEditorProps {
  readonly value: PriceLinesValue;
  readonly onChange: (value: PriceLinesValue) => void;
  readonly unit: UnitLabel;
  readonly variants?: readonly PriceLinesVariant[];
  readonly errors?: Partial<Record<PriceLineField, string>>;
  /** Chips like "From deal" next to lines that came from somewhere else. */
  readonly sourceChips?: Partial<Record<'perUnit' | 'monthlyFee' | 'minimum' | 'perOrder', ReactNode>>;
  readonly disabled?: boolean;
}

function MoneyInput({ value, onChange, label, suffix, error, disabled, prefix = '$', width = 'w-36', testId }: { readonly value: string; readonly onChange: (value: string) => void; readonly label: string; readonly suffix?: string; readonly error?: string; readonly disabled?: boolean; readonly prefix?: string; readonly width?: string; readonly testId?: string }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative">
        <span aria-hidden className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-sm text-fg-muted">
          {prefix}
        </span>
        <input
          type="text"
          inputMode="decimal"
          aria-label={label}
          aria-invalid={error ? true : undefined}
          value={value}
          disabled={disabled}
          onChange={(event) => onChange(event.target.value.replace(/^\$/, ''))}
          data-testid={testId}
          className={cn(
            'h-8 rounded-md border bg-panel pr-2.5 pl-6 text-right text-sm font-medium text-fg tabular-nums outline-none focus:border-primary focus:shadow-[0_0_0_3px_var(--focus-ring-soft)] disabled:bg-muted',
            error ? 'border-danger' : 'border-border-input hover:border-border-input-hover',
            width,
          )}
        />
      </span>
      {suffix ? <span className="text-sm text-fg-secondary">{suffix}</span> : null}
    </span>
  );
}

function StatementName({ value, onChange, fallback, disabled }: { readonly value: string | null; readonly onChange: (value: string | null) => void; readonly fallback: string; readonly disabled?: boolean }) {
  const [open, setOpen] = useState(Boolean(value));
  if (!open) {
    return (
      <button type="button" disabled={disabled} onClick={() => setOpen(true)} className="inline-flex w-fit items-center gap-1 text-xs font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
        <Pencil aria-hidden className="size-3" />
        Name on statement
      </button>
    );
  }
  return (
    <label className="flex items-center gap-2 text-xs text-fg-secondary">
      Name on statement
      <Input value={value ?? ''} onChange={(event) => onChange(event.target.value || null)} placeholder={fallback} maxLength={80} disabled={disabled} className="h-7 max-w-56 text-xs" />
    </label>
  );
}

function LineRow({ title, help, on, onToggle, chip, error, children, disabled, testId }: { readonly title: string; readonly help: ReactNode; readonly on: boolean; readonly onToggle: (on: boolean) => void; readonly chip?: ReactNode; readonly error?: string; readonly children: ReactNode; readonly disabled?: boolean; readonly testId: string }) {
  return (
    <div className={cn('flex flex-col gap-2 rounded-lg border px-3.5 py-3 transition-colors', on ? 'border-border-default bg-panel' : 'border-border-subtle bg-sunken/50')} data-testid={testId}>
      <div className="flex items-start gap-3">
        <Switch checked={on} onCheckedChange={onToggle} disabled={disabled} aria-label={title} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="flex items-center gap-2 text-sm font-semibold text-fg">
            {title}
            {chip}
          </span>
          <span className="text-xs text-fg-muted">{help}</span>
        </div>
      </div>
      {on ? <div className="flex flex-col gap-2 pl-12">{children}</div> : null}
      {on && error ? (
        <p className="pl-12 text-xs text-danger-text" role="alert">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/** Appendix B.1.4 copy for the prorate switch on Monthly fee and Monthly minimum, from the engine. */
export const PRORATE_HELP = `${PRORATE_SWITCH_HELP.off} ${PRORATE_SWITCH_HELP.on}`;

function FixedLine({ title, help, value, onChange, error, chip, disabled, testId, fallback }: { readonly title: string; readonly help: string; readonly value: FixedLineValue; readonly onChange: (value: FixedLineValue) => void; readonly error?: string; readonly chip?: ReactNode; readonly disabled?: boolean; readonly testId: string; readonly fallback: string }) {
  return (
    <LineRow title={title} help={help} on={value.on} onToggle={(on) => onChange({ ...value, on })} error={error} chip={chip} disabled={disabled} testId={testId}>
      <MoneyInput value={value.amount} onChange={(amount) => onChange({ ...value, amount })} label={`${title} amount`} suffix="a month" error={error} disabled={disabled} testId={`${testId}-amount`} />
      <label className="flex items-start gap-2 text-sm text-fg-secondary">
        <Switch checked={value.partialMonth} onCheckedChange={(partialMonth) => onChange({ ...value, partialMonth })} disabled={disabled} aria-label="Charge part of it in a partial month" aria-describedby={`${testId}-partial-help`} className="mt-0.5" data-testid={`${testId}-partial`} />
        <span className="flex min-w-0 flex-col gap-0.5">
          <span>Charge part of it in a partial month</span>
          <span id={`${testId}-partial-help`} className="text-xs text-fg-muted">
            {value.partialMonth ? PRORATE_SWITCH_HELP.on : PRORATE_SWITCH_HELP.off}
          </span>
        </span>
      </label>
      <label className="flex items-center gap-2 text-sm text-fg-secondary">
        <Switch checked={value.chargeWhilePaused} onCheckedChange={(chargeWhilePaused) => onChange({ ...value, chargeWhilePaused })} disabled={disabled} aria-label="Charge while paused" />
        Charge while paused
      </label>
      <StatementName value={value.label} onChange={(label) => onChange({ ...value, label })} fallback={fallback} disabled={disabled} />
    </LineRow>
  );
}

export function PriceLinesEditor({ value, onChange, unit, variants = [], errors = {}, sourceChips = {}, disabled }: PriceLinesEditorProps) {
  const [ratesOpen, setRatesOpen] = useState(Object.keys(value.variantRates).length > 0);
  const set = <K extends keyof PriceLinesValue>(key: K, next: PriceLinesValue[K]) => onChange({ ...value, [key]: next });
  const unitTitle = `Per ${unit.singular}`;
  return (
    <div className="flex flex-col gap-6" data-testid="price-lines-editor">
      <section className="flex flex-col gap-2" aria-label="Work charges">
        <h3 className="text-sm font-semibold text-fg">Work charges</h3>
        <LineRow title={unitTitle} help={`Charged for every ${unit.singular} logged as built.`} on={value.perUnit.on} onToggle={(on) => set('perUnit', { ...value.perUnit, on })} error={errors.perUnit} chip={sourceChips.perUnit} disabled={disabled} testId="line-per-unit">
          <MoneyInput value={value.perUnit.price} onChange={(price) => set('perUnit', { ...value.perUnit, price })} label={`Price per ${unit.singular}`} suffix={`per ${unit.singular}`} error={errors.perUnit} disabled={disabled} width="w-28" testId="line-per-unit-price" />
          {variants.length ? (
            <div className="rounded-md border border-border-subtle">
              <button type="button" onClick={() => setRatesOpen(!ratesOpen)} aria-expanded={ratesOpen} className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-xs font-semibold text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
                {ratesOpen ? <ChevronDown aria-hidden className="size-3.5" /> : <ChevronRight aria-hidden className="size-3.5" />}
                Rates by variant
                <span className="font-normal text-fg-muted">Blank uses the card rate</span>
              </button>
              {ratesOpen ? (
                <ul className="flex max-h-72 flex-col overflow-auto border-t border-border-subtle">
                  {variants.map((variant) => (
                    <li key={variant.key} className="flex items-center gap-2 border-b border-border-subtle px-2.5 py-1.5 last:border-b-0">
                      <VariantDot color={variant.color} />
                      <span className="min-w-0 flex-1 truncate text-sm text-fg">{variant.name}</span>
                      {variant.hint ? <span className="hidden text-xs text-fg-muted sm:inline">{variant.hint}</span> : null}
                      <MoneyInput
                        value={value.variantRates[variant.key] ?? ''}
                        onChange={(rate) => set('variantRates', { ...value.variantRates, [variant.key]: rate })}
                        label={`Rate for ${variant.name}`}
                        error={errors[`variant:${variant.key}`]}
                        disabled={disabled}
                        width="w-24"
                      />
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}
          <StatementName value={value.perUnit.label} onChange={(label) => set('perUnit', { ...value.perUnit, label })} fallback={`${unit.plural.charAt(0).toUpperCase()}${unit.plural.slice(1)}`} disabled={disabled} />
        </LineRow>
        <LineRow title="Per batch" help="Charged once each time a build is marked done." on={value.perOrder.on} onToggle={(on) => set('perOrder', { ...value.perOrder, on })} error={errors.perOrder} chip={sourceChips.perOrder} disabled={disabled} testId="line-per-batch">
          <MoneyInput value={value.perOrder.amount} onChange={(amount) => set('perOrder', { ...value.perOrder, amount })} label="Amount each time a build is marked done" suffix="each time a build is marked done" error={errors.perOrder} disabled={disabled} width="w-28" />
          <StatementName value={value.perOrder.label} onChange={(label) => set('perOrder', { ...value.perOrder, label })} fallback="Batch fee" disabled={disabled} />
        </LineRow>
        <LineRow title="Per hour" help="Charged for billable time logged on this program." on={value.perHour.on} onToggle={(on) => set('perHour', { ...value.perHour, on })} error={errors.perHour} disabled={disabled} testId="line-per-hour">
          <MoneyInput value={value.perHour.rate} onChange={(rate) => set('perHour', { ...value.perHour, rate })} label="Rate per hour" suffix="per hour" error={errors.perHour} disabled={disabled} width="w-28" />
          <label className="flex items-center gap-2 text-sm text-fg-secondary">
            <Checkbox checked={value.perHour.countAllTime} onCheckedChange={(checked) => set('perHour', { ...value.perHour, countAllTime: checked === true })} disabled={disabled} aria-label="Count all time" />
            Count all time, not only billable time
          </label>
          <StatementName value={value.perHour.label} onChange={(label) => set('perHour', { ...value.perHour, label })} fallback="Hours" disabled={disabled} />
        </LineRow>
      </section>

      <section className="flex flex-col gap-2" aria-label="Fixed">
        <h3 className="text-sm font-semibold text-fg">Fixed</h3>
        <FixedLine title="Monthly fee" help="A set amount every month the program runs." value={value.monthlyFee} onChange={(next) => set('monthlyFee', next)} error={errors.monthlyFee} chip={sourceChips.monthlyFee} disabled={disabled} testId="line-monthly-fee" fallback="Monthly fee" />
      </section>

      <section className="flex flex-col gap-2" aria-label="Minimum">
        <h3 className="text-sm font-semibold text-fg">Minimum</h3>
        <FixedLine
          title="Monthly minimum"
          help="If work charges are lower than this, a minimum top up brings the month up to it after the month ends."
          value={value.minimum}
          onChange={(next) => set('minimum', next)}
          error={errors.minimum}
          chip={sourceChips.minimum}
          disabled={disabled}
          testId="line-minimum"
          fallback="Minimum top up"
        />
      </section>
      {errors.lines ? (
        <p className="text-sm text-danger-text" role="alert">
          {errors.lines}
        </p>
      ) : null}
    </div>
  );
}
