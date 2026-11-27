'use client';
/**
 * By variant (spec 7.3, tab 2): planned, built, scrap, revenue, labor, material, other cost,
 * profit, margin, profit per kit and share of revenue for each variant, then "Program fees" and
 * "Not tied to a variant", then the Total, which equals the Overview. Phones get one card per
 * variant with kits, profit per kit and margin.
 */
import { DashSection, DashboardFrame, EmptyNote } from '@kitstak/ui/dashboard';
import { Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow } from '@/components/ui/table';
import { Tooltip } from '@/components/ui/tooltip';
import { cn } from '@/components/ui/cn';
import { formatMoney, formatPercentBp } from '@/lib/format';
import { ratioBp } from '@/lib/money';
import type { ProgramFiguresDTO, ProgramVariantRowDTO, ProgramVariantsDTO } from '@/lib/program-types';
import { useSearchParams } from 'next/navigation';
import { LoadError } from '@/features/profit/profit-ui';
import { feeKindLabel } from './program-report';
import { capitalize, monthLabel, sumMoney, sumQuantities } from './program-format';
import { Margin, Money, PlanMeter, SectionSkeleton, units } from './program-ui';
import { useProgramVariants } from './use-programs';

/** The color word a variant carries in Projects, as a small swatch. */
const SWATCH: Readonly<Record<string, string>> = {
  brown: '#8a5a3b',
  yellow: '#e0b224',
  black: '#1f2328',
  white: '#f4f4f2',
  red: '#c4453c',
  blue: '#3a6fd8',
  green: '#3d8b5a',
  gray: '#8a8f99',
  grey: '#8a8f99',
  orange: '#e07a2e',
};

const otherCost = (row: { otherCents: number | null; sharedCents: number | null }) => sumMoney([row.otherCents, row.sharedCents]);

function VariantName({ row }: { readonly row: ProgramVariantRowDTO }) {
  const swatch = row.color ? SWATCH[row.color.toLowerCase()] : undefined;
  return (
    <div className="flex min-w-0 items-center gap-2">
      {swatch ? <span aria-hidden className="size-2.5 shrink-0 rounded-full ring-1 ring-[color:var(--border-default)]" style={{ background: swatch }} /> : <span aria-hidden className="size-2.5 shrink-0" />}
      <div className="min-w-0">
        <span className="block truncate font-medium text-fg">
          {row.name}
          {row.retired ? <span className="ml-1.5 text-xs font-normal text-fg-muted">Retired</span> : null}
        </span>
        {row.sku ? <span className="block truncate text-xs text-fg-muted">{row.sku}</span> : null}
      </div>
    </div>
  );
}

