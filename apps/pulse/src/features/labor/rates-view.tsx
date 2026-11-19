'use client';
/**
 * Labor, Rates: labor classes and the real cost of an hour. The builder takes a wage, the three
 * percents on top of it and overhead for each hour, shows the answer as you type and what the
 * change does to logged work before it is saved. Rates start on a day, so history stays put.
 */
import { useMemo, useState } from 'react';
import {
  Archive,
  ArchiveRestore,
  CalendarClock,
  HandCoins,
  Lightbulb,
  Pencil,
  Plus,
  RefreshCw,
  Star,
  Trash2,
  Users,
} from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
  Field,
  IconButton,
  Input,
  IsoDatePicker,
  Select,
  Skeleton,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { formatMoney, formatMoneyPerHour, formatPercentBp } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { useCompanyBridge, useLaborClasses, useLaborRates } from '@/lib/hooks/use-data';
import { useDebouncedValue } from '@/lib/hooks/use-debounced-value';
import { centsToDecimal, centsToNumber, decimalToCents } from '@/lib/money';
import {
  addMonths,
  endOfMonth,
  loadedRate,
  overheadCovered,
  rateBreakdown,
  shortDate,
  startOfMonth,
  suggestOverheadPerHour,
  type LoadedRate,
} from '@/lib/profit';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { LaborClassDTO, LaborRateDTO, RateChangePreviewDTO, SettingsDTO, SiteDTO } from '@/lib/types';
import {
  createLaborClassAction,
  createLaborRateAction,
  deleteLaborClassAction,
  deleteLaborRateAction,
  previewLaborRateAction,
  updateLaborClassAction,
  updateLaborRateAction,
} from '@/server/actions/labor';

const INVALIDATE = [
  qk.laborClasses(),
  qk.laborRates(),
  qk.streams(),
  qk.jobsRoot(),
  qk.profitRoot(),
  qk.summaryRoot(),
  qk.badges(),
] as const;

interface RateForm {
  rateId: string | null;
  version: number | null;
  effectiveFrom: string;
  siteId: string;
  wage: string;
  tax: string;
  benefits: string;
  other: string;
  overhead: string;
  multiplier: string;
  note: string;
}

const percentText = (bp: number | null | undefined): string =>
  bp === null || bp === undefined ? '' : String(bp / 100);
const dollars = (cents: number | null | undefined): string =>
  cents === null || cents === undefined ? '' : centsToDecimal(cents);

