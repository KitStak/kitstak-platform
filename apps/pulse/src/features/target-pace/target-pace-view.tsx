'use client';
/**
 * Target pace: how many units one person should finish in an hour. Targets by job type, client,
 * extra service and labor class with a start day, a suggestion from the workspace's own history,
 * a target for one job, and pace against target by job, labor class and day.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Gauge, History, Info, Lightbulb, Pencil, Plus, RefreshCw, Target, Trash2 } from 'lucide-react';
import {
  Badge,
  Button,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
  Field,
  IconButton,
  Input,
  IsoDatePicker,
  Popover,
  PopoverContent,
  PopoverTrigger,
  Select,
  Skeleton,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeaderCell,
  TableRow,
  ToggleGroup,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { BulletChart } from '@/components/charts/bullet';
import { LineChart } from '@/components/charts/cartesian';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { RangeBar, useRange } from '@/features/labor/range-bar';
import { floorKeys, usePaceBoard, usePaceSuggestions } from '@/features/log/floor-hooks';
import { paceTone, type PaceThresholds } from '@/features/log/log-math';
import { useShell } from '@/features/shell/shell-context';
import { formatHours, formatNumber, formatPace, formatPercentBp } from '@/lib/format';
import { useServerAction } from '@/lib/hooks/use-action';
import { useClients, useStandards, useVasServices } from '@/lib/hooks/use-data';
import { shortDate } from '@/lib/profit';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type {
  JobTypeDTO,
  LaborClassDTO,
  PaceBoardDTO,
  PaceBoardRowDTO,
  PaceSuggestionRowDTO,
  SiteDTO,
  StandardDTO,
} from '@/lib/types';
import { updateJobAction } from '@/server/actions/jobs';
import { deleteStandardAction, saveStandardAction } from '@/server/actions/planning';

const INVALIDATE = [
  qk.standards(),
  floorKeys.suggestions(),
  qk.streams(),
  qk.jobsRoot(),
  qk.badges(),
] as const;

interface StandardForm {
  id: string | null;
  version: number | null;
  scope: 'job_type' | 'service';
  jobTypeId: string;
  vasServiceId: string;
  clientId: string;
  laborClassId: string;
  pace: string;
  effectiveFrom: string;
  basis: 'typed' | 'history' | 'time_study';
  note: string;
}

const BASIS_LABELS: Readonly<Record<StandardDTO['basis'], string>> = {
  typed: 'Typed in',
  history: 'From history',
  time_study: 'Time study',
};

const TONE_TEXT = {
  good: 'text-success-text',
  watch: 'text-warning-text',
  bad: 'text-danger-text',
  none: 'text-fg-secondary',
} as const;

export function TargetPaceView({
  initialStandards,
  jobTypes,
  laborClasses,
  sites,
  today,
  thresholds,
  initialSuggestions,
  initialBoard,
}: {
  readonly initialStandards: StandardDTO[];
  readonly jobTypes: readonly JobTypeDTO[];
  readonly laborClasses: readonly LaborClassDTO[];
  readonly sites: readonly SiteDTO[];
  readonly today: string;
  readonly thresholds: PaceThresholds;
  /** Read on the server so the first paint is whole (no cards that load later and push the page down). */
  readonly initialSuggestions?: PaceSuggestionRowDTO[];
  readonly initialBoard?: InitialBoard;
}) {
  const shell = useShell();
  const canManage = shell.can('standard:manage');
  const standards = useStandards({}, { initialData: initialStandards });
  const suggestions = usePaceSuggestions({ initialData: initialSuggestions });
  const clients = useClients({});
  const services = useVasServices({});
  const [form, setForm] = useState<StandardForm | null>(null);
  const save = useServerAction(saveStandardAction, { invalidate: INVALIDATE });
  const remove = useServerAction(deleteStandardAction, { invalidate: INVALIDATE });

  const typeName = (id: string | null) => jobTypes.find((type) => type.id === id)?.name ?? 'A job type';
  const clientName = (id: string | null) =>
    id ? (clients.data?.find((client) => client.id === id)?.name ?? 'One client') : 'All clients';
  const className = (id: string | null) =>
    id ? (laborClasses.find((item) => item.id === id)?.name ?? 'One class') : 'All classes';
  const serviceName = (id: string | null) =>
    services.data?.find((service) => service.id === id)?.name ?? 'An extra service';

  const blank = (patch: Partial<StandardForm> = {}): StandardForm => ({
    id: null,
    version: null,
    scope: 'job_type',
    jobTypeId: jobTypes[0]?.id ?? '',
    vasServiceId: '',
    clientId: 'all',
    laborClassId: 'all',
    pace: '',
    effectiveFrom: today,
    basis: 'typed',
    note: '',
    ...patch,
  });

  async function accept(row: PaceSuggestionRowDTO) {
    if (!row.median) return;
    const pace = String(Math.round(Number(row.median) * 10) / 10);
    const saved = await save.run({
      jobTypeId: row.jobTypeId,
      unitsPerLaborHour: pace,
      effectiveFrom: today,
      basis: 'history',
      note: row.days === 1 ? 'The 1 day with units and hours' : `Median of the last ${row.days} days with units and hours`,
    });
    if (!saved) return;
    toast.undo(`Target pace for ${row.jobTypeName} is now ${formatPace(pace)}`, {
      description: 'Jobs of this type were checked against it again.',
      onUndo: async () => void (await remove.run({ id: saved.id })),
    });
  }

  async function removeStandard(row: StandardDTO) {
    const result = await deleteStandardAction({ id: row.id }).catch(() => null);
    if (!result?.ok) {
      toast.error(
        "Couldn't remove the target",
        result?.error.message ?? 'Check your connection and try again.',
      );
      return;
    }
    await standards.refetch();
    void suggestions.refetch();
    toast.undo('Target removed', {
      onUndo: async () =>
        void (await save.run({
          jobTypeId: row.jobTypeId,
          vasServiceId: row.vasServiceId,
          clientId: row.clientId,
          laborClassId: row.laborClassId,
          unitsPerLaborHour: row.unitsPerLaborHour,
          effectiveFrom: row.effectiveFrom,
          basis: row.basis,
          note: row.note,
        })),
    });
  }

  const rows = useMemo(
    () =>
      [...(standards.data ?? [])].sort(
        (a, b) =>
          (a.jobTypeId ?? a.vasServiceId ?? '').localeCompare(b.jobTypeId ?? b.vasServiceId ?? '') ||
          b.effectiveFrom.localeCompare(a.effectiveFrom),
      ),
    [standards.data],
  );
  const noTargets = rows.length === 0 && jobTypes.every((type) => !type.defaultStandardUph);

  return (
    <div className="flex flex-col gap-4" data-testid="target-pace-view">
      {noTargets ? (
        <Panel>
          <Teach
            icon={Gauge}
            size="sm"
            title="No target pace set yet"
            why="A target pace is your yardstick: for example 42 units per person per hour for kitting. With a target, Pulse can tell you the moment a crew falls behind, and what that costs."
            actions={
              canManage ? (
                <Button leadingIcon={<Plus aria-hidden />} onClick={() => setForm(blank())}>
                  Add a target
                </Button>
              ) : (
                <ButtonLink href={routes.log()}>Log work to build history</ButtonLink>
              )
            }
            footnote={
              canManage
                ? 'Or use a suggestion from your own history below, once about 20 days are logged.'
                : 'A manager sets the targets. You will see your pace against them here and on the log.'
            }
          />
        </Panel>
      ) : null}

      <Panel
        title="Suggested from your history"
        action={
          canManage ? (
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<Plus aria-hidden />}
              onClick={() => setForm(blank())}
            >
              Add a target
            </Button>
          ) : null
        }
        bodyClassName="p-0"
      >
        <p className="px-4 pt-3 text-sm text-fg-muted">
          For each job type, Pulse takes the last 20 days that have both units and labor hours and finds the
          middle pace. Half of those days were faster, half were slower.
        </p>
        {suggestions.isLoading ? (
          <div className="p-4">
            <Skeleton height={120} className="w-full" />
          </div>
        ) : suggestions.isError ? (
          <div
            role="alert"
            className="flex items-center justify-between gap-3 px-4 py-4 text-sm text-danger-text"
          >
            <span>We could not load the suggestions. {suggestions.error.message}</span>
            <Button
              variant="secondary"
              size="sm"
              leadingIcon={<RefreshCw aria-hidden />}
              onClick={() => void suggestions.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : (
          <>
            <ul
              className="mt-3 divide-y divide-border-subtle border-t border-border-subtle lg:hidden"
              aria-label="Suggested targets"
            >
              {(suggestions.data ?? []).map((row) => {
                const same =
                  row.median && row.current
                    ? Math.abs(Number(row.median) - Number(row.current)) / Number(row.current) < 0.02
                    : false;
                return (
                  <li
                    key={row.jobTypeId}
                    data-testid="suggestion-card"
                    className="flex flex-col gap-1.5 px-4 py-3"
                  >
                    <p className="text-sm font-medium text-fg">
                      {row.jobTypeName}{' '}
                      <span className="font-normal text-fg-muted">{row.unitLabel} per person per hour</span>
                    </p>
                    <p className="text-sm tabular-nums text-fg-secondary">
                      Target now {row.current ? formatPace(row.current) : 'none'}. History says{' '}
                      <span className="font-semibold text-fg">
                        {row.median ? formatPace(row.median) : 'not enough days yet'}
                      </span>
                      {row.days > 0 ? `, from ${row.days} ${row.days === 1 ? 'day' : 'days'}` : ''}.
                    </p>
                    {row.low && row.high ? (
                      <Spread
                        low={Number(row.low)}
                        mid={Number(row.median)}
                        high={Number(row.high)}
                        current={row.current ? Number(row.current) : null}
                      />
                    ) : null}
                    {canManage && row.median ? (
                      same ? (
                        <span className="text-xs text-success-text">Matches your target</span>
                      ) : (
                        <Button
                          variant="secondary"
                          className="self-start"
                          leadingIcon={<Lightbulb aria-hidden />}
                          loading={save.pending}
                          onClick={() => void accept(row)}
                        >
                          Use {formatPace(Math.round(Number(row.median) * 10) / 10)}
                        </Button>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
            <div className="mt-3 hidden border-t border-border-subtle lg:block">
              <Table className="min-w-[680px]" aria-label="Suggested target pace by job type">
                <TableHead>
                  <TableRow className="hover:bg-transparent">
                    <TableHeaderCell>Job type</TableHeaderCell>
                    <TableHeaderCell numeric>Target now</TableHeaderCell>
                    <TableHeaderCell numeric>History says</TableHeaderCell>
                    <TableHeaderCell>Slowest to fastest day</TableHeaderCell>
                    <TableHeaderCell>Based on</TableHeaderCell>
                    <TableHeaderCell className="w-36">
                      <span className="sr-only">Use it</span>
                    </TableHeaderCell>
                  </TableRow>
                </TableHead>
                <TableBody>
                  {(suggestions.data ?? []).map((row) => {
                    const same =
                      row.median && row.current
                        ? Math.abs(Number(row.median) - Number(row.current)) / Number(row.current) < 0.02
                        : false;
                    return (
                      <TableRow key={row.jobTypeId} data-testid="suggestion-row">
                        <TableCell>
                          {row.jobTypeName}
                          <span className="ml-1.5 text-xs text-fg-muted">
                            {row.unitLabel} per person per hour
                          </span>
                        </TableCell>
                        <TableCell numeric>
                          {row.current ? (
                            formatPace(row.current)
                          ) : (
                            <span className="text-fg-muted">None</span>
                          )}
                        </TableCell>
                        <TableCell numeric className="font-medium">
                          {row.median ? (
                            formatPace(row.median)
                          ) : (
                            <span className="font-normal text-fg-muted">Not enough days yet</span>
                          )}
                        </TableCell>
                        <TableCell>
                          {row.low && row.high ? (
                            <Spread
                              low={Number(row.low)}
                              mid={Number(row.median)}
                              high={Number(row.high)}
                              current={row.current ? Number(row.current) : null}
                            />
                          ) : null}
                        </TableCell>
                        <TableCell className="text-fg-secondary">
                          {row.days > 0 ? (
                            <>
                              {row.days} {row.days === 1 ? 'day' : 'days'}, {row.jobs}{' '}
                              {row.jobs === 1 ? 'job' : 'jobs'}
                              {row.days < 10 ? (
                                <span className="ml-1.5 text-xs text-warning-text">
                                  Thin, treat with care
                                </span>
                              ) : null}
                            </>
                          ) : (
                            'Log units and hours for this job type'
                          )}
                        </TableCell>
                        <TableCell>
                          {canManage && row.median ? (
                            same ? (
                              <span className="text-xs text-success-text">Matches your target</span>
                            ) : (
                              <Button
                                variant="secondary"
                                size="sm"
                                leadingIcon={<Lightbulb aria-hidden />}
                                loading={save.pending}
                                onClick={() => void accept(row)}
                              >
                                Use {formatPace(Math.round(Number(row.median) * 10) / 10)}
                              </Button>
                            )
                          ) : null}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          </>
        )}
      </Panel>

      <Panel title="Targets" bodyClassName="p-0">
        {standards.isError ? (
          <p role="alert" className="px-4 py-4 text-sm text-danger-text">
            We could not load the targets. {standards.error.message}
          </p>
        ) : rows.length === 0 ? (
          <p className="px-4 py-6 text-sm text-fg-secondary">
            <History aria-hidden className="mr-1.5 inline size-4 align-[-3px] text-icon" />
            No targets with a start day yet. A target can be for a whole job type, or tighter: one client, one
            labor class or one extra service. The tightest match wins, and a newer start day beats an older
            one.
          </p>
        ) : (
          <div>
            <Table className="min-w-[720px]" aria-label="Targets with a start day">
              <TableHead>
                <TableRow className="hover:bg-transparent">
                  <TableHeaderCell>For</TableHeaderCell>
                  <TableHeaderCell>Client</TableHeaderCell>
                  <TableHeaderCell>Labor class</TableHeaderCell>
                  <TableHeaderCell numeric>Units per person per hour</TableHeaderCell>
                  <TableHeaderCell>Starts</TableHeaderCell>
                  <TableHeaderCell>Where it came from</TableHeaderCell>
                  <TableHeaderCell className="w-20">
                    <span className="sr-only">Actions</span>
                  </TableHeaderCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => (
                  <TableRow key={row.id} data-testid="standard-row">
                    <TableCell>
                      {row.jobTypeId ? typeName(row.jobTypeId) : serviceName(row.vasServiceId)}
                      {row.vasServiceId ? (
                        <Badge size="sm" className="ml-1.5">
                          Extra service
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell className="text-fg-secondary">{clientName(row.clientId)}</TableCell>
                    <TableCell className="text-fg-secondary">{className(row.laborClassId)}</TableCell>
                    <TableCell numeric className="font-medium">
                      {formatPace(row.unitsPerLaborHour)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {shortDate(row.effectiveFrom)}, {row.effectiveFrom.slice(0, 4)}
                      {row.effectiveFrom > today ? (
                        <Badge tone="info" size="sm" className="ml-1.5">
                          Later
                        </Badge>
                      ) : null}
                    </TableCell>
                    <TableCell
                      className="max-w-[220px] truncate text-fg-secondary"
                      title={row.note ?? undefined}
                    >
                      {BASIS_LABELS[row.basis]}
                      {row.note ? `. ${row.note}` : ''}
                    </TableCell>
                    <TableCell>
                      {canManage ? (
                        <span className="flex items-center justify-end gap-0.5">
                          <IconButton
                            label={`Edit the target for ${row.jobTypeId ? typeName(row.jobTypeId) : serviceName(row.vasServiceId)}`}
                            icon={<Pencil aria-hidden />}
                            size="sm"
                            variant="ghost"
                            onClick={() =>
                              setForm({
                                id: row.id,
                                version: row.version,
                                scope: row.jobTypeId ? 'job_type' : 'service',
                                jobTypeId: row.jobTypeId ?? '',
                                vasServiceId: row.vasServiceId ?? '',
                                clientId: row.clientId ?? 'all',
                                laborClassId: row.laborClassId ?? 'all',
                                pace: String(Number(row.unitsPerLaborHour)),
                                effectiveFrom: row.effectiveFrom,
                                basis: row.basis,
                                note: row.note ?? '',
                              })
                            }
                          />
                          <IconButton
                            label={`Remove the target for ${row.jobTypeId ? typeName(row.jobTypeId) : serviceName(row.vasServiceId)}`}
                            icon={<Trash2 aria-hidden />}
                            size="sm"
                            variant="ghost"
                            onClick={() => void removeStandard(row)}
                          />
                        </span>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </Panel>

      <PaceBoard sites={sites} today={today} thresholds={thresholds} canManage={shell.can('job:manage')} initial={initialBoard} />

      {form ? (
        <StandardDialog
          form={form}
          setForm={setForm}
          jobTypes={jobTypes}
          laborClasses={laborClasses}
          clients={(clients.data ?? []).map((client) => ({ value: client.id, label: client.name }))}
          services={(services.data ?? []).map((service) => ({ value: service.id, label: service.name }))}
          onClose={() => setForm(null)}
        />
      ) : null}
    </div>
  );
}

/** Slowest day, middle and fastest day on one line, with the target in force marked. */
function Spread({
  low,
  mid,
  high,
  current,
}: {
  readonly low: number;
  readonly mid: number;
  readonly high: number;
  readonly current: number | null;
}) {
  const min = Math.min(low, current ?? low);
  const max = Math.max(high, current ?? high);
  const span = max - min || 1;
  const at = (value: number) => `${((value - min) / span) * 100}%`;
  return (
    <div
      className="flex items-center gap-2"
      role="img"
      aria-label={`Slowest day ${formatPace(low)}, middle ${formatPace(mid)}, fastest day ${formatPace(high)}${current ? `, target now ${formatPace(current)}` : ''}`}
    >
      <span className="w-10 text-right text-xs tabular-nums text-fg-muted">{formatPace(low)}</span>
      <span className="relative h-2 w-28 rounded-full bg-muted">
        <span
          className="absolute inset-y-0 rounded-full bg-primary-subtle"
          style={{ left: at(low), right: `calc(100% - ${at(high)})` }}
        />
        <span
          className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary"
          style={{ left: at(mid) }}
        />
        {current !== null ? (
          <span
            className="absolute -inset-y-1 w-0.5 -translate-x-1/2 bg-fg"
            style={{ left: at(current) }}
            title="Target now"
          />
        ) : null}
      </span>
      <span className="w-10 text-xs tabular-nums text-fg-muted">{formatPace(high)}</span>
    </div>
  );
}

function StandardDialog({
  form,
  setForm,
  jobTypes,
  laborClasses,
  clients,
  services,
  onClose,
}: {
  readonly form: StandardForm;
  readonly setForm: (form: StandardForm) => void;
  readonly jobTypes: readonly JobTypeDTO[];
  readonly laborClasses: readonly LaborClassDTO[];
  readonly clients: readonly { value: string; label: string }[];
  readonly services: readonly { value: string; label: string }[];
  readonly onClose: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const save = useServerAction(saveStandardAction, {
    invalidate: INVALIDATE,
    silentError: true,
    onError: (problem) => setError(problem.message),
  });
  const set = (patch: Partial<StandardForm>) => setForm({ ...form, ...patch });

  async function submit() {
    const pace = Number(form.pace.replace(/,/g, ''));
    if (!(pace > 0)) return setError('Type a pace above zero, like 42.');
    if (form.scope === 'job_type' && !form.jobTypeId) return setError('Pick a job type.');
    if (form.scope === 'service' && !form.vasServiceId) return setError('Pick an extra service.');
    setError(null);
    const saved = await save.run({
      id: form.id,
      version: form.version,
      jobTypeId: form.scope === 'job_type' ? form.jobTypeId : null,
      vasServiceId: form.scope === 'service' ? form.vasServiceId : null,
      clientId: form.clientId === 'all' ? null : form.clientId,
      laborClassId: form.laborClassId === 'all' ? null : form.laborClassId,
      unitsPerLaborHour: String(pace),
      effectiveFrom: form.effectiveFrom,
      basis: form.basis,
      note: form.note.trim() || null,
    });
    if (!saved) return;
    toast.success(
      form.id ? 'Target saved' : 'Target added',
      'Jobs it applies to were checked against it again.',
    );
    onClose();
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="md">
        <DialogHeader
          title={form.id ? 'Edit the target pace' : 'Add a target pace'}
          description="How many units one person should finish in an hour."
          icon={<Target aria-hidden />}
        />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            {services.length > 0 ? (
              <ToggleGroup
                label="What the target is for"
                value={form.scope}
                onValueChange={(scope) => set({ scope })}
                options={[
                  { value: 'job_type', label: 'A job type' },
                  { value: 'service', label: 'An extra service' },
                ]}
              />
            ) : null}
            {form.scope === 'job_type' ? (
              <Field label="Job type" required>
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={form.jobTypeId || undefined}
                    onValueChange={(jobTypeId) => set({ jobTypeId })}
                    options={jobTypes
                      .filter((type) => !type.archivedAt || type.id === form.jobTypeId)
                      .map((type) => ({ value: type.id, label: type.name }))}
                    placeholder="Pick a job type"
                  />
                )}
              </Field>
            ) : (
              <Field label="Extra service" required>
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={form.vasServiceId || undefined}
                    onValueChange={(vasServiceId) => set({ vasServiceId })}
                    options={services}
                    placeholder="Pick an extra service"
                  />
                )}
              </Field>
            )}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Client" hint="Pick one for a client that runs faster or slower.">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={form.clientId}
                    onValueChange={(clientId) => set({ clientId })}
                    options={[{ value: 'all', label: 'All clients' }, ...clients]}
                  />
                )}
              </Field>
              <Field label="Labor class">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={form.laborClassId}
                    onValueChange={(laborClassId) => set({ laborClassId })}
                    options={[
                      { value: 'all', label: 'All classes' },
                      ...laborClasses
                        .filter((item) => !item.archivedAt)
                        .map((item) => ({ value: item.id, label: item.name })),
                    ]}
                  />
                )}
              </Field>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Units per person per hour" required>
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    inputMode="decimal"
                    value={form.pace}
                    onChange={(event) => set({ pace: event.target.value })}
                    placeholder="42"
                    className="text-right tabular-nums"
                    autoFocus
                  />
                )}
              </Field>
              <Field label="Starts on" hint="Days before it keep the older target.">
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
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Where it came from">
                {({ inputId }) => (
                  <Select
                    id={inputId}
                    value={form.basis}
                    onValueChange={(basis) => set({ basis: basis as StandardForm['basis'] })}
                    options={[
                      { value: 'typed', label: 'Typed in' },
                      { value: 'history', label: 'From history' },
                      { value: 'time_study', label: 'Time study' },
                    ]}
                  />
                )}
              </Field>
              <Field label="Note">
                {({ inputId }) => (
                  <Input
                    id={inputId}
                    value={form.note}
                    maxLength={500}
                    onChange={(event) => set({ note: event.target.value })}
                  />
                )}
              </Field>
            </div>
            {error ? (
              <p role="alert" className="text-sm text-danger-text">
                {error}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={save.pending}>
              {form.id ? 'Save' : 'Add the target'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

type BoardTab = 'job' | 'class' | 'day';

/** The pace board the server read for the days the page opens on. */
export interface InitialBoard {
  readonly from: string;
  readonly to: string;
  readonly board: PaceBoardDTO;
}

function PaceBoard({
  sites,
  today,
  thresholds,
  canManage,
  initial,
}: {
  readonly sites: readonly SiteDTO[];
  readonly today: string;
  readonly thresholds: PaceThresholds;
  readonly canManage: boolean;
  readonly initial?: InitialBoard;
}) {
  const { state, setState } = useRange(today, 'last_30');
  const [tab, setTab] = useState<BoardTab>('job');
  const fromServer = Boolean(initial) && state.from === initial?.from && state.to === initial?.to && !state.siteId;
  const board = usePaceBoard({ from: state.from, to: state.to, siteId: state.siteId }, { initialData: fromServer ? initial?.board : undefined });
  const [jobTarget, setJobTarget] = useState<PaceBoardDTO['byJob'][number] | null>(null);
  const data = board.data;
  const rows: readonly PaceBoardRowDTO[] = data
    ? tab === 'job'
      ? data.byJob
      : tab === 'class'
        ? data.byClass
        : data.byDay
    : [];

  return (
    <Panel title="Pace against target" bodyClassName="p-0">
      <div className="flex flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-3">
        <ToggleGroup
          label="Group the pace by"
          value={tab}
          onValueChange={setTab}
          options={[
            { value: 'job', label: 'By job' },
            { value: 'class', label: 'By labor class' },
            { value: 'day', label: 'By day' },
          ]}
        />
        <div className="ml-auto">
          <RangeBar state={state} onChange={setState} sites={sites} today={today} />
        </div>
      </div>
      {board.isLoading ? (
        <div className="p-4" aria-busy="true">
          <Skeleton height={200} className="w-full" />
        </div>
      ) : board.isError ? (
        <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center">
          <p className="text-base font-medium text-fg">We could not load the pace</p>
          <p className="text-sm text-fg-muted">{board.error.message}</p>
          <Button
            variant="secondary"
            leadingIcon={<RefreshCw aria-hidden />}
            onClick={() => void board.refetch()}
          >
            Try again
          </Button>
        </div>
      ) : rows.length === 0 ? (
        <Teach
          icon={Gauge}
          size="sm"
          title="No pace in these days"
          why="Pace needs two things on the same day: units finished and labor hours. Log both on the day grid, and each job shows here against its target."
          actions={<ButtonLink href={routes.log()}>Log work</ButtonLink>}
        />
      ) : (
        <>
          {tab === 'day' && data ? (
            <div className="px-4 pt-4">
              <LineChart
                title="Pace as a share of target, by day"
                description="100% means the crews ran right at their target pace. Each job is measured against its own target."
                dates={data.byDay.map((row) => row.key)}
                bucket="day"
                format="percent"
                height={220}
                tableToggle
                target={{ value: 10000, label: 'Target' }}
                series={[
                  {
                    id: 'pace',
                    label: 'Share of target pace',
                    values: data.byDay.map((row) => row.productivityBp),
                  },
                ]}
              />
            </div>
          ) : null}
          <div>
            <Table className="min-w-[760px]" aria-label="Pace against target by job">
              <TableHead>
                <TableRow className="hover:bg-transparent">
                  <TableHeaderCell>
                    {tab === 'job' ? 'Job' : tab === 'class' ? 'Labor class' : 'Day'}
                  </TableHeaderCell>
                  <TableHeaderCell numeric>Units good</TableHeaderCell>
                  <TableHeaderCell numeric>Labor hours</TableHeaderCell>
                  <TableHeaderCell numeric>Pace</TableHeaderCell>
                  <TableHeaderCell numeric>
                    <span className="inline-flex items-center gap-1">
                      Target
                      {tab !== 'job' ? (
                        <Popover>
                          <PopoverTrigger asChild>
                            <IconButton
                              label="How the target of a mix of jobs is made"
                              icon={<Info aria-hidden />}
                              size="sm"
                              variant="ghost"
                            />
                          </PopoverTrigger>
                          <PopoverContent
                            align="end"
                            className="w-80 max-w-[calc(100vw-32px)] text-left text-sm font-normal text-fg-secondary"
                          >
                            <h3 className="mb-1 text-sm font-semibold text-fg">How we got this</h3>
                            <p>
                              A {tab === 'class' ? 'labor class' : 'day'} covers many jobs, each with its own
                              target. Pulse works out the hours those units should have taken at each job’s
                              target, then divides the units by those hours.
                            </p>
                            <p className="mt-1">
                              The share of target is those hours divided by the labor hours that were logged.
                              Jobs with no target are left out of it.
                            </p>
                          </PopoverContent>
                        </Popover>
                      ) : null}
                    </span>
                  </TableHeaderCell>
                  <TableHeaderCell className="w-52">Share of target</TableHeaderCell>
                  {tab === 'job' && canManage ? (
                    <TableHeaderCell className="w-12">
                      <span className="sr-only">Set a target for the job</span>
                    </TableHeaderCell>
                  ) : null}
                </TableRow>
              </TableHead>
              <TableBody>
                {rows.map((row) => {
                  const tone = paceTone(row.productivityBp, thresholds);
                  const job = tab === 'job' ? data?.byJob.find((item) => item.key === row.key) : undefined;
                  return (
                    <TableRow key={row.key} data-testid="pace-row">
                      <TableCell className="max-w-[320px]">
                        {job ? (
                          <Link
                            href={routes.job(job.jobId)}
                            className="block truncate hover:text-fg-link hover:underline"
                            title={row.label}
                          >
                            {row.label}
                          </Link>
                        ) : (
                          <span className="block truncate">{row.label}</span>
                        )}
                        {row.sublabel ? (
                          <span className="block truncate text-xs text-fg-muted">{row.sublabel}</span>
                        ) : null}
                      </TableCell>
                      <TableCell numeric>{formatNumber(row.unitsGood, { maxDigits: 0 })}</TableCell>
                      <TableCell numeric>{formatHours(row.paceHours)}</TableCell>
                      <TableCell numeric className="font-medium">
                        {row.uph ? formatPace(row.uph) : ''}
                      </TableCell>
                      <TableCell numeric>
                        {row.targetUph ? (
                          formatPace(row.targetUph)
                        ) : (
                          <span className="text-fg-muted">None</span>
                        )}
                        {job?.jobTargetUph ? (
                          <span className="block text-xs text-fg-muted">Set on the job</span>
                        ) : null}
                      </TableCell>
                      <TableCell>
                        {row.uph && row.targetUph ? (
                          <div className="flex items-center gap-2">
                            <BulletChart
                              label={`Pace of ${row.label}`}
                              value={Number(row.uph)}
                              target={Number(row.targetUph)}
                              size="sm"
                              format="number"
                              className="min-w-0 flex-1"
                            />
                            <span
                              className={cn(
                                'w-12 shrink-0 text-right text-sm font-medium tabular-nums',
                                TONE_TEXT[tone],
                              )}
                            >
                              {formatPercentBp(row.productivityBp, { digits: 0 })}
                            </span>
                          </div>
                        ) : (
                          <span className="text-xs text-fg-muted">
                            {row.targetUph ? 'No units yet' : 'No target to compare'}
                          </span>
                        )}
                      </TableCell>
                      {tab === 'job' && canManage && job ? (
                        <TableCell>
                          <IconButton
                            label={`Set a target pace for ${row.label}`}
                            icon={<Target aria-hidden />}
                            size="sm"
                            variant="ghost"
                            onClick={() => setJobTarget(job)}
                          />
                        </TableCell>
                      ) : null}
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
          <p className="border-t border-border-subtle px-4 py-2 text-xs text-fg-muted">
            Pace is units good divided by labor hours. Setup hours and hours that still need a check are left
            out, so a setup day does not make a job look slow.
          </p>
        </>
      )}
      {jobTarget ? (
        <JobTargetDialog key={jobTarget.jobId} job={jobTarget} onClose={() => setJobTarget(null)} />
      ) : null}
    </Panel>
  );
}

function JobTargetDialog({
  job,
  onClose,
}: {
  readonly job: PaceBoardDTO['byJob'][number];
  readonly onClose: () => void;
}) {
  const [pace, setPace] = useState(() => (job.jobTargetUph ? String(Number(job.jobTargetUph)) : ''));
  const [error, setError] = useState<string | null>(null);
  const update = useServerAction(updateJobAction, {
    invalidate: INVALIDATE,
    silentError: true,
    onError: (problem) => setError(problem.message),
  });

  async function save(value: string | null) {
    if (value !== null && !(Number(value) > 0))
      return setError('Type a pace above zero, or clear the job target.');
    setError(null);
    const before = job.jobTargetUph;
    const saved = await update.run({ jobId: job.jobId, patch: { standardUph: value } });
    if (!saved) return;
    onClose();
    toast.undo(
      value
        ? `${saved.number} now has its own target of ${formatPace(value)}`
        : `${saved.number} follows its job type again`,
      {
        onUndo: async () =>
          void (await update.run({
            jobId: job.jobId,
            patch: { standardUph: before ? String(Number(before)) : null },
          })),
      },
    );
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent size="sm">
        <DialogHeader title="Target pace for one job" description={job.label} icon={<Target aria-hidden />} />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void save(pace.replace(/,/g, '').trim());
          }}
        >
          <DialogBody className="flex flex-col gap-3">
            <p className="text-sm text-fg-secondary">
              A target on the job beats the target of its job type. This job ran at{' '}
              {job.uph ? formatPace(job.uph) : 'no pace yet'} {job.unitLabel} per person per hour in these
              days
              {job.targetUph && !job.jobTargetUph
                ? `, against ${formatPace(job.targetUph)} from its job type`
                : ''}
              .
            </p>
            <Field label={`Units per person per hour`} error={error}>
              {({ inputId, invalid }) => (
                <Input
                  id={inputId}
                  invalid={invalid}
                  inputMode="decimal"
                  value={pace}
                  onChange={(event) => setPace(event.target.value)}
                  className="text-right tabular-nums"
                  autoFocus
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            {job.jobTargetUph ? (
              <Button
                type="button"
                variant="tertiary"
                className="mr-auto"
                onClick={() => void save(null)}
                loading={update.pending}
              >
                Clear the job target
              </Button>
            ) : null}
            <Button type="button" variant="tertiary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={update.pending}>
              Save
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
