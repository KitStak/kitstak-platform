'use client';
/**
 * The wizard's live preview rail (docs/programs/SPEC.md 5.4): the program chip, the "Projected
 * month" card (engine `projectMonth` for the next full month, a stacked bar of Work charges,
 * Monthly fee and Minimum top up), the first variants with their rates, and the checklist.
 */
import { Check, Circle } from 'lucide-react';
import { formatCents, formatUnitPrice, unitLabel } from '@kitstak/programs-engine';
import { cn } from '@/components/ui';
import { ProgramIcon, VariantDot } from '@/features/programs/kit';
import { checklist, unitOf, variantRates, wizardProjection, wizardVariants, type StepId, type WizardEnv, type WizardState } from './wizard-model';

const SEGMENTS = [
  { key: 'work', label: 'Work charges', color: 'var(--chart-1)' },
  { key: 'fee', label: 'Monthly fee', color: 'var(--chart-3)' },
  { key: 'topUp', label: 'Minimum top up', color: 'var(--chart-5, var(--warning))' },
] as const;

export function ProjectedMonth({ state, env, compact }: { readonly state: WizardState; readonly env: WizardEnv; readonly compact?: boolean }) {
  const projection = wizardProjection(state, env);
  const unit = unitOf(state.basics);
  const parts = { work: BigInt(projection.workCents), fee: BigInt(projection.feeCents), topUp: BigInt(projection.topUpCents) };
  const total = parts.work + parts.fee + parts.topUp;
  const showMoney = projection.hasPrices && projection.totalCents !== null;
  return (
    <section className="flex flex-col gap-2.5 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" aria-label="Projected month" data-testid="projected-month">
      <p className="text-xs font-medium text-fg-muted">Projected {projection.monthName}</p>
      {!projection.hasSchedule && !showMoney ? (
        <p className="text-sm text-fg-secondary">Add a schedule to see a projection.</p>
      ) : showMoney ? (
        <>
          <p className={cn('font-display leading-none text-fg tabular-nums', compact ? 'text-[28px]' : 'text-[32px]')} data-testid="projected-total">{formatCents(projection.totalCents, { cents: true })}</p>
          {total > BigInt(0) ? (
            <>
              <div className="flex h-2 w-full overflow-hidden rounded-full bg-sunken" role="img" aria-label={SEGMENTS.filter((segment) => parts[segment.key] > BigInt(0)).map((segment) => `${segment.label} ${formatCents(parts[segment.key], { cents: true })}`).join(', ')}>
                {SEGMENTS.map((segment) => (parts[segment.key] > BigInt(0) ? <span key={segment.key} style={{ width: `${Number((parts[segment.key] * BigInt(1000)) / total) / 10}%`, background: segment.color }} /> : null))}
              </div>
              <ul className="flex flex-col gap-1 text-xs">
                {SEGMENTS.filter((segment) => parts[segment.key] > BigInt(0)).map((segment) => (
                  <li key={segment.key} className="flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5 text-fg-secondary"><span aria-hidden className="size-2 rounded-full" style={{ background: segment.color }} />{segment.label}</span>
                    <span className="font-medium text-fg tabular-nums">{formatCents(parts[segment.key], { cents: true })}</span>
                  </li>
                ))}
              </ul>
            </>
          ) : null}
          <p className="text-xs text-fg-muted">{projection.hasSchedule ? projection.basisText : 'Add a schedule to see a projection. This counts fixed lines only.'}</p>
          {projection.hasSchedule ? <p className="text-xs text-fg-secondary">{unitLabel(projection.units, unit)} planned</p> : null}
        </>
      ) : (
        <>
          <p className={cn('font-display leading-none text-fg tabular-nums', compact ? 'text-[28px]' : 'text-[32px]')}>{unitLabel(projection.units, unit)}</p>
          <p className="text-xs text-fg-muted">Add prices to see revenue. {projection.basisText}.</p>
        </>
      )}
      {projection.hoursNotProjected ? <p className="text-xs text-fg-muted">Hourly work is not in this estimate.</p> : null}
    </section>
  );
}

export function PreviewRail({ state, env, onGo }: { readonly state: WizardState; readonly env: WizardEnv; readonly onGo: (step: StepId) => void }) {
  const b = state.basics;
  const variants = wizardVariants(state);
  const rates = variantRates(state);
  const items = checklist(state);
  return (
    <aside className="flex flex-col gap-3" aria-label="Preview" data-testid="preview-rail">
      <div className="flex items-center gap-3 rounded-xl border border-border-subtle bg-panel p-3 shadow-xs">
        <ProgramIcon icon={b.icon} color={b.color} size={36} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold text-fg" title={b.name}>{b.name || 'New program'}</p>
          <p className="truncate text-xs text-fg-muted">
            {b.key ? <span className="font-key">{b.key}</span> : 'No key yet'}
            {' · '}
            {b.customer?.name ?? 'No customer'}
          </p>
        </div>
      </div>

      <ProjectedMonth state={state} env={env} />

      <section className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" aria-label="Variants">
        <p className="text-xs font-medium text-fg-muted">Variants</p>
        {variants.length === 0 ? (
          <p className="text-sm text-fg-secondary">No variants yet</p>
        ) : (
          <ul className="flex flex-col gap-1.5 text-sm">
            {variants.slice(0, 6).map((variant) => {
              const rate = rates.get(variant.key);
              return (
                <li key={variant.key} className="flex items-center gap-2">
                  <VariantDot color={variant.color} />
                  <span className="min-w-0 flex-1 truncate text-fg" title={variant.name}>{variant.name}</span>
                  <span className="shrink-0 text-xs text-fg-secondary tabular-nums">{state.price.later || !rate?.price ? 'No rate' : formatUnitPrice(rate.price)}</span>
                </li>
              );
            })}
            {variants.length > 6 ? <li className="text-xs text-fg-muted">+{variants.length - 6} more</li> : null}
          </ul>
        )}
      </section>

      <section className="flex flex-col gap-1 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" aria-label="Checklist">
        <p className="mb-1 text-xs font-medium text-fg-muted">Checklist</p>
        {items.map((item) => (
          <button key={item.label} type="button" onClick={() => onGo(item.id)} className="flex items-center gap-2 rounded-sm py-0.5 text-left text-sm outline-none hover:text-fg focus-visible:outline-2 focus-visible:outline-focus">
            {item.done ? <span className="flex size-4 items-center justify-center rounded-full bg-success-subtle text-success-text"><Check aria-hidden className="size-3" /></span> : <Circle aria-hidden className="size-4 text-border-default" />}
            <span className={cn('flex-1', item.done ? 'text-fg' : 'text-fg-secondary')}>{item.label}</span>
            {item.note && (item.label === 'Variants' ? item.done : !item.done || item.note === 'Later') ? <span className="text-xs text-fg-muted">{item.note}</span> : null}
          </button>
        ))}
      </section>
    </aside>
  );
}
