'use client';
/**
 * Price card tab (docs/programs/SPEC.md 5.12, 4.4): a versions timeline on the left, the selected
 * version in the middle (read only when published, an editor when a draft), and the impact of a
 * draft on the right, from `useCardPreview`. Owners publish with a confirm that repeats the
 * impact; proposers ask for review and owners send back with a note. "Compare with" shows two
 * versions side by side; "Other prices for this customer" reads WMS and Pulse prices.
 */
import { useMemo, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, ArrowRight, CalendarClock, ChevronDown, Copy, EyeOff, FilePlus2, GitCompare, Lock, MoreHorizontal, Pencil, Plus, Receipt, Send, Trash2, Undo2 } from 'lucide-react';
import { addDays, changeBp, formatCents, formatUnitPrice, lastDayOfMonth, monthOf, mulQuantityPrice, shortDate } from '@kitstak/programs-engine';
import { Badge, Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger, EmptyState, Field, IconButton, Input, IsoDatePicker, Select, Skeleton, Textarea, cn, toast } from '@/components/ui';
import { PersonAvatar } from '@/components/pm';
import { Panel } from '@/components/layout/page';
import { useServerAction, unwrap } from '@/lib/hooks/use-action';
import { useAttributes, useCardPreview, useOtherPrices, usePriceCard, useProgramBuilds, useProgramSummary } from '@/lib/hooks/use-programs';
import { usePeopleMap } from '@/lib/hooks/use-people';
import { qk } from '@/lib/query-keys';
import type { CardImpactDTO, CardVersionDTO } from '@/lib/program-types';
import { createDraftVersionAction, deleteVersionAction, publishVersionAction, requestReviewAction, sendBackAction, unpublishVersionAction, updateDraftVersionAction } from '@/server/actions/price-cards';
import { updateProgramSettingsAction } from '@/server/actions/programs';
import { PriceLinesEditor, RateRulesEditor, fromCardLines, priceLinesProblems, type PriceLinesValue } from '../editors';
import type { EditorRule } from '../editors/variant-model';
import { useCurrentProgram } from '../program-context';
import { statementHref } from '../frame/program-menu';
import { LINE_KIND_LABEL, STATE_TONE, WARNING_TEXT, compareVersions, defaultVersionId, deltaText, firstStartDay, railOrder, stateText, toEditorAxes, toEditorRules, toLinePayload, toRulePayload, versionName, versionRanges } from './price-card-model';

/* ---------------------------------------------------------------------------------------------- */
/* Rail                                                                                           */
/* ---------------------------------------------------------------------------------------------- */