export function ProgramVariants({ programKey, month, initial }: { readonly programKey: string; readonly month: string; readonly currentMonth: string; readonly initial?: ProgramVariantsDTO }) {
  const query = useProgramVariants(programKey, month, { initialData: initial && initial.month.month === month ? initial : undefined });
  const focus = useSearchParams()?.get('variant') ?? null;
  const data = query.data;
  if (query.isError && !data) return <LoadError what="the variants" message={query.error instanceof Error ? query.error.message : undefined} onRetry={() => void query.refetch()} />;
  if (!data) return <div className="rounded-xl border border-border-subtle bg-panel"><SectionSkeleton label="Loading the variants" rows={9} /></div>;
  const money = !data.moneyHidden;
  const unit = data.header.unit;
  const total = data.total;
  const fees = data.fees;
  const notTied = data.notTiedToVariant;
  const showNotTied = Number(notTied.units) !== 0 || Number(notTied.hours) !== 0 || (notTied.costCents ?? 0) !== 0 || (notTied.revenueCents ?? 0) !== 0;
  const plannedTotal = sumQuantities(data.variants.map((row) => row.plannedUnits));
  const per = capitalize(unit.singular);
  const maxShare = Math.max(0, ...data.variants.map((row) => row.revenueShareBp ?? 0));

  return (
    <DashboardFrame app="pulse" data-testid="program-variants">
      <DashSection title="By variant" description={`${monthLabel(data.month.month)}. Hours with no variant are split by the ${unit.plural} each variant built that day.`} flush className={cn('transition-opacity', query.isFetching && query.isPlaceholderData && 'opacity-60')}>
        {data.variants.length === 0 && !showNotTied && (fees.totalCents ?? 0) === 0 ? (
          <EmptyNote action={null}>No variant built or planned this month. Builds planned in Projects show up here.</EmptyNote>
        ) : (
          <>
            {/* Phones: one card per variant */}
            <ul className="divide-y divide-border-subtle md:hidden" aria-label="Variants" data-testid="variant-cards">
              {data.variants.map((row) => (
                <li key={row.variantId ?? row.name} className="flex flex-col gap-2 px-4 py-3" data-testid="variant-card">
                  <div className="flex items-start justify-between gap-3">
                    <VariantName row={row} />
                    {money ? <Margin marginBp={row.marginBp} targetBp={null} className="shrink-0 text-sm" /> : null}
                  </div>
                  <dl className="grid grid-cols-3 gap-3 text-sm tabular-nums">
                    <div>
                      <dt className="text-xs text-fg-muted">{capitalize(unit.plural)}</dt>
                      <dd className="font-medium text-fg">{units(row.units)}</dd>
                      {row.plannedUnits !== null ? <dd className="text-xs text-fg-muted">of {units(row.plannedUnits)}</dd> : null}
                    </div>
                    {money ? (
                      <>
                        <div>
                          <dt className="text-xs text-fg-muted">Profit per {unit.singular}</dt>
                          <dd className="font-medium"><Money cents={row.profitPerUnitCents} /></dd>
                        </div>
                        <div>
                          <dt className="text-xs text-fg-muted">Revenue</dt>
                          <dd className="font-medium"><Money cents={row.revenueCents} whole /></dd>
                        </div>
                      </>
                    ) : (
                      <div>
                        <dt className="text-xs text-fg-muted">Scrap</dt>
                        <dd className="font-medium">{units(row.scrap)}</dd>
                      </div>
                    )}
                  </dl>
                </li>
              ))}
              <li className="flex flex-col gap-1 bg-sunken px-4 py-3 text-sm" data-testid="variant-card-total">
                <div className="flex items-center justify-between font-semibold text-fg">
                  <span>Total</span>
                  {money ? <Money cents={total.revenueCents} /> : <span>{units(total.units)} {unit.plural}</span>}
                </div>
                {money ? (
                  <p className="text-xs text-fg-secondary">
                    {units(total.units)} {unit.plural}, profit {formatMoney(total.profitCents)}, margin {formatPercentBp(total.marginBp)}
                    {(fees.totalCents ?? 0) !== 0 ? `, with ${formatMoney(fees.totalCents)} program fees` : ''}
                  </p>
                ) : null}
              </li>
            </ul>

            <div className="hidden md:block">
              <Table aria-label="By variant" className="min-w-[1120px]">
                <TableHead>
                  <tr>
                    <TableHeaderCell className="pl-4">Variant</TableHeaderCell>
                    <TableHeaderCell numeric>Planned</TableHeaderCell>
                    <TableHeaderCell numeric>Built</TableHeaderCell>
                    <TableHeaderCell numeric>Scrap</TableHeaderCell>
                    {money ? (
                      <>
                        <TableHeaderCell numeric>Revenue</TableHeaderCell>
                        <TableHeaderCell numeric>Labor</TableHeaderCell>
                        <TableHeaderCell numeric>Material</TableHeaderCell>
                        <TableHeaderCell numeric title="Other costs and shared costs">Other cost</TableHeaderCell>
                        <TableHeaderCell numeric>Profit</TableHeaderCell>
                        <TableHeaderCell numeric>Margin</TableHeaderCell>
                        <TableHeaderCell numeric>Profit per {unit.singular}</TableHeaderCell>
                        <TableHeaderCell numeric className="pr-4">Share of revenue</TableHeaderCell>
                      </>
                    ) : (
                      <TableHeaderCell numeric className="pr-4">Hours</TableHeaderCell>
                    )}
                  </tr>
                </TableHead>
                <TableBody>
                  {data.variants.map((row) => (
                    <TableRow key={row.variantId ?? row.name} data-selected={focus !== null && row.variantId === focus ? 'true' : undefined} className="h-12" data-testid="variant-row">
                      <TableCell className="max-w-[260px] pl-4"><VariantName row={row} /></TableCell>
                      <TableCell numeric className="w-[120px]">
                        {row.plannedUnits === null ? (
                          <span className="text-fg-muted">None</span>
                        ) : (
                          <div className="flex flex-col items-end gap-1">
                            <span className="text-fg-secondary">{units(row.plannedUnits)}</span>
                            <span className="w-16"><PlanMeter built={row.units} planned={row.plannedUnits} label={`${row.name} built against planned`} /></span>
                          </div>
                        )}
                      </TableCell>
                      <TableCell numeric className="font-medium">{units(row.units)}</TableCell>
                      <TableCell numeric className={cn(Number(row.scrap) > 0 ? 'text-warning-text' : 'text-fg-muted')}>{units(row.scrap)}</TableCell>
                      {money ? (
                        <>
                          <TableCell numeric className="font-medium whitespace-nowrap"><Money cents={row.revenueCents} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap text-fg-secondary"><Money cents={row.laborCents} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap text-fg-secondary"><Money cents={row.materialCents} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap text-fg-secondary"><Money cents={otherCost(row)} /></TableCell>
                          <TableCell numeric className="font-medium whitespace-nowrap"><Money cents={row.profitCents} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap"><Margin marginBp={row.marginBp} targetBp={null} /></TableCell>
                          <TableCell numeric className="whitespace-nowrap"><Money cents={row.profitPerUnitCents} /></TableCell>
                          <TableCell numeric className="w-[150px] pr-4">
                            <ShareBar bp={row.revenueShareBp} max={maxShare} />
                          </TableCell>
                        </>
                      ) : (
                        <TableCell numeric className="pr-4 text-fg-secondary">{row.hours}</TableCell>
                      )}
                    </TableRow>
                  ))}
                </TableBody>
                <tfoot>
                  {money && (fees.totalCents ?? 0) !== 0 ? (
                    <tr className="h-10 border-t border-border-default" data-testid="variant-fees">
                      <TableCell className="pl-4">
                        <Tooltip content={fees.byKind.map((item) => `${feeKindLabel(item.kind)} ${formatMoney(item.cents)}`).join(', ')}>
                          <span tabIndex={0} className="rounded-sm font-medium text-fg-secondary underline decoration-border-strong decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">Program fees</span>
                        </Tooltip>
                      </TableCell>
                      <TableCell colSpan={3} />
                      <TableCell numeric className="whitespace-nowrap"><Money cents={fees.totalCents} /></TableCell>
                      <TableCell colSpan={3} />
                      <TableCell numeric className="whitespace-nowrap"><Money cents={fees.totalCents} /></TableCell>
                      <TableCell colSpan={2} />
                      <TableCell numeric className="pr-4"><ShareBar bp={total.revenueCents ? ratioBp(fees.totalCents ?? 0, total.revenueCents) : null} max={maxShare} /></TableCell>
                    </tr>
                  ) : null}
                  {showNotTied ? <FooterRow label="Not tied to a variant" hint="Job cost on days with no units, and builds with no variant." row={notTied} money={money} testId="variant-not-tied" /> : null}
                  <tr className="h-11 border-t-2 border-border-strong bg-sunken font-semibold" data-testid="variant-total">
                    <TableCell className="pl-4">Total</TableCell>
                    <TableCell numeric>{units(plannedTotal)}</TableCell>
                    <TableCell numeric>{units(total.units)}</TableCell>
                    <TableCell numeric>{units(total.scrap)}</TableCell>
                    {money ? <TotalMoney total={total} /> : <TableCell numeric className="pr-4">{total.hours}</TableCell>}
                  </tr>
                </tfoot>
              </Table>
            </div>
          </>
        )}
      </DashSection>
      {money ? (
        <p className="text-xs text-fg-muted">
          {per} counts are good units. Revenue is each build at its price card price. The Total equals the Overview, to the cent.
        </p>
      ) : null}
    </DashboardFrame>
  );
}

