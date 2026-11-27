'use client';
/**
 * KitStak Programs on a job page (docs/programs/SPEC.md 6.1): the Program card (this month's
 * units and revenue from Pulse stamps, checked against Projects to the cent) and the By variant
 * table, whose footer rows make it add up to the job's own numbers.
 */
import { useState } from 'react';
import { AlertTriangle, CircleCheck, ExternalLink, Info, RefreshCw, Repeat } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, SearchInput, Table, TableBody, TableCell, TableHead, TableHeaderCell, TableRow, Tooltip, toast } from '@/components/ui';
import { buttonVariants } from '@/components/ui/button';
import { cn } from '@/components/ui/cn';
import { labelColorVars, isLabelColor } from '@/components/ui/label-color';
import { seriesColor } from '@/components/charts/chart-format';
import '@/components/charts/charts.css';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RelativeTime } from '@/components/pulse/local-time';
import { useShell } from '@/features/shell/shell-context';
import { formatMoney, formatNumber, formatPercentBp, formatUnitPrice } from '@/lib/format';
import { useJobProgram, useProgramsToLink } from '@/lib/hooks/use-data';
import type { JobDetailDTO, JobProgramBlockDTO, JobProgramDTO, JobProgramTagDTO, ProgramToLinkDTO } from '@/lib/types';
import { linkProgramAction } from '@/server/actions/jobs';
import { syncNowAction } from '@/server/actions/integrations';
import { useRefreshJob } from './job-data';
import { programJobBanner, programPlanLines, programPriceLine, type JobProgramPageDTO } from './program-job';
import { callAction } from './use-job-actions';

const MONTH = new Intl.DateTimeFormat('en-US', { month: 'long', timeZone: 'UTC' });
const monthWord = (month: string | null): string => (month ? MONTH.format(new Date(`${month}-01T00:00:00Z`)) : 'This month');

/** Absolute address of a Projects path, or null when Projects is not on the plan (never a dead link). */
function useProjectsHref(): (path: string | null | undefined) => string | null {
  const shell = useShell();
  return (path) => (path && shell.modules.projects ? `${shell.appUrls.projects.replace(/\/+$/, '')}${path}` : null);
}

/** "Program GLOVE" next to the job number. Links to the program in Projects when the app is there. */
export function ProgramBadge({ program, className }: { readonly program: JobProgramTagDTO; readonly className?: string }) {
  const href = useProjectsHref()(program.path);
  const label = program.kind === 'program' ? `Program ${program.key ?? ''}`.trim() : `Builds of ${program.key ?? 'a program'}`;
  const tip = program.kind === 'program' ? `${program.name ?? program.key ?? 'A program'} in Projects bills to this job. Units, prices and fees come from it.` : `${program.buildCount === 1 ? 'A build' : `${program.buildCount} builds`} in Projects bill to this job.`;
  const body = (
    <span className={cn('inline-flex h-7 items-center gap-1.5 rounded-md border border-border-subtle bg-panel px-2 text-xs font-medium text-fg pointer-coarse:h-11', className)} data-testid="job-program-badge">
      <Repeat aria-hidden className="size-3.5" />
      {label}
      {href ? <ExternalLink aria-hidden className="size-3" /> : null}
    </span>
  );
  return (
    <Tooltip content={tip}>
      {href ? (
        <a href={href} target="_blank" rel="noreferrer" className="rounded-md focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
          {body}
          <span className="sr-only">(opens in a new tab)</span>
        </a>
      ) : (
        <span tabIndex={0} className="rounded-md focus-visible:outline-2 focus-visible:outline-focus">
          {body}
        </span>
      )}
    </Tooltip>
  );
}