function VersionsRail({ versions, selectedId, onSelect, onNew, onAction }: { readonly versions: readonly CardVersionDTO[]; readonly selectedId: string | null; readonly onSelect: (id: string) => void; readonly onNew: (from: 'current' | 'empty') => void; readonly onAction: (action: 'duplicate' | 'edit' | 'delete', version: CardVersionDTO) => void }) {
  const { capabilities } = useCurrentProgram();
  const people = usePeopleMap();
  const ranges = useMemo(() => versionRanges(versions), [versions]);
  const ordered = useMemo(() => railOrder(versions), [versions]);
  return (
    <nav aria-label="Versions" className="flex flex-col gap-2 lg:sticky lg:top-4" data-testid="versions-rail">
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-fg">Versions</h2>
        {capabilities.canPropose ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button size="sm" variant="secondary" data-testid="new-version">
                <Plus aria-hidden />
                New version
                <ChevronDown aria-hidden />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-64">
              <DropdownMenuItem icon={<Copy aria-hidden />} description="Start from the rates in force now." onSelect={() => onNew('current')}>
                Copy the current version
              </DropdownMenuItem>
              <DropdownMenuItem icon={<FilePlus2 aria-hidden />} description="No lines yet." onSelect={() => onNew('empty')}>
                Start empty
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </div>
      <ol className="flex flex-col gap-1.5">
        {ordered.map((version) => {
          const active = version.id === selectedId;
          const author = version.publishedBy ? people.get(version.publishedBy)?.name : null;
          return (
            <li key={version.id} className="relative">
              <button
                type="button"
                onClick={() => onSelect(version.id)}
                aria-current={active ? 'true' : undefined}
                className={cn(
                  'flex w-full flex-col gap-1 rounded-lg border bg-panel px-3 py-2.5 pr-9 text-left outline-none focus-visible:outline-2 focus-visible:outline-focus',
                  active ? 'border-border-strong shadow-sm' : 'border-border-subtle hover:border-border-default',
                  version.state === 'in_force' && 'border-l-[3px] border-l-success',
                )}
                data-testid="version-item"
                data-state={version.state}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="rounded-sm bg-sunken px-1.5 text-xs font-semibold text-fg tabular-nums">{versionName(version)}</span>
                  {version.status === 'published' ? (
                    <Badge tone={STATE_TONE[version.state]}>
                      {stateText(version)}
                    </Badge>
                  ) : null}
                  {version.reviewStatus === 'waiting' ? <Badge tone="warning">Waiting for review</Badge> : null}
                  {version.reviewStatus === 'sent_back' ? <Badge tone="danger">Sent back</Badge> : null}
                </span>
                <span className="text-xs text-fg-secondary tabular-nums">{ranges.get(version.id)}</span>
                {version.label ? <span className="truncate text-xs font-medium text-fg">{version.label}</span> : null}
                {author ? <span className="truncate text-2xs text-fg-muted">Published by {author}</span> : version.source === 'variant_tab' ? <span className="text-2xs text-fg-muted">Rate changes from Variants</span> : null}
              </button>
              <span className="absolute top-2 right-1.5">
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`Actions for ${versionName(version)}`} icon={<MoreHorizontal aria-hidden />} size="xs" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-60">
                    <DropdownMenuItem icon={<Receipt aria-hidden />} onSelect={() => onSelect(version.id)}>
                      Open
                    </DropdownMenuItem>
                    {capabilities.canPropose ? (
                      <DropdownMenuItem icon={<Copy aria-hidden />} onSelect={() => onAction('duplicate', version)}>
                        Duplicate as draft
                      </DropdownMenuItem>
                    ) : null}
                    {capabilities.canPrice && version.state === 'scheduled' ? (
                      <DropdownMenuItem icon={<Pencil aria-hidden />} description="Moves this version back to a draft so you can change it" onSelect={() => onAction('edit', version)}>
                        Edit
                      </DropdownMenuItem>
                    ) : null}
                    {(version.state === 'draft' && capabilities.canPropose) || (version.state === 'scheduled' && capabilities.canPrice) ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem variant="danger" icon={<Trash2 aria-hidden />} onSelect={() => onAction('delete', version)}>
                          Delete
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Read only version                                                                              */
/* ---------------------------------------------------------------------------------------------- */

function VersionLines({ version }: { readonly version: CardVersionDTO }) {
  const { unit, variantById } = useCurrentProgram();
  const card = version.lines.filter((line) => line.variantId === null).sort((a, b) => a.position - b.position);
  const typed = version.lines.filter((line) => line.variantId !== null && line.ruleId === null);
  const ruled = version.lines.filter((line) => line.variantId !== null && line.ruleId !== null);
  return (
    <div className="flex flex-col gap-4">
      <section>
        <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Lines</h3>
        {card.length === 0 ? <p className="text-sm text-fg-muted">No lines.</p> : null}
        <ul className="flex flex-col divide-y divide-border-subtle rounded-lg border border-border-subtle">
          {card.map((line) => (
            <li key={line.id} className="flex items-center justify-between gap-3 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block text-fg">{line.label ?? (line.kind === 'per_unit' ? `Per ${unit.singular}` : LINE_KIND_LABEL[line.kind])}</span>
                {line.kind === 'flat_monthly' || line.kind === 'monthly_minimum' ? <span className="block text-xs text-fg-muted">{line.prorate ? 'A partial month is charged by its days' : 'A partial month is charged in full'}</span> : null}
              </span>
              <span className="font-medium text-fg tabular-nums">{line.kind === 'per_unit' ? formatUnitPrice(line.unitPrice) : line.kind === 'per_hour' ? `${formatCents(line.rateCents, { cents: true })} an hour` : formatCents(line.amountCents, { cents: true })}</span>
            </li>
          ))}
        </ul>
      </section>
      {version.rules.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Rate rules</h3>
          <ul className="flex flex-col gap-1.5">
            {version.rules.map((rule) => (
              <li key={rule.id} className="flex items-center justify-between gap-3 rounded-md bg-sunken px-3 py-2 text-sm">
                <span className="text-fg">{rule.text}</span>
                <span className="text-xs text-fg-muted">{ruled.filter((line) => line.ruleId === rule.id).length} variants</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {typed.length > 0 ? (
        <section>
          <h3 className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">Rates by variant</h3>
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {typed.map((line) => (
              <li key={line.id} className="flex items-center justify-between gap-3 rounded-md border border-border-subtle px-3 py-1.5 text-sm">
                <span className="truncate text-fg">{variantById.get(line.variantId ?? '')?.name ?? 'Variant'}</span>
                <span className="font-medium text-fg tabular-nums">{line.kind === 'per_unit' ? formatUnitPrice(line.unitPrice) : formatCents(line.amountCents, { cents: true })}</span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {version.note ? <p className="rounded-md bg-sunken px-3 py-2 text-sm whitespace-pre-wrap text-fg-secondary">{version.note}</p> : null}
    </div>
  );
}

function CompareView({ left, right }: { readonly left: CardVersionDTO; readonly right: CardVersionDTO }) {
  const { unit, variantById } = useCurrentProgram();
  const rows = compareVersions(left, right, unit, (id) => variantById.get(id)?.name ?? null);
  const tone = { same: '', changed: 'bg-warning-subtle/50', added: 'bg-success-subtle/60', removed: 'bg-danger-subtle/60' } as const;
  return (
    <div className="overflow-x-auto rounded-lg border border-border-subtle" data-testid="price-compare">
      <table className="w-full min-w-[460px] text-sm">
        <thead>
          <tr className="border-b border-border-subtle bg-sunken/60 text-left text-xs text-fg-muted">
            <th scope="col" className="px-3 py-2 font-medium">Line</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{versionName(left)}</th>
            <th scope="col" className="px-3 py-2 text-right font-medium">{versionName(right)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.slot} className={cn('border-b border-border-subtle last:border-b-0', tone[row.state])}>
              <td className="px-3 py-1.5 text-fg">
                {row.label}
                {row.state !== 'same' ? <span className="ml-2 text-2xs font-medium text-fg-secondary">{row.state === 'changed' ? 'Changed' : row.state === 'added' ? 'Added' : 'Removed'}</span> : null}
              </td>
              <td className="px-3 py-1.5 text-right text-fg-secondary tabular-nums">{row.left ?? <span className="text-fg-muted">None</span>}</td>
              <td className={cn('px-3 py-1.5 text-right tabular-nums', row.state === 'changed' ? 'font-semibold text-fg' : 'text-fg-secondary')}>{row.right ?? <span className="text-fg-muted">None</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Impact rail                                                                                    */
/* ---------------------------------------------------------------------------------------------- */

function DeltaRow({ label, before, after, deltaCents, deltaBp }: { readonly label: string; readonly before: string; readonly after: string; readonly deltaCents: string; readonly deltaBp: number | null }) {
  const value = BigInt(deltaCents);
  return (
    <div className="flex flex-col gap-0.5 py-2">
      <span className="text-xs text-fg-muted">{label}</span>
      <span className="flex flex-wrap items-baseline gap-x-1.5 text-sm tabular-nums">
        <span className="text-fg-secondary">{formatCents(before, { cents: true })}</span>
        <ArrowRight aria-hidden className="size-3 self-center text-icon" />
        <span className="font-semibold text-fg">{formatCents(after, { cents: true })}</span>
      </span>
      <span className={cn('text-xs font-medium tabular-nums', value > BigInt(0) ? 'text-success-text' : value < BigInt(0) ? 'text-danger-text' : 'text-fg-muted')}>{deltaText(deltaCents, deltaBp)}</span>
    </div>
  );
}

type MonthDelta = CardImpactDTO['thisMonth'];

/**
 * This month's forecast before and after the draft: the forecast from `/summary`, plus the change
 * so far, plus the planned units still to build from the start day (or today) to the month end at
 * the new rate minus the old rate. Builds with their own rate keep it.
 */
interface ForecastDelta {
  readonly month: MonthDelta;
  /** This month's forecast change per variant (so far plus still to build), keyed by variant id. */
  readonly byVariant: ReadonlyMap<string | null, bigint>;
}

function useForecastDelta(impact: CardImpactDTO | undefined, effectiveFrom: string): ForecastDelta | null {
  const { key, today, moneyHidden } = useCurrentProgram();
  const month = monthOf(today);
  const end = lastDayOfMonth(month);
  const from = effectiveFrom > today ? effectiveFrom : today;
  const summary = useProgramSummary(key, month, { enabled: !moneyHidden });
  const builds = useProgramBuilds(key, { from, to: end, limit: 500 }, { enabled: !moneyHidden && from <= end });
  return useMemo(() => {
    const base = summary.data?.forecast.forecastCents;
    if (!impact || base === null || base === undefined) return null;
    if (from <= end && !builds.data) return null;
    const prices = new Map(impact.byVariant.map((row) => [row.variantId, row]));
    const byVariant = new Map<string | null, bigint>(impact.byVariant.map((row) => [row.variantId, BigInt(row.deltaCents)]));
    let change = BigInt(impact.thisMonth.deltaCents);
    for (const build of from <= end ? (builds.data?.items ?? []) : []) {
      const block = build.build;
      if (block.rateOverride || block.closedShort || build.statusCategory === 'cancelled' || block.buildDate < from || block.buildDate > end) continue;
      const row = prices.get(block.variantId);
      if (!row || row.beforePrice === row.afterPrice) continue;
      const remaining = Number(block.remainingQty) > 0 ? block.remainingQty : '0';
      const delta = mulQuantityPrice(remaining, row.afterPrice ?? '0') - mulQuantityPrice(remaining, row.beforePrice ?? '0');
      change += delta;
      byVariant.set(row.variantId, (byVariant.get(row.variantId) ?? BigInt(0)) + delta);
    }
    const before = BigInt(base);
    const after = before + change;
    return { month: { beforeCents: before.toString(), afterCents: after.toString(), deltaCents: change.toString(), deltaBp: changeBp(after, before) }, byVariant };
  }, [impact, summary.data, builds.data, from, end]);
}

const signedCents = (value: bigint) => (value === BigInt(0) ? formatCents('0', { cents: true }) : `${value > BigInt(0) ? '+' : '-'}${formatCents((value < BigInt(0) ? -value : value).toString(), { cents: true })}`);
const deltaTone = (value: bigint) => (value > BigInt(0) ? 'text-success-text' : value < BigInt(0) ? 'text-danger-text' : 'text-fg-muted');

/**
 * By variant: the rate change and this month's forecast change per variant (output so far plus
 * planned units still to build at the new rate minus the old one), so the rows add up to the
 * "This month forecast" change above. Before the forecast loads it shows the change so far.
 */
function VariantImpactTable({ impact, forecast }: { readonly impact: CardImpactDTO; readonly forecast: ForecastDelta | null }) {
  const rows = impact.byVariant.filter((row) => row.deltaCents !== '0' || row.beforePrice !== row.afterPrice || (forecast?.byVariant.get(row.variantId) ?? BigInt(0)) !== BigInt(0));
  const valueOf = (row: CardImpactDTO['byVariant'][number]) => (forecast ? (forecast.byVariant.get(row.variantId) ?? BigInt(0)) : BigInt(row.deltaCents));
  const total = rows.reduce((sum, row) => sum + valueOf(row), BigInt(0));
  return (
    <table className="mt-1 w-full text-xs" data-testid="impact-by-variant">
      <thead>
        <tr className="text-left text-fg-muted">
          <th scope="col" className="py-1 pr-2 font-medium">Variant</th>
          <th scope="col" className="py-1 pr-2 text-right font-medium">Rate</th>
          <th scope="col" className="py-1 text-right font-medium">{forecast ? 'Forecast change' : 'Change so far'}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => (
          <tr key={row.variantId ?? row.name} className="border-t border-border-subtle">
            <td className="max-w-[110px] truncate py-1 pr-2 text-fg" title={row.name}>{row.name}</td>
            <td className="py-1 pr-2 text-right whitespace-nowrap text-fg-secondary tabular-nums">
              {formatUnitPrice(row.beforePrice)} to {formatUnitPrice(row.afterPrice)}
            </td>
            <td className={cn('py-1 text-right tabular-nums', deltaTone(valueOf(row)))} data-testid="impact-variant-change">{signedCents(valueOf(row))}</td>
          </tr>
        ))}
      </tbody>
      {rows.length > 1 ? (
        <tfoot>
          <tr className="border-t border-border-default font-medium">
            <td className="py-1 text-fg" colSpan={2}>{forecast ? 'This month forecast' : 'So far this month'}</td>
            <td className={cn('py-1 text-right tabular-nums', deltaTone(total))} data-testid="impact-variant-total">{signedCents(total)}</td>
          </tr>
        </tfoot>
      ) : null}
    </table>
  );
}

function ImpactRail({ impact, forecast, loading, children }: { readonly impact: CardImpactDTO | undefined; readonly forecast: ForecastDelta | null; readonly loading: boolean; readonly children?: React.ReactNode }) {
  const { variantById, program } = useCurrentProgram();
  const lockedNote = impact?.lockedDays && !(program.startDate && impact.lockedDays.through < program.startDate) ? impact.lockedDays : null;
  return (
    <aside className="flex flex-col gap-3 lg:sticky lg:top-4" aria-label="Impact" data-testid="impact-rail">
      <section className="rounded-xl border border-border-subtle bg-panel shadow-xs">
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <h2 className="text-sm font-semibold text-fg">Impact</h2>
          {loading ? <span className="text-2xs text-fg-muted">Updating</span> : null}
        </header>
        {!impact ? (
          <div className="flex flex-col gap-2 p-4">
            <Skeleton height={48} />
            <Skeleton height={48} />
          </div>
        ) : (
          <div className="flex flex-col px-4 pb-3">
            <div className="divide-y divide-border-subtle">
              <DeltaRow label="So far this month" before={impact.thisMonth.beforeCents} after={impact.thisMonth.afterCents} deltaCents={impact.thisMonth.deltaCents} deltaBp={impact.thisMonth.deltaBp} />
              {forecast ? <DeltaRow label="This month forecast" before={forecast.month.beforeCents} after={forecast.month.afterCents} deltaCents={forecast.month.deltaCents} deltaBp={forecast.month.deltaBp} /> : null}
              <DeltaRow label="Next month forecast" before={impact.nextMonth.beforeCents} after={impact.nextMonth.afterCents} deltaCents={impact.nextMonth.deltaCents} deltaBp={impact.nextMonth.deltaBp} />
              <div className="flex flex-col gap-0.5 py-2">
                <span className="text-xs text-fg-muted">Minimum gap</span>
                <span className="text-sm text-fg tabular-nums">
                  {formatCents(impact.minimum.gapBefore, { cents: true })} <ArrowRight aria-hidden className="inline size-3 text-icon" /> <span className="font-semibold">{formatCents(impact.minimum.gapAfter, { cents: true })}</span>
                </span>
              </div>
            </div>
            {impact.byVariant.some((row) => row.deltaCents !== '0' || row.beforePrice !== row.afterPrice) ? (
              <VariantImpactTable impact={impact} forecast={forecast} />
            ) : null}
            {impact.rules.length ? (
              <ul className="mt-2 flex flex-col gap-1 border-t border-border-subtle pt-2 text-xs text-fg-secondary">
                {impact.rules.map((rule) => (
                  <li key={rule.ruleId}>
                    {/variant/.test(rule.text) ? rule.text : `${rule.text} · ${rule.variants === 1 ? '1 variant' : `${rule.variants} variants`}`}
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="mt-2 flex flex-col gap-1 border-t border-border-subtle pt-2 text-xs">
              <span className="text-fg-secondary">{impact.openDays ? `Updates prices on ${impact.openDays.count} open ${impact.openDays.count === 1 ? 'day' : 'days'} from ${shortDate(impact.openDays.from)}.` : 'No days with output change yet.'}</span>
              {lockedNote ? (
                <span className="inline-flex items-center gap-1 text-fg-muted">
                  <Lock aria-hidden className="size-3" />
                  Days through {shortDate(lockedNote.through)} are closed{lockedNote.reason === 'pulse' ? ' in Pulse' : ''} and keep their old price.
                </span>
              ) : null}
            </div>
            {impact.conflicts.length || impact.warnings.length ? (
              <ul className="mt-2 flex flex-col gap-1 border-t border-border-subtle pt-2 text-xs text-warning-text" data-testid="impact-warnings">
                {impact.conflicts.map((conflict) => (
                  <li key={conflict.variantId} className="flex gap-1.5">
                    <AlertTriangle aria-hidden className="mt-px size-3 shrink-0" />
                    {variantById.get(conflict.variantId)?.name ? `${variantById.get(conflict.variantId)?.name}: ` : ''}
                    {conflict.text}
                  </li>
                ))}
                {impact.warnings.map((warning) => (
                  <li key={warning} className="flex gap-1.5">
                    <AlertTriangle aria-hidden className="mt-px size-3 shrink-0" />
                    {WARNING_TEXT[warning] ?? warning}
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        )}
      </section>
      {children}
    </aside>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Draft editor                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

function DraftEditor({ version, onDone }: { readonly version: CardVersionDTO; readonly onDone: (id: string | null) => void }) {
  const { key, unit, variants, activeVariants, program, capabilities, today } = useCurrentProgram();
  const queryClient = useQueryClient();
  const attributes = useAttributes(key);
  const keyById = useMemo(() => new Map(variants.map((variant) => [variant.id, variant.key])), [variants]);
  const hourlyAll = program.settings.hourlyTimeBasis === 'all';
  const [value, setValue] = useState<PriceLinesValue>(() => fromCardLines(version.lines, keyById, hourlyAll));
  const [rules, setRules] = useState<EditorRule[]>(() => toEditorRules(version.rules));
  const [effectiveFrom, setEffectiveFrom] = useState(version.effectiveFrom);
  const [label, setLabel] = useState(version.label ?? '');
  const [note, setNote] = useState(version.note ?? '');
  const [publishing, setPublishing] = useState(false);
  const [sendingBack, setSendingBack] = useState(false);
  const [backNote, setBackNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const axes = useMemo(() => toEditorAxes(attributes.data ?? []), [attributes.data]);
  const lines = useMemo(() => toLinePayload(value, variants), [value, variants]);
  const rulePayload = useMemo(() => toRulePayload(rules), [rules]);
  const problems = priceLinesProblems(value);
  const minStart = firstStartDay(today, program.locks.lockedThrough, capabilities.canPrice);
  const dateProblem = effectiveFrom < minStart ? (capabilities.canPrice ? `That day is closed. Start on ${shortDate(minStart)} or later.` : `Start today or later. Owners can start a version on an earlier open day.`) : null;
  const preview = useCardPreview(key, { versionId: version.id, effectiveFrom, lines, rules: rulePayload });
  const impact = preview.data;
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.program(key) });
  };
  const persist = async (): Promise<CardVersionDTO> => {
    if (capabilities.canEdit && value.perHour.on && value.perHour.countAllTime !== hourlyAll) {
      await unwrap(updateProgramSettingsAction({ key, expectedVersion: program.settings.version, patch: { hourlyTimeBasis: value.perHour.countAllTime ? 'all' : 'billable' } }));
    }
    return unwrap(updateDraftVersionAction({ versionId: version.id, expectedVersion: version.version, effectiveFrom, label: label.trim() || null, note: note.trim() || null, lines, rules: rulePayload }));
  };
  const run = async (step: () => Promise<void>) => {
    setBusy(true);
    try {
      await step();
    } catch (error) {
      toast.error("Couldn't save the price card", error instanceof Error ? error.message : 'Try again.');
      await refresh();
    } finally {
      setBusy(false);
    }
  };
  const saveDraft = () =>
    run(async () => {
      await persist();
      toast.success('Draft saved.');
      await refresh();
    });
  const publish = () =>
    run(async () => {
      const saved = await persist();
      const published = await unwrap(publishVersionAction({ versionId: saved.id, expectedVersion: saved.version }));
      setPublishing(false);
      toast.success(`v${published.number} is published.`, effectiveFrom <= today ? `It is in force now.${published.repricedRows > 0 ? ` Prices on ${published.repricedRows} open output ${published.repricedRows === 1 ? 'row' : 'rows'} were updated.` : ''}` : `It starts ${shortDate(effectiveFrom)}.`);
      await refresh();
      onDone(saved.id);
    });
  const askReview = () =>
    run(async () => {
      await persist();
      await unwrap(requestReviewAction({ versionId: version.id }));
      toast.success('Sent for review. Owners can publish it or send it back.');
      await refresh();
    });
  const sendBack = useServerAction(sendBackAction, {
    successMessage: 'Sent back with your note.',
    errorTitle: "Couldn't send it back",
    onSuccess: async () => {
      setSendingBack(false);
      setBackNote('');
      await refresh();
    },
  });
  const discard = useServerAction(deleteVersionAction, {
    successMessage: 'Draft discarded.',
    errorTitle: "Couldn't discard the draft",
    onSuccess: async () => {
      setDiscarding(false);
      await refresh();
      onDone(null);
    },
  });
  const valid = Object.keys(problems).length === 0 && !dateProblem;
  const pastOpen = impact?.openDays && effectiveFrom < today ? impact.openDays : null;
  const variantRows = activeVariants.map((variant) => ({ key: variant.key, name: variant.name, color: variant.color, hint: variant.currentRate?.ruleText ?? null }));
  // Keyed by the editor's own rule ids: count the active variants each rule's attribute value matches.
  const ruleUse = useMemo(() => new Map(rules.map((rule) => [rule.id, activeVariants.filter((variant) => variant.attributes[rule.attributeId] === rule.valueId).length])), [rules, activeVariants]);
  const forecast = useForecastDelta(impact, effectiveFrom);
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
      <div className="flex min-w-0 flex-col gap-4">
        {version.reviewStatus === 'sent_back' && version.reviewNote ? (
          <div className="flex gap-2 rounded-lg border border-danger/30 bg-danger-subtle/50 px-3 py-2.5 text-sm">
            <Undo2 aria-hidden className="mt-0.5 size-4 shrink-0 text-danger-text" />
            <span className="text-fg">
              <span className="font-medium">Sent back:</span> {version.reviewNote}
            </span>
          </div>
        ) : null}
        {version.reviewStatus === 'waiting' ? (
          <div className="flex gap-2 rounded-lg border border-warning/40 bg-warning-subtle/50 px-3 py-2.5 text-sm text-fg">
            <Send aria-hidden className="mt-0.5 size-4 shrink-0 text-warning-text" />
            {capabilities.canPrice ? 'This draft waits for your review. Publish it, or send it back with a note.' : 'This draft waits for an owner to review it.'}
          </div>
        ) : null}
        <Panel title="Version" bodyClassName="grid gap-4 sm:grid-cols-[180px_minmax(0,1fr)]">
          <Field label="Starts" required error={dateProblem} hint={pastOpen ? `Publishing updates prices on open days from ${shortDate(pastOpen.from)}.` : 'Days before this keep the old prices.'}>
            {({ inputId }) => <IsoDatePicker id={inputId} value={effectiveFrom} onChange={(next) => next && setEffectiveFrom(next)} disabled={!capabilities.canPropose} />}
          </Field>
          <Field label="Label" hint="Shown in the versions list.">
            {({ inputId }) => <Input id={inputId} value={label} onChange={(event) => setLabel(event.target.value)} maxLength={80} placeholder="2027 rates" disabled={!capabilities.canPropose} />}
          </Field>
          <Field label="Note" className="sm:col-span-2" hint="Why the rates change. Reviewers and Activity show it.">
            {({ inputId }) => <Textarea id={inputId} value={note} onChange={(event) => setNote(event.target.value)} rows={2} maxLength={2000} disabled={!capabilities.canPropose} />}
          </Field>
        </Panel>
        <Panel title="Lines">
          <PriceLinesEditor value={value} onChange={setValue} unit={unit} variants={variantRows} errors={problems} disabled={!capabilities.canPropose} />
        </Panel>
        {axes.length > 0 ? (
          <Panel title="Rate rules" action={<span className="text-xs text-fg-muted">Copying a version keeps its rules</span>}>
            <RateRulesEditor axes={axes} rules={rules} onChange={setRules} ruleUse={ruleUse} conflicts={(impact?.conflicts ?? []).map((conflict) => conflict.text)} disabled={!capabilities.canPropose} />
          </Panel>
        ) : null}
        <p className="flex flex-wrap items-center gap-1 text-xs text-fg-muted">
          Setup fees and adjustments are not part of a version.
          <a href={statementHref(key, effectiveFrom.slice(0, 7) > today.slice(0, 7) ? today.slice(0, 7) : effectiveFrom.slice(0, 7))} className="font-medium text-fg-link hover:underline">
            One time charges are on the Statement
          </a>
        </p>
      </div>
      <ImpactRail impact={impact} forecast={forecast} loading={preview.isFetching}>
        <div className="flex flex-col gap-2 rounded-xl border border-border-subtle bg-panel p-3 shadow-xs">
          {capabilities.canPrice ? (
            <Button onClick={() => setPublishing(true)} disabled={!valid || busy} data-testid="publish-version">
              Publish {version.number ? `v${version.number}` : 'this version'}
            </Button>
          ) : capabilities.canPropose && version.reviewStatus !== 'waiting' ? (
            <Button onClick={() => void askReview()} disabled={!valid || busy} loading={busy}>
              Ask for review
            </Button>
          ) : null}
          {capabilities.canPrice && version.reviewStatus === 'waiting' ? (
            <Button variant="secondary" onClick={() => setSendingBack(true)}>
              <Undo2 aria-hidden />
              Send back
            </Button>
          ) : null}
          {capabilities.canPropose ? (
            <Button variant="secondary" onClick={() => void saveDraft()} disabled={!valid || busy} loading={busy && !publishing} data-testid="save-draft">
              Save draft
            </Button>
          ) : null}
          {capabilities.canPropose ? (
            <Button variant="danger-ghost" onClick={() => setDiscarding(true)}>
              Discard draft
            </Button>
          ) : null}
          {!valid ? <p className="text-xs text-danger-text">{dateProblem ?? 'Fix the lines marked in red first.'}</p> : null}
        </div>
      </ImpactRail>
      <ConfirmDialog
        open={publishing}
        onOpenChange={setPublishing}
        title={`Publish ${version.number ? `v${version.number}` : 'this version'}?`}
        description={
          impact ? (
            <span className="flex flex-col gap-1.5">
              <span>
                Starts {shortDate(effectiveFrom)}. So far this month {formatCents(impact.thisMonth.beforeCents, { cents: true })} to {formatCents(impact.thisMonth.afterCents, { cents: true })} ({deltaText(impact.thisMonth.deltaCents, impact.thisMonth.deltaBp)}).{forecast ? ` This month forecast ${formatCents(forecast.month.beforeCents, { cents: true })} to ${formatCents(forecast.month.afterCents, { cents: true })} (${deltaText(forecast.month.deltaCents, forecast.month.deltaBp)}).` : ''} Next month {formatCents(impact.nextMonth.beforeCents, { cents: true })} to {formatCents(impact.nextMonth.afterCents, { cents: true })}.
              </span>
              {pastOpen ? <span>This updates prices on {pastOpen.count} open {pastOpen.count === 1 ? 'day' : 'days'} from {shortDate(pastOpen.from)}.</span> : null}
              <span>A published version never changes. To change it later, make a new version.</span>
            </span>
          ) : (
            'A published version never changes. To change it later, make a new version.'
          )
        }
        confirmLabel={`Publish ${version.number ? `v${version.number}` : ''}`.trim()}
        loading={busy}
        onConfirm={() => void publish()}
      />
      <ConfirmDialog open={discarding} onOpenChange={setDiscarding} title="Discard this draft?" description="Its lines and rules are deleted. Published versions are not touched." confirmLabel="Discard" destructive loading={discard.pending} onConfirm={() => void discard.run({ versionId: version.id })} />
      <Dialog open={sendingBack} onOpenChange={setSendingBack}>
        <DialogContent size="sm">
          <DialogHeader title="Send back with a note" description="The person who asked for review sees your note on the draft." />
          <DialogBody>
            <Field label="Note" required>
              {({ inputId }) => <Textarea id={inputId} autoFocus value={backNote} onChange={(event) => setBackNote(event.target.value)} rows={3} maxLength={2000} placeholder="XL should stay at $2.20 until January." />}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setSendingBack(false)}>
              Cancel
            </Button>
            <Button disabled={!backNote.trim()} loading={sendBack.pending} onClick={() => void sendBack.run({ versionId: version.id, note: backNote.trim() })}>
              Send back
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Other prices                                                                                   */
/* ---------------------------------------------------------------------------------------------- */

function OtherPrices() {
  const { key, program } = useCurrentProgram();
  const [open, setOpen] = useState(false);
  const prices = useOtherPrices(key, { enabled: open });
  const card = prices.data?.cardUnitPrice ?? null;
  return (
    <details className="group rounded-xl border border-border-subtle bg-panel shadow-xs" onToggle={(event) => setOpen((event.target as HTMLDetailsElement).open)} data-testid="other-prices">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3 text-sm font-semibold text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
        Other prices for {program.customer?.name ?? 'this customer'}
        <ChevronDown aria-hidden className="size-4 text-icon transition-transform group-open:rotate-180" />
      </summary>
      <div className="border-t border-border-subtle px-4 py-3 text-sm">
        {prices.isLoading ? (
          <Skeleton height={60} />
        ) : prices.isError ? (
          <p className="text-fg-muted">Prices from other apps are not available right now.</p>
        ) : (
          <div className="flex flex-col gap-4">
            <p className="text-xs text-fg-muted">Read only. These are set in Pulse and WMS. Nothing here changes from Projects.</p>
            <section>
              <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">Pulse jobs</h3>
              {(prices.data?.pulse ?? []).length === 0 ? <p className="text-fg-muted">No ongoing Pulse jobs for this customer.</p> : null}
              <ul className="flex flex-col gap-1">
                {(prices.data?.pulse ?? []).map((job) => (
                  <li key={job.jobId} className="flex flex-wrap items-center justify-between gap-2">
                    <span className="min-w-0 truncate text-fg">
                      <span className="font-key text-xs text-fg-secondary">{job.number}</span> {job.name}
                    </span>
                    <span className="flex items-center gap-2">
                      <span className="tabular-nums">{formatUnitPrice(job.unitPrice)}</span>
                      {job.mismatch && card ? <Badge tone="warning">{`Pulse bills ${formatUnitPrice(job.unitPrice)}, card says ${formatUnitPrice(card)}`}</Badge> : <Badge tone="success">Matches the card</Badge>}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
            {prices.data?.wms.available ? (
              <section>
                <h3 className="mb-1.5 text-xs font-semibold tracking-wide text-fg-muted uppercase">WMS billing fees</h3>
                <ul className="flex flex-col gap-1">
                  {(prices.data.wms.fees ?? []).map((fee) => {
                    const rate = fee.standardRate === null ? null : fee.standardRate.toFixed(4);
                    const mismatch = Boolean(card && rate && rate !== card);
                    return (
                      <li key={fee.id} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="min-w-0 truncate text-fg">{fee.name}</span>
                        <span className="flex items-center gap-2">
                          <span className="tabular-nums">{formatUnitPrice(rate)}</span>
                          {mismatch ? <Badge tone="warning">{`WMS bills ${formatUnitPrice(rate)}, card says ${formatUnitPrice(card)}`}</Badge> : null}
                        </span>
                      </li>
                    );
                  })}
                  {(prices.data.wms.fees ?? []).length === 0 ? <li className="text-fg-muted">No kitting or VAS fees on the active contract.</li> : null}
                </ul>
              </section>
            ) : null}
          </div>
        )}
      </div>
    </details>
  );
}

/* ---------------------------------------------------------------------------------------------- */
/* Tab                                                                                            */
/* ---------------------------------------------------------------------------------------------- */

function NewVersionDialog({ from, onOpenChange, onCreated }: { readonly from: 'current' | 'empty' | string; readonly onOpenChange: (open: boolean) => void; readonly onCreated: (version: CardVersionDTO) => void }) {
  const { key, program, today, capabilities } = useCurrentProgram();
  const minStart = firstStartDay(today, program.locks.lockedThrough, capabilities.canPrice);
  const [date, setDate] = useState(() => {
    const next = program.calendar.nextWorkDay > today ? program.calendar.nextWorkDay : addDays(today, 1);
    return next < minStart ? minStart : next;
  });
  const create = useServerAction(createDraftVersionAction, { errorTitle: "Couldn't start the version", successMessage: 'Draft started. Change the rates, then publish.', onSuccess: (version) => onCreated(version) });
  return (
    <Dialog open onOpenChange={onOpenChange}>
      <DialogContent size="sm" data-testid="new-version-dialog">
        <DialogHeader
          icon={
            <span className="flex size-9 items-center justify-center rounded-lg bg-sunken text-icon">
              <CalendarClock aria-hidden className="size-4" />
            </span>
          }
          title={from === 'empty' ? 'Start an empty version' : from === 'current' ? 'New version from the current rates' : 'Duplicate as a draft'}
          description="A version is dated. Days before it starts keep their old prices."
        />
        <DialogBody>
          <Field label="Starts" required error={date < minStart ? `Pick ${shortDate(minStart)} or later.` : null}>
            {({ inputId }) => <IsoDatePicker id={inputId} value={date} onChange={(next) => next && setDate(next)} />}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button loading={create.pending} disabled={date < minStart} onClick={() => void create.run({ key, from, effectiveFrom: date })} data-testid="new-version-create">
            Start draft
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PriceCardTab({ initialVersions }: { readonly initialVersions: readonly CardVersionDTO[] }) {
  const { key, moneyHidden, capabilities } = useCurrentProgram();
  const router = useRouter();
  const pathname = usePathname() ?? '';
  const params = useSearchParams();
  const queryClient = useQueryClient();
  const card = usePriceCard(key, { initialData: [...initialVersions] });
  const versions = useMemo(() => card.data ?? [], [card.data]);
  const requested = params?.get('version');
  const [selected, setSelected] = useState<string | null>(() => defaultVersionId(initialVersions, requested));
  const [compareWith, setCompareWith] = useState<string>('none');
  const [creating, setCreating] = useState<'current' | 'empty' | string | null>(() => (params?.get('new') === '1' && capabilities.canPropose ? (initialVersions.some((version) => version.state === 'in_force') ? 'current' : 'empty') : null));
  const [deleting, setDeleting] = useState<CardVersionDTO | null>(null);
  const [seenRequested, setSeenRequested] = useState(requested);
  if (requested !== seenRequested) {
    setSeenRequested(requested);
    if (requested && versions.some((version) => version.id === requested)) setSelected(requested);
  }
  const current = versions.find((version) => version.id === selected) ?? versions.find((version) => version.id === defaultVersionId(versions, null)) ?? null;
  const select = (id: string | null) => {
    setSelected(id);
    setCompareWith('none');
    const next = new URLSearchParams(params?.toString() ?? '');
    next.delete('new');
    if (id) next.set('version', id);
    else next.delete('version');
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  };
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: qk.program(key) });
  };
  const unpublish = useServerAction(unpublishVersionAction, { successMessage: 'Moved back to a draft. Publish it again when it is ready.', errorTitle: "Couldn't move it back to a draft", onSuccess: refresh });
  const remove = useServerAction(deleteVersionAction, {
    successMessage: 'Version deleted.',
    errorTitle: "Couldn't delete the version",
    onSuccess: async () => {
      setDeleting(null);
      await refresh();
      select(null);
    },
  });
  if (moneyHidden) {
    return (
      <div className="mx-auto w-full max-w-[880px] px-4 py-10 sm:px-6">
        <EmptyState visual={<EyeOff aria-hidden className="size-10 text-icon" />} title="Money is hidden for your role." description="Prices and charges show only for people the program owner allows. You still see units on every page." />
      </div>
    );
  }
  const onAction = (action: 'duplicate' | 'edit' | 'delete', version: CardVersionDTO) => {
    if (action === 'duplicate') setCreating(version.id);
    if (action === 'edit') void unpublish.run({ versionId: version.id });
    if (action === 'delete') setDeleting(version);
  };
  const others = versions.filter((version) => version.id !== current?.id);
  const compare = compareWith !== 'none' ? versions.find((version) => version.id === compareWith) : undefined;
  return (
    <div className="mx-auto grid w-full max-w-[1440px] gap-5 px-4 py-4 sm:px-6 sm:py-5 lg:grid-cols-[260px_minmax(0,1fr)]" data-testid="price-card-tab">
      {versions.length === 0 ? (
        <div className="lg:col-span-2">
          <EmptyState
            visual={<Receipt aria-hidden className="size-10 text-icon" />}
            title="No price card yet"
            description="A price card sets what this program earns: a rate per unit, batch or hour, a monthly fee and a minimum. Output earns nothing until one is in force."
            actions={capabilities.canPropose ? <Button onClick={() => setCreating('empty')}>Add a price card</Button> : null}
          />
        </div>
      ) : (
        <>
          <VersionsRail versions={versions} selectedId={current?.id ?? null} onSelect={select} onNew={(from) => setCreating(from)} onAction={onAction} />
          <section aria-label="Selected version" className="flex min-w-0 flex-col gap-4">
            {current ? (
              <>
                <header className="flex flex-wrap items-center gap-2">
                  <h2 className="text-lg font-semibold text-fg">
                    {versionName(current)}
                    {current.label ? <span className="font-normal text-fg-secondary"> · {current.label}</span> : null}
                  </h2>
                  <Badge tone={STATE_TONE[current.state]}>{current.status === 'draft' ? `Would start ${shortDate(current.effectiveFrom)}` : stateText(current)}</Badge>
                  {current.publishedBy ? <PersonAvatar userId={current.publishedBy} size="xs" /> : null}
                  {others.length ? (
                    <span className="ml-auto flex items-center gap-2">
                      <GitCompare aria-hidden className="size-4 text-icon" />
                      <Select aria-label="Compare with" size="sm" value={compareWith} onValueChange={setCompareWith} options={[{ value: 'none', label: 'Compare with' }, ...others.map((version) => ({ value: version.id, label: `${versionName(version)} · ${stateText(version)}` }))]} className="w-48" />
                    </span>
                  ) : null}
                </header>
                {compare ? (
                  <CompareView left={compare} right={current} />
                ) : current.status === 'draft' ? (
                  <DraftEditor key={`${current.id}:${current.version}`} version={current} onDone={select} />
                ) : (
                  <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_300px]">
                    <div className="flex min-w-0 flex-col gap-4">
                      {current.state === 'scheduled' ? (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-info/30 bg-info-subtle/50 px-3 py-2.5 text-sm max-sm:flex-col max-sm:items-start">
                          <CalendarClock aria-hidden className="size-4 text-info-text" />
                          <span className="min-w-0 flex-1 text-fg">This version starts {shortDate(current.effectiveFrom)}. Edit it to make changes, then publish it again.</span>
                          {capabilities.canPrice ? (
                            <Button size="sm" variant="secondary" loading={unpublish.pending} onClick={() => void unpublish.run({ versionId: current.id })}>
                              <Pencil aria-hidden />
                              Edit
                            </Button>
                          ) : null}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border-subtle bg-sunken px-3 py-2.5 text-sm max-sm:flex-col max-sm:items-start">
                          <Lock aria-hidden className="size-4 text-icon" />
                          <span className="min-w-0 flex-1 text-fg">{current.state === 'in_force' ? 'This version is in force, so it does not change. Make a new version to change rates.' : 'This version has ended, so it does not change. Make a new version to change rates.'}</span>
                          {capabilities.canPropose ? (
                            <Button size="sm" variant="secondary" onClick={() => setCreating(current.id)}>
                              <Copy aria-hidden />
                              Copy into a new version
                            </Button>
                          ) : null}
                        </div>
                      )}
                      <Panel title="Lines and rules">
                        <VersionLines version={current} />
                      </Panel>
                    </div>
                    <aside className="flex flex-col gap-3">
                      <section className="rounded-xl border border-border-subtle bg-panel p-4 text-sm shadow-xs">
                        <h3 className="mb-2 text-sm font-semibold text-fg">About this version</h3>
                        <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1.5">
                          <dt className="text-fg-muted">Starts</dt>
                          <dd className="text-fg">{shortDate(current.effectiveFrom)}</dd>
                          <dt className="text-fg-muted">Lines</dt>
                          <dd className="text-fg">{current.lines.filter((line) => line.ruleId === null).length}</dd>
                          <dt className="text-fg-muted">Rules</dt>
                          <dd className="text-fg">{current.rules.length}</dd>
                          {current.publishedAt ? (
                            <>
                              <dt className="text-fg-muted">Published</dt>
                              <dd className="text-fg">{shortDate(current.publishedAt.slice(0, 10))}</dd>
                            </>
                          ) : null}
                        </dl>
                        {current.summary ? <p className="mt-3 border-t border-border-subtle pt-3 text-xs text-fg-secondary">{current.summary}</p> : null}
                      </section>
                    </aside>
                  </div>
                )}
              </>
            ) : null}
            <OtherPrices />
          </section>
        </>
      )}
      {creating ? (
        <NewVersionDialog
          from={creating}
          onOpenChange={(open) => (open ? null : setCreating(null))}
          onCreated={async (version) => {
            setCreating(null);
            await refresh();
            select(version.id);
          }}
        />
      ) : null}
      <ConfirmDialog
        open={deleting !== null}
        onOpenChange={(open) => (open ? null : setDeleting(null))}
        title={deleting ? `Delete ${versionName(deleting)}?` : 'Delete this version?'}
        description={deleting?.state === 'scheduled' ? 'It has not started, so no day uses it. The version in force stays.' : 'Its lines and rules are deleted.'}
        confirmLabel="Delete"
        destructive
        loading={remove.pending}
        onConfirm={() => deleting && void remove.run({ versionId: deleting.id })}
      />
    </div>
  );
}