function ShareBar({ bp, max }: { readonly bp: number | null; readonly max: number }) {
  if (bp === null) return <span className="text-fg-muted">None</span>;
  // Bars are drawn against the biggest share, so variants of a similar size can still be told apart.
  const share = max > 0 ? Math.max(0, Math.min(1, bp / max)) : 0;
  return (
    <span className="inline-flex w-full items-center justify-end gap-2">
      <span aria-hidden className="h-1.5 w-16 overflow-hidden rounded-full bg-[var(--pulse-chart-track)]">
        <span className="block h-full rounded-full bg-[var(--pulse-series-1)]" style={{ width: `${share * 100}%` }} />
      </span>
      <span className="w-12 text-right tabular-nums">{formatPercentBp(bp, { fixed: true })}</span>
    </span>
  );
}

function FooterRow({ label, hint, row, money, testId }: { readonly label: string; readonly hint: string; readonly row: ProgramVariantRowDTO; readonly money: boolean; readonly testId: string }) {
  return (
    <tr className="h-10 border-t border-border-subtle" data-testid={testId}>
      <TableCell className="pl-4">
        <Tooltip content={hint}>
          <span tabIndex={0} className="rounded-sm font-medium text-fg-secondary underline decoration-border-strong decoration-dotted underline-offset-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">{label}</span>
        </Tooltip>
      </TableCell>
      <TableCell />
      <TableCell numeric>{units(row.units)}</TableCell>
      <TableCell numeric className="text-fg-muted">{units(row.scrap)}</TableCell>
      {money ? (
        <>
          <TableCell numeric className="whitespace-nowrap"><Money cents={row.revenueCents} /></TableCell>
          <TableCell numeric className="whitespace-nowrap text-fg-secondary"><Money cents={row.laborCents} /></TableCell>
          <TableCell numeric className="whitespace-nowrap text-fg-secondary"><Money cents={row.materialCents} /></TableCell>
          <TableCell numeric className="whitespace-nowrap text-fg-secondary"><Money cents={otherCost(row)} /></TableCell>
          <TableCell numeric className="whitespace-nowrap"><Money cents={row.profitCents} /></TableCell>
          <TableCell colSpan={3} className="pr-4" />
        </>
      ) : (
        <TableCell numeric className="pr-4 text-fg-secondary">{row.hours}</TableCell>
      )}
    </tr>
  );
}

function TotalMoney({ total }: { readonly total: ProgramFiguresDTO }) {
  return (
    <>
      <TableCell numeric className="whitespace-nowrap"><Money cents={total.revenueCents} /></TableCell>
      <TableCell numeric className="whitespace-nowrap"><Money cents={total.laborCents} /></TableCell>
      <TableCell numeric className="whitespace-nowrap"><Money cents={total.materialCents} /></TableCell>
      <TableCell numeric className="whitespace-nowrap"><Money cents={otherCost(total)} /></TableCell>
      <TableCell numeric className="whitespace-nowrap"><Money cents={total.profitCents} /></TableCell>
      <TableCell numeric className="whitespace-nowrap"><Margin marginBp={total.marginBp} targetBp={null} /></TableCell>
      <TableCell numeric className="whitespace-nowrap"><Money cents={total.profitPerUnitCents} /></TableCell>
      <TableCell numeric className="pr-4"><span className="tabular-nums">{total.revenueCents ? '100.0%' : ''}</span></TableCell>
    </>
  );
}