/** One line that says whether Pulse and Projects show the same money this month. */
function Parity({ block, data, onSync, syncing }: { readonly block: JobProgramBlockDTO; readonly data: JobProgramDTO; readonly onSync: () => void; readonly syncing: boolean }) {
  if (data.moneyHidden || block.matches === null) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-secondary" data-testid="program-parity" data-state="unknown">
        <Info aria-hidden className="size-4 shrink-0 text-fg-muted" />
        {data.moneyHidden ? 'Money is hidden for your role.' : 'Projects could not be read just now. Pulse shows what it last synced.'}
      </p>
    );
  }
  if (block.matches) {
    return (
      <p className="flex items-center gap-2 text-sm font-medium text-success-text" data-testid="program-parity" data-state="match">
        <CircleCheck aria-hidden className="size-4 shrink-0" />
        Matches Projects to the cent
      </p>
    );
  }
  if (data.pendingSync) {
    return (
      <p className="flex items-center gap-2 text-sm text-fg-secondary" data-testid="program-parity" data-state="pending">
        <RefreshCw aria-hidden className="size-4 shrink-0 text-fg-muted" />
        Pulse is catching up with Projects. This takes a minute or two.
      </p>
    );
  }
  const diff = block.diffCents ?? 0;
  return (
    <div className="flex flex-wrap items-center gap-2" data-testid="program-parity" data-state="off">
      <p className="flex items-center gap-2 text-sm font-medium text-warning-text">
        <AlertTriangle aria-hidden className="size-4 shrink-0" />
        Pulse is {formatMoney(Math.abs(diff))} {diff > 0 ? 'under' : 'over'} Projects this month
      </p>
      {data.canSync ? (
        <Button size="sm" variant="secondary" leadingIcon={<RefreshCw aria-hidden />} loading={syncing} onClick={onSync} data-testid="program-sync-now">
          Sync now
        </Button>
      ) : null}
    </div>
  );
}