function parseMoney(text: string): number | null {
  const cleaned = text.replace(/[$,\s]/g, '');
  if (cleaned === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  return Number(decimalToCents(cleaned));
}

function parsePercent(text: string): number | null {
  const cleaned = text.replace(/[%\s]/g, '');
  if (cleaned === '') return 0;
  if (!/^\d+(\.\d{1,2})?$/.test(cleaned)) return null;
  const bp = Math.round(Number(cleaned) * 100);
  return bp <= 100_000 ? bp : null;
}

interface Parsed {
  readonly wageCents: number;
  readonly payrollTaxBp: number;
  readonly benefitsBp: number;
  readonly otherBurdenBp: number;
  readonly overheadPerHourCents: number;
  readonly overtimeMultiplier: string;
}

function parseForm(
  form: RateForm,
): { ok: true; value: Parsed; rate: LoadedRate } | { ok: false; message: string; field: string } {
  const wage = parseMoney(form.wage);
  if (wage === null || wage <= 0)
    return { ok: false, field: 'wage', message: 'Type the hourly wage in dollars, like 16.00.' };
  const tax = parsePercent(form.tax);
  if (tax === null) return { ok: false, field: 'tax', message: 'Payroll taxes must be a percent, like 9.' };
  const benefits = parsePercent(form.benefits);
  if (benefits === null)
    return { ok: false, field: 'benefits', message: 'Benefits must be a percent, like 12.' };
  const other = parsePercent(form.other);
  if (other === null) return { ok: false, field: 'other', message: 'Other must be a percent, like 2.' };
  const overhead = parseMoney(form.overhead);
  if (overhead === null)
    return { ok: false, field: 'overhead', message: 'Type overhead for each hour in dollars, like 2.40.' };
  const mult = form.multiplier.trim() === '' ? '1.5' : form.multiplier.trim();
  if (!/^\d(\.\d{1,2})?$/.test(mult) || Number(mult) < 1 || Number(mult) > 5)
    return {
      ok: false,
      field: 'multiplier',
      message: 'The overtime multiplier is a number from 1 to 5, like 1.5.',
    };
  const value = {
    wageCents: wage,
    payrollTaxBp: tax,
    benefitsBp: benefits,
    otherBurdenBp: other,
    overheadPerHourCents: overhead,
    overtimeMultiplier: mult,
  };
  return { ok: true, value, rate: loadedRate(value) };
}

export function RatesView({
  initialClasses,
  initialRates,
  sites,
  settings,
  today,
}: {
  readonly initialClasses: LaborClassDTO[];
  readonly initialRates: LaborRateDTO[];
  readonly sites: readonly SiteDTO[];
  readonly settings: SettingsDTO;
  readonly today: string;
}) {
  const classes = useLaborClasses({ includeArchived: true }, { initialData: initialClasses });
  const rates = useLaborRates({}, { initialData: initialRates });
  const [selected, setSelected] = useState<string | null>(
    initialClasses.find((item) => item.isDefault)?.id ?? initialClasses[0]?.id ?? null,
  );
  const [classDialog, setClassDialog] = useState<{
    id: string | null;
    name: string;
    kind: 'employee' | 'temp_agency';
  } | null>(null);
  const [form, setForm] = useState<RateForm | null>(null);
  const list = classes.data ?? [];
  const current = list.find((item) => item.id === selected) ?? list.find((item) => !item.archivedAt) ?? null;
  const classRates = useMemo(
    () =>
      (rates.data ?? [])
        .filter((rate) => rate.laborClassId === current?.id)
        .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom)),
    [current?.id, rates.data],
  );
  const live =
    classRates.find((rate) => rate.effectiveFrom <= today && rate.siteId === null) ??
    classRates.find((rate) => rate.effectiveFrom <= today) ??
    null;
  const siteName = (id: string | null) =>
    id ? (sites.find((site) => site.id === id)?.name ?? 'One site') : 'All sites';

  const updateClass = useServerAction(updateLaborClassAction, { invalidate: INVALIDATE });
  const removeClass = useServerAction(deleteLaborClassAction, {
    invalidate: INVALIDATE,
    successMessage: 'Labor class deleted',
  });
  const queryClient = useQueryClient();
  const [removing, setRemoving] = useState<string | null>(null);
  const createRate = useServerAction(createLaborRateAction, { invalidate: INVALIDATE });

  function newRate(from?: LaborRateDTO | null) {
    const base = from ?? live;
    setForm({
      rateId: null,
      version: null,
      effectiveFrom: today,
      siteId: 'all',
      wage: dollars(base?.wageCents),
      tax: percentText(base?.payrollTaxBp ?? settings.defaultPayrollTaxBp),
      benefits: percentText(base?.benefitsBp ?? settings.defaultBenefitsBp),
      other: percentText(base?.otherBurdenBp ?? settings.defaultOtherBurdenBp),
      overhead: dollars(base?.overheadPerHourCents ?? settings.defaultOverheadPerHourCents),
      multiplier: base?.overtimeMultiplier
        ? String(Number(base.overtimeMultiplier))
        : String(Number(settings.defaultOvertimeMultiplier)),
      note: '',
    });
  }

  function editRate(rate: LaborRateDTO) {
    setForm({
      rateId: rate.id,
      version: rate.version,
      effectiveFrom: rate.effectiveFrom,
      siteId: rate.siteId ?? 'all',
      wage: dollars(rate.wageCents),
      tax: percentText(rate.payrollTaxBp),
      benefits: percentText(rate.benefitsBp),
      other: percentText(rate.otherBurdenBp),
      overhead: dollars(rate.overheadPerHourCents),
      multiplier: String(Number(rate.overtimeMultiplier)),
      note: rate.note ?? '',
    });
  }

  async function deleteRate(rate: LaborRateDTO) {
    setRemoving(rate.id);
    const result = await deleteLaborRateAction({ rateId: rate.id }).catch(() => null);
    setRemoving(null);
    if (!result?.ok) {
      toast.error(
        "Couldn't remove the rate",
        result?.error.message ?? 'Check your connection and try again.',
      );
      return;
    }
    for (const key of INVALIDATE) void queryClient.invalidateQueries({ queryKey: key });
    toast.undo(`Removed the rate from ${shortDate(rate.effectiveFrom)}`, {
      description: 'Hours logged from that day on were costed again.',
      onUndo: async () => {
        if (rate.wageCents === null) return;
        await createRate.run({
          laborClassId: rate.laborClassId,
          siteId: rate.siteId,
          effectiveFrom: rate.effectiveFrom,
          wageCents: rate.wageCents,
          payrollTaxBp: rate.payrollTaxBp ?? 0,
          benefitsBp: rate.benefitsBp ?? 0,
          otherBurdenBp: rate.otherBurdenBp ?? 0,
          overheadPerHourCents: rate.overheadPerHourCents ?? 0,
          overtimeMultiplier: rate.overtimeMultiplier,
          note: rate.note,
        });
      },
    });
  }

  if (classes.isError && list.length === 0) {
    return (
      <Panel>
        <div role="alert" className="flex flex-col items-center gap-3 py-10 text-center">
          <p className="text-base font-medium text-fg">We could not load the labor classes</p>
          <p className="text-sm text-fg-muted">{classes.error.message}</p>
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw aria-hidden />}
            onClick={() => void classes.refetch()}
          >
            Try again
          </Button>
        </div>
      </Panel>
    );
  }

  if (list.length === 0) {
    return (
      <Panel>
        <Teach
          icon={HandCoins}
          title="No labor classes yet"
          why="A labor class is a kind of worker, like Packer, Line lead or Temp packer. Each one gets its own real cost of an hour: the wage, plus payroll taxes, benefits and overhead. Every job uses that number."
          points={[
            'A live readout: one hour really costs this much',
            'Rates start on a day, so old jobs keep their old cost',
            'A preview of what a change does before you save it',
          ]}
          actions={
            <>
              <Button
                leadingIcon={<Plus aria-hidden />}
                onClick={() => setClassDialog({ id: null, name: '', kind: 'employee' })}
              >
                Add a labor class
              </Button>
              <ButtonLink href={routes.newImport('labor_rates')} variant="secondary">
                Import labor rates
              </ButtonLink>
            </>
          }
        />
        {classDialog ? (
          <ClassDialog
            key={classDialog.id ?? 'new'}
            state={classDialog}
            onClose={() => setClassDialog(null)}
            onSaved={(id) => setSelected(id)}
          />
        ) : null}
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[300px_minmax(0,1fr)]" data-testid="rates-view">
      <Panel
        title="Labor classes"
        action={
          <IconButton
            label="Add a labor class"
            icon={<Plus aria-hidden />}
            size="sm"
            variant="ghost"
            onClick={() => setClassDialog({ id: null, name: '', kind: 'employee' })}
          />
        }
        bodyClassName="p-2"
      >
        <ul className="flex flex-col gap-0.5" aria-label="Labor classes">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                aria-current={item.id === current?.id ? 'true' : undefined}
                onClick={() => setSelected(item.id)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left transition-colors hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-focus',
                  item.id === current?.id && 'bg-selected hover:bg-selected-hover',
                  item.archivedAt && 'opacity-60',
                )}
              >
                <span className="min-w-0 flex-1">
                  <span className="flex items-center gap-1.5 text-sm font-medium text-fg">
                    <span className="truncate">{item.name}</span>
                    {item.isDefault ? (
                      <Star
                        aria-label="Default class"
                        className="size-3.5 shrink-0 fill-current text-warning-text"
                      />
                    ) : null}
                  </span>
                  <span className="block truncate text-xs text-fg-muted">
                    {item.archivedAt
                      ? 'Archived'
                      : item.kind === 'temp_agency'
                        ? 'Temp agency'
                        : 'Your employees'}
                  </span>
                </span>
                <span className="shrink-0 text-sm tabular-nums text-fg-secondary">
                  {item.currentLoadedRateCents !== null ? (
                    formatMoney(item.currentLoadedRateCents)
                  ) : (
                    <Badge tone="warning" size="sm">
                      No rate
                    </Badge>
                  )}
                </span>
              </button>
            </li>
          ))}
        </ul>
        <p className="px-2.5 pt-2 pb-1 text-xs text-fg-muted">
          The star marks the default class. Hours with no class use its rate.
        </p>
      </Panel>

      {current ? (
        <div className="flex min-w-0 flex-col gap-4">
          <Panel
            title={current.name}
            action={
              <div className="flex items-center gap-1.5">
                <Button
                  leadingIcon={<Plus aria-hidden />}
                  onClick={() => newRate()}
                  disabled={Boolean(current.archivedAt)}
                >
                  {live ? 'Change the rate' : 'Add a rate'}
                </Button>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton
                      label={`More for ${current.name}`}
                      icon={<Pencil aria-hidden />}
                      variant="ghost"
                    />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem
                      icon={<Pencil aria-hidden />}
                      onSelect={() =>
                        setClassDialog({ id: current.id, name: current.name, kind: current.kind })
                      }
                    >
                      Rename or change the kind
                    </DropdownMenuItem>
                    {!current.isDefault && !current.archivedAt ? (
                      <DropdownMenuItem
                        icon={<Star aria-hidden />}
                        onSelect={() =>
                          void updateClass
                            .run({ laborClassId: current.id, patch: { isDefault: true } })
                            .then(
                              (done) =>
                                done &&
                                toast.success(
                                  `${current.name} is now the default class`,
                                  'Hours with no class were costed again.',
                                ),
                            )
                        }
                      >
                        Make it the default
                      </DropdownMenuItem>
                    ) : null}
                    {!current.isDefault ? (
                      <DropdownMenuItem
                        icon={current.archivedAt ? <ArchiveRestore aria-hidden /> : <Archive aria-hidden />}
                        onSelect={() => {
                          const archived = !current.archivedAt;
                          void updateClass
                            .run({ laborClassId: current.id, patch: { archived } })
                            .then((done) => {
                              if (done)
                                toast.undo(
                                  archived ? `Archived ${current.name}` : `Brought back ${current.name}`,
                                  {
                                    onUndo: async () =>
                                      void (await updateClass.run({
                                        laborClassId: current.id,
                                        patch: { archived: !archived },
                                      })),
                                  },
                                );
                            });
                        }}
                      >
                        {current.archivedAt ? 'Bring back' : 'Archive'}
                      </DropdownMenuItem>
                    ) : null}
                    {!current.isDefault ? (
                      <>
                        <DropdownMenuSeparator />
                        <DropdownMenuItem
                          icon={<Trash2 aria-hidden />}
                          variant="danger"
                          onSelect={() => void removeClass.run({ laborClassId: current.id })}
                        >
                          Delete
                        </DropdownMenuItem>
                      </>
                    ) : null}
                  </DropdownMenuContent>
                </DropdownMenu>
              </div>
            }
          >
            {live && live.wageCents !== null ? (
              <RateCard rate={live} className={current.name} />
            ) : (
              <NoRate
                name={current.name}
                onAdd={() => newRate()}
                defaultRateCents={settings.defaultLoadedRateCents}
              />
            )}
          </Panel>

          <Panel title="Rate history" bodyClassName="p-0">
            {rates.isLoading ? (
              <div className="p-4">
                <Skeleton height={40} className="w-full" />
              </div>
            ) : classRates.length === 0 ? (
              <p className="px-4 py-6 text-sm text-fg-muted">
                <CalendarClock aria-hidden className="mr-1.5 inline size-4 align-[-3px] text-icon" />
                No rates yet. Each rate starts on a day. When a wage changes, add a new rate from that day,
                and work logged before it keeps the old cost.
              </p>
            ) : (
              <ol
                className="divide-y divide-border-subtle"
                aria-label={`Rates of ${current.name}, newest first`}
              >
                {classRates.map((rate) => {
                  const state =
                    rate.effectiveFrom > today
                      ? 'Starts later'
                      : rate.id === live?.id
                        ? 'In use now'
                        : rate.siteId && rate.effectiveFrom <= today
                          ? 'One site'
                          : 'Past';
                  return (
                    <li
                      key={rate.id}
                      data-testid="rate-row"
                      className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5"
                    >
                      <div className="min-w-36">
                        <p className="text-sm font-medium text-fg">
                          From {shortDate(rate.effectiveFrom)}, {rate.effectiveFrom.slice(0, 4)}
                        </p>
                        <p className="text-xs text-fg-muted">{siteName(rate.siteId)}</p>
                      </div>
                      <Badge
                        tone={
                          state === 'In use now' ? 'success' : state === 'Starts later' ? 'info' : 'neutral'
                        }
                      >
                        {state}
                      </Badge>
                      <p className="min-w-0 flex-1 basis-56 text-sm tabular-nums text-fg-secondary">
                        <span className="font-semibold text-fg">
                          {formatMoneyPerHour(rate.loadedRateCents, { empty: 'Hidden' })}
                        </span>
                        {rate.wageCents !== null
                          ? ` = wage ${formatMoney(rate.wageCents)} + ${formatPercentBp((rate.payrollTaxBp ?? 0) + (rate.benefitsBp ?? 0) + (rate.otherBurdenBp ?? 0))} on top + ${formatMoney(rate.overheadPerHourCents)} overhead`
                          : ''}
                        {rate.note ? (
                          <span className="block truncate text-xs text-fg-muted">{rate.note}</span>
                        ) : null}
                      </p>
                      <span className="flex items-center gap-0.5">
                        <IconButton
                          label={`Edit the rate from ${shortDate(rate.effectiveFrom)}`}
                          icon={<Pencil aria-hidden />}
                          size="sm"
                          variant="ghost"
                          onClick={() => editRate(rate)}
                        />
                        <IconButton
                          label={`Remove the rate from ${shortDate(rate.effectiveFrom)}`}
                          icon={<Trash2 aria-hidden />}
                          size="sm"
                          variant="ghost"
                          loading={removing === rate.id}
                          onClick={() => void deleteRate(rate)}
                        />
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </Panel>
        </div>
      ) : null}

      {classDialog ? (
        <ClassDialog
          key={classDialog.id ?? 'new'}
          state={classDialog}
          onClose={() => setClassDialog(null)}
          onSaved={(id) => setSelected(id)}
        />
      ) : null}
      {current && form ? (
        <RateDialog
          key={`${current.id}:${form.rateId ?? 'new'}`}
          laborClass={current}
          form={form}
          setForm={setForm}
          sites={sites}
          today={today}
          onClose={() => setForm(null)}
        />
      ) : null}
    </div>
  );
}

function NoRate({
  name,
  onAdd,
  defaultRateCents,
}: {
  readonly name: string;
  readonly onAdd: () => void;
  readonly defaultRateCents: number | null;
}) {
  return (
    <div className="flex flex-col items-start gap-3">
      <p className="text-base text-fg">
        {name} has no rate yet.{' '}
        {defaultRateCents !== null && defaultRateCents > 0
          ? `Its hours are costed at the workspace default of ${formatMoneyPerHour(defaultRateCents)}.`
          : 'Its hours cost nothing in Pulse until you add one, so job profit looks better than it is.'}
      </p>
      <Button leadingIcon={<Plus aria-hidden />} onClick={onAdd}>
        Add a rate
      </Button>
    </div>
  );
}

const PARTS = [
  { key: 'wage', label: 'Wage', color: 'var(--pulse-series-1, var(--color-primary))' },
  { key: 'burden', label: 'Taxes, benefits and other', color: 'var(--pulse-series-2, var(--color-info))' },
  { key: 'overhead', label: 'Overhead', color: 'var(--pulse-series-3, var(--color-warning))' },
] as const;

/** The live readout: one hour really costs this much, and what it is made of. */
export function RateReadout({ rate, name }: { readonly rate: LoadedRate; readonly name: string }) {
  const parts = rateBreakdown(rate);
  const total = centsToNumber(parts.loadedRateCents);
  const values = {
    wage: centsToNumber(parts.wageCents),
    burden: centsToNumber(parts.burdenCents),
    overhead: centsToNumber(parts.overheadPerHourCents),
  };
  return (
    <div className="flex flex-col gap-3" data-testid="rate-readout">
      <p className="text-sm text-fg-secondary">One hour of a {name.toLowerCase()} really costs</p>
      <p
        className="-mt-2 text-3xl font-semibold tracking-[-0.02em] text-fg tabular-nums"
        data-testid="loaded-rate"
      >
        {formatMoney(total)}
      </p>
      <div
        className="flex h-3 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={`Of ${formatMoney(total)}: wage ${formatMoney(values.wage)}, taxes, benefits and other ${formatMoney(values.burden)}, overhead ${formatMoney(values.overhead)}`}
      >
        {PARTS.map((part) =>
          total > 0 && values[part.key] > 0 ? (
            <span
              key={part.key}
              style={{ width: `${(values[part.key] / total) * 100}%`, background: part.color }}
              className="h-full border-r border-panel last:border-r-0"
            />
          ) : null,
        )}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1.5 sm:grid-cols-3">
        {PARTS.map((part) => (
          <div
            key={part.key}
            className="flex items-baseline justify-between gap-3 sm:flex-col sm:items-start sm:gap-0"
          >
            <dt className="flex min-w-0 items-baseline gap-1.5 text-xs text-fg-muted">
              <span
                aria-hidden
                className="size-2 shrink-0 translate-y-[-1px] rounded-full"
                style={{ background: part.color }}
              />
              <span>
                {part.label}
                {part.key === 'burden' ? ` (${formatPercentBp(parts.burdenBp)} of the wage)` : ''}
              </span>
            </dt>
            <dd className="shrink-0 text-sm font-medium tabular-nums text-fg">
              {formatMoney(values[part.key])}
            </dd>
          </div>
        ))}
      </dl>
      <p className="text-sm text-fg-secondary">
        An overtime hour costs{' '}
        <span className="font-medium text-fg tabular-nums">
          {formatMoney(centsToNumber(rate.overtimeRateCents))}
        </span>
        . Payroll taxes grow with overtime pay. Benefits and overhead do not: health insurance does not cost
        more in hour 41.
      </p>
    </div>
  );
}

function RateCard({ rate, className: name }: { readonly rate: LaborRateDTO; readonly className: string }) {
  const loaded = loadedRate({
    wageCents: rate.wageCents ?? 0,
    payrollTaxBp: rate.payrollTaxBp ?? 0,
    benefitsBp: rate.benefitsBp ?? 0,
    otherBurdenBp: rate.otherBurdenBp ?? 0,
    overheadPerHourCents: rate.overheadPerHourCents ?? 0,
    overtimeMultiplier: rate.overtimeMultiplier,
  });
  return <RateReadout rate={loaded} name={name} />;
}

function ClassDialog({
  state,
  onClose,
  onSaved,
}: {
  readonly state: { id: string | null; name: string; kind: 'employee' | 'temp_agency' };
  readonly onClose: () => void;
  readonly onSaved: (id: string) => void;
}) {
  const [name, setName] = useState(state.name);
  const [kind, setKind] = useState<'employee' | 'temp_agency'>(state.kind);
  const create = useServerAction(createLaborClassAction, { invalidate: INVALIDATE });
  const update = useServerAction(updateLaborClassAction, { invalidate: INVALIDATE });

  async function submit() {
    if (!name.trim()) return;
    const saved = state.id
      ? await update.run({ laborClassId: state.id, patch: { name: name.trim(), kind } })
      : await create.run({ name: name.trim(), kind });
    if (!saved) return;
    toast.success(
      state.id ? 'Labor class saved' : `Added ${saved.name}`,
      state.id ? undefined : 'Now add its rate, so its hours cost the right amount.',
    );
    onSaved(saved.id);
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader
          title={state.id ? 'Edit the labor class' : 'Add a labor class'}
          description="A kind of worker with its own cost for an hour."
          icon={<Users aria-hidden />}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            <Field
              label="Name"
              required
              error={create.fieldErrors.name ?? update.fieldErrors['patch.name'] ?? null}
            >
              {({ inputId, invalid }) => (
                <Input
                  id={inputId}
                  invalid={invalid}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Packer"
                  maxLength={120}
                  autoFocus
                />
              )}
            </Field>
            <Field
              label="Kind"
              hint={
                kind === 'temp_agency'
                  ? 'For a temp agency, the wage is the rate the agency bills you. Taxes and benefits are usually 0.'
                  : 'People on your own payroll.'
              }
            >
              {({ inputId }) => (
                <Select
                  id={inputId}
                  value={kind}
                  onValueChange={(value) => setKind(value as 'employee' | 'temp_agency')}
                  options={[
                    { value: 'employee', label: 'Your employees' },
                    { value: 'temp_agency', label: 'Temp agency' },
                  ]}
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.pending || update.pending} disabled={!name.trim()}>
              {state.id ? 'Save' : 'Add'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function RateDialog({
  laborClass,
  form,
  setForm,
  sites,
  today,
  onClose,
}: {
  readonly laborClass: LaborClassDTO;
  readonly form: RateForm;
  readonly setForm: (form: RateForm) => void;
  readonly sites: readonly SiteDTO[];
  readonly today: string;
  readonly onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const parsed = parseForm(form);
  const [error, setError] = useState<string | null>(null);
  const [touched, setTouched] = useState(false);
  const create = useServerAction(createLaborRateAction, {
    invalidate: INVALIDATE,
    silentError: true,
    onError: (problem) => setError(problem.message),
  });
  const update = useServerAction(updateLaborRateAction, {
    invalidate: INVALIDATE,
    silentError: true,
    onError: (problem) => setError(problem.message),
  });
  const remove = useServerAction(deleteLaborRateAction, { invalidate: INVALIDATE });
  const set = (patch: Partial<RateForm>) => (setTouched(true), setForm({ ...form, ...patch }));

  const payload = parsed.ok
    ? {
        laborClassId: laborClass.id,
        siteId: form.siteId === 'all' ? null : form.siteId,
        effectiveFrom: form.effectiveFrom,
        ...parsed.value,
      }
    : null;
  const debounced = useDebouncedValue(payload ? JSON.stringify(payload) : '', 450);

  const previewQuery = useQuery({
    queryKey: ['labor-rate-preview', form.rateId, debounced],
    enabled: Boolean(debounced),
    staleTime: 30_000,
    retry: false,
    queryFn: async (): Promise<RateChangePreviewDTO | null> => {
      const result = await previewLaborRateAction({
        ...(JSON.parse(debounced) as NonNullable<typeof payload>),
        rateId: form.rateId,
      });
      return result.ok ? result.data : null;
    },
  });
  const preview = previewQuery.data ?? null;
  const previewing = previewQuery.isFetching;

  // Overhead helper: company costs of the last 3 full months over the direct hours of those months.
  const helperFrom = addMonths(startOfMonth(today), -3);
  const helperTo = endOfMonth(addMonths(startOfMonth(today), -1));
  const bridge = useCompanyBridge({ from: helperFrom, to: helperTo });
  const suggestion =
    bridge.data && bridge.data.companyCostCents !== null && bridge.data.hasCompanyCosts
      ? suggestOverheadPerHour(bridge.data.companyCostCents, bridge.data.directHours)
      : null;
  const covered =
    parsed.ok && bridge.data
      ? overheadCovered(parsed.value.overheadPerHourCents, bridge.data.directHours)
      : null;

  async function submit() {
    setTouched(true);
    if (!parsed.ok || !payload) return setError(parsed.ok ? null : parsed.message);
    setError(null);
    const note = form.note.trim() || null;
    if (form.rateId) {
      const saved = await update.run({
        rateId: form.rateId,
        patch: { siteId: payload.siteId, effectiveFrom: payload.effectiveFrom, ...parsed.value, note },
        version: form.version,
      });
      if (!saved) return;
      toast.success(
        'Rate saved',
        preview && preview.entries > 0
          ? `${preview.entries} logged ${preview.entries === 1 ? 'entry was' : 'entries were'} costed again.`
          : undefined,
      );
    } else {
      const saved = await create.run({ ...payload, note });
      if (!saved) return;
      toast.undo(`New rate for ${laborClass.name}: ${formatMoneyPerHour(saved.loadedRateCents)}`, {
        description:
          preview && preview.entries > 0
            ? `${preview.entries} logged ${preview.entries === 1 ? 'entry was' : 'entries were'} costed again.`
            : `It starts ${shortDate(saved.effectiveFrom)}.`,
        onUndo: async () => {
          await remove.run({ rateId: saved.id });
          await queryClient.invalidateQueries({ queryKey: qk.laborRates() });
        },
      });
    }
    onClose();
  }

  const fieldError = (name: string) =>
    touched && !parsed.ok && parsed.field === name ? parsed.message : null;
  const money = (name: 'wage' | 'overhead', label: string, hint?: React.ReactNode) => (
    <Field label={label} hint={hint} error={fieldError(name)} required={name === 'wage'}>
      {({ inputId, invalid }) => (
        <Input
          id={inputId}
          invalid={invalid}
          inputMode="decimal"
          leadingIcon={<span className="text-fg-muted">$</span>}
          value={form[name]}
          onChange={(event) => set({ [name]: event.target.value })}
          className="text-right tabular-nums"
        />
      )}
    </Field>
  );
  const percent = (name: 'tax' | 'benefits' | 'other', label: string) => (
    <Field label={label} error={fieldError(name)}>
      {({ inputId, invalid }) => (
        <Input
          id={inputId}
          invalid={invalid}
          inputMode="decimal"
          trailing={<span className="pr-2 text-fg-muted">%</span>}
          value={form[name]}
          onChange={(event) => set({ [name]: event.target.value })}
          className="text-right tabular-nums"
        />
      )}
    </Field>
  );

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="lg">
        <DialogHeader
          title={form.rateId ? `Edit the ${laborClass.name} rate` : `New rate for ${laborClass.name}`}
          description="An hour of work costs more than the wage. Add what you pay on top, and Pulse shows what one hour really costs."
          icon={<HandCoins aria-hidden />}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <div className="flex flex-col gap-3">
              {money(
                'wage',
                laborClass.kind === 'temp_agency' ? 'What the agency bills for an hour' : 'Wage for an hour',
              )}
              <fieldset className="flex flex-col gap-3 rounded-lg border border-border-subtle p-3">
                <legend className="px-1 text-xs font-medium text-fg-muted">
                  On top of the wage, as a percent of it
                </legend>
                {percent('tax', 'Payroll taxes and workers comp')}
                {percent('benefits', 'Benefits and paid time off')}
                {percent('other', 'Other')}
              </fieldset>
              {money(
                'overhead',
                'Overhead for each hour',
                suggestion !== null ? (
                  <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <Lightbulb aria-hidden className="size-3.5 shrink-0 text-warning-text" />
                    Your company costs of the last 3 full months, spread over the hours on jobs, come to{' '}
                    {formatMoneyPerHour(centsToNumber(suggestion))}.
                    <button
                      type="button"
                      className="font-medium text-fg-link underline-offset-2 hover:underline"
                      onClick={() => set({ overhead: centsToDecimal(suggestion) })}
                    >
                      Use it
                    </button>
                  </span>
                ) : (
                  'Rent, utilities, equipment and office staff, spread over each hour worked. Add company costs and Pulse can suggest this number.'
                ),
              )}
              {covered !== null && bridge.data?.hasCompanyCosts && bridge.data.companyCostCents !== null ? (
                <p className="-mt-1 text-xs text-fg-muted">
                  At this number, 3 months of hours on jobs cover{' '}
                  {formatMoney(centsToNumber(covered), { cents: false })} of overhead. Your real company costs
                  were {formatMoney(bridge.data.companyCostCents, { cents: false })}.
                </p>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <Field label="Overtime multiplier" error={fieldError('multiplier')}>
                  {({ inputId, invalid }) => (
                    <Input
                      id={inputId}
                      invalid={invalid}
                      inputMode="decimal"
                      value={form.multiplier}
                      onChange={(event) => set({ multiplier: event.target.value })}
                      className="text-right tabular-nums"
                    />
                  )}
                </Field>
                <Field label="Starts on">
                  {({ inputId }) => (
                    <IsoDatePicker
                      id={inputId}
                      value={form.effectiveFrom}
                      clearable={false}
                      onChange={(value) => value && set({ effectiveFrom: value })}
                    />
                  )}
                </Field>
              </div>
              {sites.length > 1 ? (
                <Field label="Where" hint="A rate for one site beats the all sites rate there.">
                  {({ inputId }) => (
                    <Select
                      id={inputId}
                      value={form.siteId}
                      onValueChange={(siteId) => set({ siteId })}
                      options={[
                        { value: 'all', label: 'All sites' },
                        ...sites.map((site) => ({ value: site.id, label: site.name })),
                      ]}
                    />
                  )}
                </Field>
              ) : null}
              <Field label="Note">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    value={form.note}
                    maxLength={500}
                    placeholder="Why it changed"
                    onChange={(event) => set({ note: event.target.value })}
                  />
                )}
              </Field>
            </div>
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-border-subtle bg-sunken p-4">
                {parsed.ok ? (
                  <RateReadout rate={parsed.rate} name={laborClass.name} />
                ) : (
                  <p className="text-sm text-fg-secondary">Type a wage to see what one hour really costs.</p>
                )}
              </div>
              <div
                className="rounded-xl border border-border-subtle p-4"
                aria-live="polite"
                data-testid="rate-preview"
              >
                <h3 className="text-sm font-semibold text-fg">What this changes</h3>
                {!parsed.ok ? (
                  <p className="mt-1 text-sm text-fg-muted">
                    The effect on logged work shows here before you save.
                  </p>
                ) : previewing && !preview ? (
                  <Skeleton height={40} className="mt-2 w-full" />
                ) : preview ? (
                  <PreviewWords preview={preview} from={form.effectiveFrom} />
                ) : (
                  <p className="mt-1 text-sm text-fg-muted">
                    We could not work out the effect right now. You can still save.
                  </p>
                )}
              </div>
            </div>
            {error ? (
              <p role="alert" className="col-span-full text-sm text-danger-text">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={create.pending || update.pending}>
              {form.rateId ? 'Save the rate' : 'Add the rate'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function PreviewWords({ preview, from }: { readonly preview: RateChangePreviewDTO; readonly from: string }) {
  const delta = preview.laborDeltaCents ?? 0;
  return (
    <div className="mt-1 flex flex-col gap-1.5 text-sm text-fg-secondary">
      {preview.entries === 0 ? (
        <p>
          No logged work is dated on or after {shortDate(from)} for this class, so nothing is costed again.
          The rate is used for new entries from that day.
        </p>
      ) : (
        <p>
          This changes <span className="font-medium text-fg">{preview.entries.toLocaleString('en-US')}</span> logged{' '}
          {preview.entries === 1 ? 'entry' : 'entries'}
          {preview.jobs > 0 ? (
            <>
              {' '}
              across <span className="font-medium text-fg">{preview.jobs}</span>{' '}
              {preview.jobs === 1 ? 'job' : 'jobs'}
            </>
          ) : null}{' '}
          and{' '}
          {delta === 0 ? (
            'leaves profit the same.'
          ) : (
            <>
              {delta > 0 ? 'lowers' : 'raises'} profit by{' '}
              <span className={cn('font-medium', delta > 0 ? 'text-danger-text' : 'text-success-text')}>
                {formatMoney(Math.abs(delta))}
              </span>
              .
            </>
          )}
        </p>
      )}
      {preview.closedEntries > 0 ? (
        <p>
          {preview.closedEntries.toLocaleString('en-US')} {preview.closedEntries === 1 ? 'entry is' : 'entries are'}{' '}
          in a closed month and keep their old cost.
        </p>
      ) : null}
    </div>
  );
}