function ProgramCard({ job, data, holdsProgram }: { readonly job: JobDetailDTO; readonly data: JobProgramDTO; readonly holdsProgram: boolean }) {
  const projectsHref = useProjectsHref();
  const refresh = useRefreshJob();
  const [syncing, setSyncing] = useState(false);
  const sync = async () => {
    setSyncing(true);
    const done = await callAction(syncNowAction({ source: 'projects' }), "Couldn't sync with Projects");
    setSyncing(false);
    if (!done) return;
    await refresh();
    toast.success('Synced with Projects', done[0]?.message ?? 'Pulse has the latest from Projects.');
  };
  const month = monthWord(data.month);
  return (
    <Panel
      title="Program"
      action={
        data.lastSyncAt ? (
          <span className="text-xs text-fg-muted">
            Synced <RelativeTime iso={data.lastSyncAt} />
          </span>
        ) : undefined
      }
      bodyClassName="p-0"
    >
      <ul className="divide-y divide-border-subtle" data-testid="job-program-card">
        {data.blocks.map((block) => {
          const href = projectsHref(block.path);
          return (
            <li key={block.programId} className="flex flex-col gap-3 px-4 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3">
                  <span aria-hidden className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-border-subtle text-icon">
                    <Repeat className="size-4" />
                  </span>
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2 text-sm font-semibold text-fg">
                      <span className="truncate">{block.name}</span>
                      <Badge tone="outline">
                        {block.key}
                      </Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-fg-secondary">
                      {block.role === 'program_job' ? `Bills to ${job.number}` : `Builds of ${block.key} bill to ${job.number} one by one`} · Counts {block.unitPlural}
                    </p>
                  </div>
                </div>
                {href ? (
                  <a href={href} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')} data-testid={holdsProgram ? 'open-program-in-projects' : 'open-program'}>
                    {/* A program job has "Open program" in its banner, to the program page here. */}
                    {holdsProgram ? 'Open in Projects' : 'Open program'}
                    <ExternalLink aria-hidden className="size-3.5" />
                    <span className="sr-only">(opens in a new tab)</span>
                  </a>
                ) : null}
              </div>
              <dl className="grid grid-cols-2 gap-3 sm:max-w-md">
                <div className="rounded-lg bg-sunken px-3 py-2.5">
                  <dt className="text-xs text-fg-muted">{month} {block.unitPlural}</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg" data-testid="program-month-units">
                    {formatNumber(block.monthUnits, { maxDigits: 0 })}
                  </dd>
                </div>
                <div className="rounded-lg bg-sunken px-3 py-2.5">
                  <dt className="text-xs text-fg-muted">{month} revenue</dt>
                  <dd className="mt-0.5 text-lg font-semibold tabular-nums text-fg" data-testid="program-month-revenue">
                    {data.moneyHidden ? 'Hidden' : formatMoney(block.monthRevenueCents)}
                  </dd>
                </div>
              </dl>
              <Parity block={block} data={data} onSync={() => void sync()} syncing={syncing} />
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/**
 * A variant's own color when Projects set one, else the chart series hue for its place. The series hues are
 * checked to stay apart on light and dark panels, so no two dots look alike and none fades into the card.
 */
const dotColor = (color: string | null, index: number): string => (isLabelColor(color) ? labelColorVars(color).bg : seriesColor(index % 8));
const LABOR_WORDS = 'Labor and time not on a job';
const LABOR_HINT = 'Labor cost of the hours, plus each line’s share of time not on a job. Profit shows the two apart.';

function money(cents: number | null | undefined, hidden: boolean): string {
  if (hidden) return '';
  return formatMoney(cents ?? 0);
}

function ByVariant({ data, unitLabel }: { readonly data: JobProgramDTO; readonly unitLabel: string }) {
  const hidden = data.moneyHidden;
  const totals = data.totals;
  const several = data.blocks.length > 1;
  const footer: (FooterRow & { show: boolean })[] = totals
    ? [
        ...data.blocks.map((block) => ({ key: `fees-${block.programId}`, label: several ? `${block.key} program fees` : 'Program fees', hint: 'Monthly fee, batch, hourly and setup charges, adjustments and the minimum top up, from the price card.', revenue: block.feesCents, labor: null, material: null, extraCost: 0, show: block.feeRows > 0 })),
        { key: 'prep', label: 'Prep and typed work', hint: 'Typed lines and prep time on days with no build output, plus typed lines that carry their own units. Hours on a build day are split over that day’s variants.', revenue: totals.prepRevenueCents, labor: totals.prepLaborCents, material: totals.prepMaterialCents, extraCost: 0, show: Number(totals.prepHours) > 0 || (totals.prepLaborCents ?? 0) !== 0 },
        { key: 'other', label: 'Other revenue and costs', hint: `Invoices, credits and other costs of the job, not of one variant. ${formatMoney(totals.otherCostCents ?? 0)} of cost is taken off in Profit.`, revenue: totals.otherRevenueCents, labor: null, material: null, extraCost: totals.otherCostCents ?? 0, show: (totals.otherRevenueCents ?? 0) !== 0 || (totals.otherCostCents ?? 0) !== 0 },
      ]
    : [];
  const rowsShown = data.blocks.reduce((sum, block) => sum + block.variants.length, 0);
  const laborTotal = data.blocks.reduce((sum, block) => sum + block.variants.reduce((inner, row) => inner + (row.laborCents ?? 0), 0), 0) + (totals?.prepLaborCents ?? 0);
  const materialTotal = data.blocks.reduce((sum, block) => sum + block.variants.reduce((inner, row) => inner + (row.materialCents ?? 0), 0), 0) + (totals?.prepMaterialCents ?? 0);
  return (
    <Panel title="By variant" bodyClassName="p-0">
      {rowsShown === 0 ? (
        <p className="px-4 py-6 text-sm text-fg-secondary">No build output on this job yet. Each kit the program makes shows up here after its first logged day.</p>
      ) : (
        <div className="overflow-hidden rounded-b-xl">
          <VariantCards data={data} unitLabel={unitLabel} footer={footer.filter((row) => row.show)} />
          <Table aria-label="Revenue, cost and profit of this job by variant" data-testid="job-by-variant" scrollClassName="max-sm:hidden">
            <TableHead>
              <TableRow className="hover:bg-transparent">
                <TableHeaderCell>Variant</TableHeaderCell>
                <TableHeaderCell numeric>{unitLabel}</TableHeaderCell>
                {hidden ? null : (
                  <>
                    <TableHeaderCell numeric>Revenue</TableHeaderCell>
                    <TableHeaderCell numeric className="hidden md:table-cell">
                      <Tooltip content={LABOR_HINT}>
                        <span tabIndex={0} className="cursor-help border-b border-dotted border-border-default focus-visible:outline-2 focus-visible:outline-focus">
                          {LABOR_WORDS}
                        </span>
                      </Tooltip>
                    </TableHeaderCell>
                    <TableHeaderCell numeric className="hidden md:table-cell">
                      Material
                    </TableHeaderCell>
                    <TableHeaderCell numeric>Profit</TableHeaderCell>
                    <TableHeaderCell numeric className="hidden sm:table-cell">
                      Margin
                    </TableHeaderCell>
                    <TableHeaderCell numeric className="hidden lg:table-cell">
                      Share
                    </TableHeaderCell>
                  </>
                )}
              </TableRow>
            </TableHead>
            <TableBody>
              {data.blocks.map((block) => (
                <BlockRows key={block.programId} block={block} hidden={hidden} heading={several} />
              ))}
              {hidden
                ? null
                : footer
                    .filter((row) => row.show)
                    .map((row) => (
                      <TableRow key={row.key} className="bg-sunken/60 hover:bg-sunken/60">
                        <TableCell>
                          <Tooltip content={row.hint}>
                            <span tabIndex={0} className="cursor-help border-b border-dotted border-border-default text-fg-secondary focus-visible:outline-2 focus-visible:outline-focus">
                              {row.label}
                            </span>
                          </Tooltip>
                        </TableCell>
                        <TableCell numeric className="text-fg-muted" />
                        <TableCell numeric>{row.revenue === null ? '' : money(row.revenue, hidden)}</TableCell>
                        <TableCell numeric className="hidden md:table-cell">
                          {row.labor === null ? '' : money(row.labor, hidden)}
                        </TableCell>
                        <TableCell numeric className="hidden md:table-cell">
                          {row.material === null ? '' : money(row.material, hidden)}
                        </TableCell>
                        <TableCell numeric className={cn((row.revenue ?? 0) - (row.labor ?? 0) - (row.material ?? 0) - row.extraCost < 0 && 'text-danger-text')}>
                          {money((row.revenue ?? 0) - (row.labor ?? 0) - (row.material ?? 0) - row.extraCost, hidden)}
                        </TableCell>
                        <TableCell numeric className="hidden sm:table-cell" />
                        <TableCell numeric className="hidden lg:table-cell" />
                      </TableRow>
                    ))}
              {totals && !hidden ? (
                <TableRow className="border-t-2 border-border-default font-semibold hover:bg-transparent" data-testid="by-variant-total">
                  <TableCell>Job total</TableCell>
                  <TableCell numeric>{formatNumber(totals.units, { maxDigits: 0 })}</TableCell>
                  <TableCell numeric>{money(totals.revenueCents, hidden)}</TableCell>
                  <TableCell numeric className="hidden md:table-cell">
                    {money(laborTotal, hidden)}
                  </TableCell>
                  <TableCell numeric className="hidden md:table-cell">
                    {money(materialTotal, hidden)}
                  </TableCell>
                  <TableCell numeric>{money(totals.profitCents, hidden)}</TableCell>
                  <TableCell numeric className="hidden sm:table-cell">
                    {formatPercentBp(totals.marginBp, { empty: '' })}
                  </TableCell>
                  <TableCell numeric className="hidden lg:table-cell">
                    100%
                  </TableCell>
                </TableRow>
              ) : null}
            </TableBody>
          </Table>
          <p className="border-t border-border-subtle px-4 py-2.5 text-xs text-fg-muted">
            {hidden ? 'Money is hidden for your role.' : 'Hours typed on a build day are split over that day’s variants by units, with their share of time not on a job. The job total matches the numbers above.'}
          </p>
        </div>
      )}
    </Panel>
  );
}

interface FooterRow {
  readonly key: string;
  readonly label: string;
  readonly hint: string;
  readonly revenue: number | null;
  readonly labor: number | null;
  readonly material: number | null;
  readonly extraCost: number;
}

/** One figure on a phone card: a small label over the number. */
function CardFigure({ label, value, tone }: { readonly label: string; readonly value: string; readonly tone?: 'danger' }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-xs text-fg-muted">{label}</dt>
      <dd className={cn('truncate text-sm font-medium text-fg tabular-nums', tone === 'danger' && 'text-danger-text')}>{value}</dd>
    </div>
  );
}

/**
 * The By variant table as stacked cards under the sm breakpoint: every key figure of a variant
 * shows at once on a phone, with no sideways scroll. Fee and other rows, then the job total, close the list.
 */
function VariantCards({ data, unitLabel, footer }: { readonly data: JobProgramDTO; readonly unitLabel: string; readonly footer: readonly FooterRow[] }) {
  const hidden = data.moneyHidden;
  const totals = data.totals;
  const several = data.blocks.length > 1;
  const unitWord = `${unitLabel.charAt(0).toUpperCase()}${unitLabel.slice(1)}`;
  // The same columns as the desktop table; Material only when some variant has any.
  const anyMaterial = data.blocks.some((block) => block.variants.some((row) => (row.materialCents ?? 0) !== 0));
  return (
    <div className="flex flex-col gap-2 p-3 sm:hidden" data-testid="job-by-variant-cards">
      {data.blocks.map((block) => (
        <section key={block.programId} className="flex flex-col gap-2" aria-label={`${block.key} ${block.name}`}>
          {several ? (
            <h3 className="px-1 pt-1 text-xs font-semibold uppercase tracking-wide text-fg-secondary">
              {block.key} {block.name}
            </h3>
          ) : null}
          {block.variants.map((row, index) => (
            <article key={`${block.programId}:${row.variantId ?? 'none'}`} className="rounded-lg border border-border-subtle bg-panel p-3" data-testid="by-variant-card">
              <header className="flex min-w-0 items-center gap-2">
                <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: row.variantId ? dotColor(row.color, index) : 'var(--border-default)' }} />
                <span className="truncate text-sm font-semibold text-fg">{row.name}</span>
                {row.key ? <span className="text-xs text-fg-muted">{row.key}</span> : null}
                {hidden || row.shareBp === null ? null : (
                  <span className="ml-auto shrink-0 text-xs text-fg-muted tabular-nums">{formatPercentBp(row.shareBp, { empty: '', digits: 0 })} of revenue</span>
                )}
              </header>
              <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                <CardFigure label={unitWord} value={formatNumber(row.units, { maxDigits: 0 })} />
                {hidden ? null : (
                  <>
                    <CardFigure label="Revenue" value={money(row.revenueCents, hidden)} />
                    <CardFigure label={LABOR_WORDS} value={money(row.laborCents, hidden)} />
                    {anyMaterial ? <CardFigure label="Material" value={money(row.materialCents, hidden)} /> : null}
                    <CardFigure label="Profit" value={money(row.profitCents, hidden)} tone={(row.profitCents ?? 0) < 0 ? 'danger' : undefined} />
                    <CardFigure label="Margin" value={formatPercentBp(row.marginBp, { empty: 'No revenue' })} />
                  </>
                )}
              </dl>
            </article>
          ))}
        </section>
      ))}
      {hidden
        ? null
        : footer.map((row) => {
            const profit = (row.revenue ?? 0) - (row.labor ?? 0) - (row.material ?? 0) - row.extraCost;
            return (
              <article key={row.key} className="rounded-lg border border-border-subtle bg-sunken/60 p-3" data-testid="by-variant-card-extra">
                <h3 className="text-sm font-medium text-fg-secondary">{row.label}</h3>
                <p className="mt-0.5 text-xs text-fg-muted">{row.hint}</p>
                <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                  <CardFigure label="Revenue" value={row.revenue === null ? 'None' : money(row.revenue, hidden)} />
                  <CardFigure label="Profit" value={money(profit, hidden)} tone={profit < 0 ? 'danger' : undefined} />
                </dl>
              </article>
            );
          })}
      {totals && !hidden ? (
        <article className="rounded-lg border-2 border-border-default bg-panel p-3" data-testid="by-variant-card-total">
          <h3 className="text-sm font-semibold text-fg">Job total</h3>
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
            <CardFigure label={unitWord} value={formatNumber(totals.units, { maxDigits: 0 })} />
            <CardFigure label="Revenue" value={money(totals.revenueCents, hidden)} />
            <CardFigure label="Profit" value={money(totals.profitCents, hidden)} tone={(totals.profitCents ?? 0) < 0 ? 'danger' : undefined} />
            <CardFigure label="Margin" value={formatPercentBp(totals.marginBp, { empty: 'No revenue' })} />
          </dl>
        </article>
      ) : null}
    </div>
  );
}

function BlockRows({ block, hidden, heading }: { readonly block: JobProgramBlockDTO; readonly hidden: boolean; readonly heading: boolean }) {
  return (
    <>
      {heading ? (
        <TableRow className="hover:bg-transparent">
          <TableCell colSpan={hidden ? 2 : 8} className="bg-sunken text-xs font-semibold uppercase tracking-wide text-fg-secondary">
            {block.key} {block.name}
          </TableCell>
        </TableRow>
      ) : null}
      {block.variants.map((row, index) => (
        <TableRow key={`${block.programId}:${row.variantId ?? 'none'}`} data-testid="by-variant-row">
          <TableCell>
            <span className="flex min-w-0 items-center gap-2">
              <span aria-hidden className="size-2.5 shrink-0 rounded-full" style={{ background: row.variantId ? dotColor(row.color, index) : 'var(--border-default)' }} />
              <span className="truncate">{row.name}</span>
              {row.key ? <span className="hidden text-xs text-fg-muted sm:inline">{row.key}</span> : null}
            </span>
          </TableCell>
          <TableCell numeric>{formatNumber(row.units, { maxDigits: 0 })}</TableCell>
          {hidden ? null : (
            <>
              <TableCell numeric>{money(row.revenueCents, hidden)}</TableCell>
              <TableCell numeric className="hidden md:table-cell">
                {money(row.laborCents, hidden)}
              </TableCell>
              <TableCell numeric className="hidden md:table-cell">
                {money(row.materialCents, hidden)}
              </TableCell>
              <TableCell numeric className={cn((row.profitCents ?? 0) < 0 && 'text-danger-text')}>
                {money(row.profitCents, hidden)}
              </TableCell>
              <TableCell numeric className="hidden sm:table-cell">
                {formatPercentBp(row.marginBp, { empty: '' })}
              </TableCell>
              <TableCell numeric className="hidden lg:table-cell">
                {formatPercentBp(row.shareBp, { empty: '', digits: 0 })}
              </TableCell>
            </>
          )}
        </TableRow>
      ))}
    </>
  );
}

/** The program panels of a job page. Renders nothing for a job no program feeds. */
export function JobProgramPanels({ job, holdsProgram = false }: { readonly job: JobDetailDTO; readonly holdsProgram?: boolean }) {
  const query = useJobProgram(job.program ? job.number : null);
  const data = query.data;
  if (!job.program || !data?.available || data.blocks.length === 0) return null;
  return (
    <div className="flex flex-col gap-5" data-testid="job-program">
      <ProgramCard job={job} data={data} holdsProgram={holdsProgram} />
      <ByVariant data={data} unitLabel={job.unitLabel.charAt(0).toUpperCase() + job.unitLabel.slice(1)} />
    </div>
  );
}

/**
 * "Link a program": pick a KitStak program to bill to this job. The server checks the job with
 * the same rule Projects uses; a job with typed units in an open month is offered "Move those
 * units to a typed adjustment" first.
 */
export function LinkProgramDialog({ job, open, onOpenChange }: { readonly job: JobDetailDTO; readonly open: boolean; readonly onOpenChange: (open: boolean) => void }) {
  const refresh = useRefreshJob();
  const [q, setQ] = useState('');
  const [picked, setPicked] = useState<ProgramToLinkDTO | null>(null);
  const [busy, setBusy] = useState(false);
  const query = useProgramsToLink(open ? job.number : null, q.trim());
  const list = query.data ?? [];
  const typedUnits = picked?.refusalReason === 'has_typed_units';
  const close = () => {
    setPicked(null);
    setQ('');
    onOpenChange(false);
  };
  const link = async () => {
    if (!picked) return;
    setBusy(true);
    const saved = await callAction(linkProgramAction({ jobId: job.id, programId: picked.id, moveTypedUnits: typedUnits }), "Couldn't link the program");
    setBusy(false);
    if (!saved) return;
    await refresh();
    toast.success(`${picked.key} now bills to ${job.number}`, 'Build output and fees show up here after Projects updates the program, usually within a few minutes.');
    close();
  };
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent size="md" data-testid="link-program-dialog">
        <DialogHeader title="Link a program" description={`The program's build output, prices and fees then come into ${job.number}. A program bills to one ongoing per unit job.`} />
        <DialogBody className="flex flex-col gap-3">
          {picked && typedUnits ? (
            <div className="rounded-lg bg-warning-subtle px-3 py-3 text-sm text-warning-text" data-testid="link-program-typed-units">
              <p className="font-medium">This job has units typed in an open month.</p>
              <p className="mt-1">
                Builds bring their own units, so typed ones would count twice. Pulse can move the money of those units into one adjustment per month and keep their
                hours and crew. Then {picked.key} can bill to this job.
              </p>
            </div>
          ) : (
            <>
              <SearchInput value={q} onValueChange={setQ} placeholder="Search programs by name or key" aria-label="Search programs" autoFocus />
              <ul className="flex max-h-80 flex-col gap-1.5 overflow-y-auto" role="listbox" aria-label="Programs" data-testid="link-program-list">
                {query.isPending ? <li className="px-1 py-3 text-sm text-fg-secondary">Loading programs.</li> : null}
                {!query.isPending && list.length === 0 ? (
                  <li className="px-1 py-3 text-sm text-fg-secondary">{q ? 'No program matches that search.' : 'No program can bill to a job yet. Make one in Projects first.'}</li>
                ) : null}
                {list.map((item) => {
                  const blocked = Boolean(item.refusal) && item.refusalReason !== 'has_typed_units';
                  const selected = picked?.id === item.id;
                  return (
                    <li key={item.id} role="option" aria-selected={selected} aria-disabled={blocked || item.linkedHere}>
                      <button
                        type="button"
                        disabled={blocked || item.linkedHere}
                        onClick={() => setPicked(item)}
                        className={cn(
                          'flex w-full items-start gap-3 rounded-lg border px-3 py-2.5 text-left focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus',
                          selected ? 'border-border-strong bg-selected' : 'border-border-subtle hover:bg-hover',
                          (blocked || item.linkedHere) && 'cursor-not-allowed opacity-70 hover:bg-transparent',
                        )}
                      >
                        <Repeat aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
                        <span className="min-w-0 flex-1">
                          <span className="flex flex-wrap items-center gap-2 text-sm font-medium text-fg">
                            {item.name}
                            <Badge tone="outline">
                              {item.key}
                            </Badge>
                            {item.sameCustomer ? (
                              <Badge tone="success">
                                Same client
                              </Badge>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block text-xs text-fg-secondary">
                            {item.linkedHere ? 'Already bills to this job' : item.refusal && blocked ? item.refusal : `${item.customerName ?? 'No customer'} · counts ${item.unitPlural}`}
                          </span>
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
        </DialogBody>
        <DialogFooter>
          {picked && typedUnits ? (
            <Button variant="secondary" onClick={() => setPicked(null)} disabled={busy}>
              Cancel
            </Button>
          ) : (
            <Button variant="secondary" onClick={close} disabled={busy}>
              Cancel
            </Button>
          )}
          <Button onClick={() => void link()} disabled={!picked} loading={busy} data-testid="link-program-confirm">
            {picked && typedUnits ? 'Move those units to a typed adjustment' : picked ? `Link ${picked.key}` : 'Link program'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The top of a program job's page (`/jobs/J-1040?view=job`, PULSE_PROGRAMS_SPEC 5.3): what the
 * job is for, and "Open program" to the program page in Pulse.
 */
export function ProgramJobBanner({ program }: { readonly program: JobProgramPageDTO['program'] }) {
  return (
    <section
      aria-label={`${program.key} program`}
      className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-panel px-4 py-3"
      data-testid="program-job-banner"
    >
      <p className="flex min-w-0 flex-1 items-start gap-2 text-sm text-fg">
        <Repeat aria-hidden className="mt-0.5 size-4 shrink-0 text-icon" />
        <span>{programJobBanner(program.key)}</span>
      </p>
      <ButtonLink href={program.path} size="sm" icon={<Repeat aria-hidden />} testId="program-job-open">
        Open program
      </ButtonLink>
    </section>
  );
}

/**
 * In place of the Quote and Budget and the Plan vs actual tabs of a program job: its plan comes
 * from the program. A quote or budget typed on the job before is kept but not used.
 */
export function ProgramPlanNote({ job, program, className }: { readonly job: Pick<JobDetailDTO, 'quote' | 'budget'>; readonly program: JobProgramPageDTO['program']; readonly className?: string }) {
  const [line, kept] = programPlanLines(program.key, { quote: Boolean(job.quote), budget: Boolean(job.budget) });
  return (
    <p className={cn('flex items-start gap-2 rounded-lg border border-border-subtle bg-sunken px-3.5 py-2.5 text-sm text-fg-secondary', className)} data-testid="program-plan-note">
      <Info aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
      <span>
        {line}
        {kept ? <span className="block text-fg-muted" data-testid="program-plan-kept">{kept}</span> : null}
      </span>
    </p>
  );
}

/** The Price section of a job a program feeds: read only, the prices live on the program's price card. */
export function ProgramPricePanel({ job, program = null }: { readonly job: JobDetailDTO; readonly program?: JobProgramPageDTO | null }) {
  if (program) return <ProgramJobPricePanel program={program} />;
  return <FedJobPricePanel job={job} />;
}

/** A program job: "Varies by variant" (or the one card price), and which card the prices come from. */
function ProgramJobPricePanel({ program }: { readonly program: JobProgramPageDTO }) {
  const projectsHref = useProjectsHref();
  const ref = program.program;
  const href = ref.deleted ? null : projectsHref(`${ref.projectsPath}/price-card`);
  const price = program.price;
  return (
    <Panel
      title="Price"
      action={
        href ? (
          <a href={href} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')} data-testid="open-price-card">
            Open price card
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : undefined
      }
    >
      <div className="flex flex-col gap-2">
        {price && price.kind !== 'none' ? (
          <p className="text-sm text-fg-secondary">
            Price for one:{' '}
            <span className="text-md font-semibold text-fg tabular-nums" data-testid="price-current">
              {price.kind === 'single' ? formatUnitPrice(price.unitPrice) : 'Varies by variant'}
            </span>
          </p>
        ) : null}
        <p className="flex items-start gap-2 text-sm text-fg-secondary" data-testid="price-from-program">
          <Repeat aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
          <span>
            {programPriceLine(ref.key, ref.cardVersion)} Each day of build output keeps the price it was made at, so a later change never moves a day that already counted.
          </span>
        </p>
      </div>
    </Panel>
  );
}

function FedJobPricePanel({ job }: { readonly job: JobDetailDTO }) {
  const query = useJobProgram(job.program ? job.number : null);
  const projectsHref = useProjectsHref();
  const block = query.data?.blocks.find((item) => item.role === 'program_job') ?? query.data?.blocks[0] ?? null;
  const key = block?.key ?? job.program?.key ?? 'the program';
  const card = block?.cardVersion ? `${key} price card v${block.cardVersion}` : `the ${key} price card`;
  const href = projectsHref(block ? `${block.path}/price-card` : job.program?.path ? `${job.program.path}/price-card` : null);
  return (
    <Panel
      title="Price"
      action={
        href ? (
          <a href={href} target="_blank" rel="noreferrer" className={cn(buttonVariants({ variant: 'secondary', size: 'sm' }), 'no-underline')} data-testid="open-price-card">
            Open price card
            <ExternalLink aria-hidden className="size-3.5" />
            <span className="sr-only">(opens in a new tab)</span>
          </a>
        ) : undefined
      }
    >
      <p className="flex items-start gap-2 text-sm text-fg-secondary" data-testid="price-from-program">
        <Repeat aria-hidden className="mt-0.5 size-4 shrink-0 text-fg-muted" />
        <span>
          Prices come from <span className="font-medium text-fg">{card}</span> in Projects. Each day of build output keeps the price it was made at,
          so a later change never moves a day that already counted.
        </span>
      </p>
    </Panel>
  );
}
