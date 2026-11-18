'use client';
/**
 * Goals: what you are aiming for next to what really happened. One card per goal with the
 * number, a bar against the goal, the pace to the goal for money goals, a six month trend and
 * "how we got this". Managers add, change and delete goals; every change has Undo.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, ChevronRight, CircleCheck, CircleDashed, FileSpreadsheet, Pencil, Plus, Target, Trash2, TriangleAlert, Tv } from 'lucide-react';
import { Badge, Button, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, IconButton, Input, ProgressBar, Select, Skeleton, ToggleGroup, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { BulletChart } from '@/components/charts/bullet';
import { Sparkline } from '@/components/charts/sparkline';
import { ButtonLink } from '@/components/pulse/button-link';
import { Teach } from '@/components/pulse/teach';
import { How, type HowLine } from '@/features/calculator/how';
import { apiGet, apiPath } from '@/lib/api-client';
import { TARGET_METRICS, type TargetMetric, type TargetScope } from '@/lib/constants';
import { addMonths } from '@/lib/profit/calendar';
import { routes } from '@/lib/routes';
import { deleteTargetAction, saveTargetAction } from '@/server/actions/planning';
import type { GoalRowDTO, GoalsBoardDTO } from '@/server/domain/goals';
import { GOAL_UNIT_SUFFIX, formatGoalGap, formatGoalNumber, goalChartFormat, goalSentence, monthLabel, monthShort, monthWord } from './goal-format';
import { GOAL_METRICS, GOAL_SCOPE_LABELS, GOAL_STATUS_LABELS, goalToNatural, readGoal, typedGoalToStored, type GoalStatus } from './goal-math';

const goalsKey = (month: string) => ['goals', 'board', month.slice(0, 7)] as const;

const STATUS_TONE: Readonly<Record<GoalStatus, 'success' | 'warning' | 'danger' | 'neutral'>> = { ahead: 'success', close: 'warning', behind: 'danger', no_data: 'neutral' };
const STATUS_ICON = { ahead: CircleCheck, close: TriangleAlert, behind: TriangleAlert, no_data: CircleDashed } as const;
const SCOPE_HEADINGS: Readonly<Record<TargetScope, string>> = { org: 'Whole company', site: 'By site', client: 'By client', job_type: 'By job type', vas_service: 'By extra service' };

interface Draft {
  readonly id: string | null;
  readonly scope: TargetScope;
  readonly scopeId: string | null;
  readonly metric: TargetMetric;
  readonly typed: string;
  readonly everyMonth: boolean;
}

const EMPTY_DRAFT: Draft = { id: null, scope: 'org', scopeId: null, metric: 'margin_pct', typed: '', everyMonth: true };

/** A stored value as a person would type it: "28" not "28.0000". */
const tidy = (value: string | null): string => (value === null ? '' : String(Number(value)));

export function GoalsView({ initial }: { readonly initial: GoalsBoardDTO }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(initial.month);
  const query = useQuery({
    queryKey: goalsKey(month),
    queryFn: () => apiGet<GoalsBoardDTO>(apiPath('goals/board', { month: month.slice(0, 7) })),
    initialData: month === initial.month ? initial : undefined,
    staleTime: 30_000,
    placeholderData: (previous) => previous,
  });
  const board = query.data;
  const [draft, setDraft] = useState<Draft | null>(null);

  const go = (next: string) => {
    setMonth(next);
    router.replace(next === initial.today.slice(0, 7) + '-01' ? routes.goals() : `${routes.goals()}?month=${next.slice(0, 7)}`, { scroll: false });
  };
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['goals'] });

  /** Shows a changed goal at once, with the reading worked out by the same pure math as the server. */
  const patchRow = (id: string, stored: string) => {
    queryClient.setQueryData<GoalsBoardDTO>(goalsKey(month), (current) => {
      if (!current) return current;
      return {
        ...current,
        rows: current.rows.map((row) => {
          if (row.id !== id) return row;
          const goal = goalToNatural(row.metric, stored);
          const reading = readGoal({ metric: row.metric, goal, actual: row.actual, elapsedWorkDays: current.elapsedWorkDays, totalWorkDays: current.totalWorkDays });
          return { ...row, value: stored, goal, ...reading };
        }),
      };
    });
  };

  const remove = async (row: GoalRowDTO) => {
    const previous = queryClient.getQueryData<GoalsBoardDTO>(goalsKey(month));
    queryClient.setQueryData<GoalsBoardDTO>(goalsKey(month), (current) => (current ? { ...current, rows: current.rows.filter((item) => item.id !== row.id) } : current));
    const result = await deleteTargetAction({ id: row.id });
    if (!result.ok) {
      queryClient.setQueryData(goalsKey(month), previous);
      toast.error("Couldn't delete the goal", result.error.message);
      return;
    }
    toast.undo('Goal deleted', {
      description: `${GOAL_METRICS[row.metric].label}, ${row.scopeLabel}`,
      onUndo: async () => {
        const back = await saveTargetAction({ scope: row.scope, scopeId: row.scopeId, metric: row.metric, periodMonth: row.everyMonth ? null : month, value: row.value ?? '0' });
        if (!back.ok) throw new Error(back.error.message);
        await refresh();
      },
    });
    await refresh();
  };

  if (!board) {
    if (query.isError) return <GoalsError message={query.error instanceof Error ? query.error.message : null} onRetry={() => void query.refetch()} />;
    return <GoalsSkeleton />;
  }

  const groups = (['org', 'site', 'client', 'job_type', 'vas_service'] as const).map((scope) => ({ scope, rows: board.rows.filter((row) => row.scope === scope) })).filter((group) => group.rows.length > 0);
  const counts = { ahead: 0, close: 0, behind: 0, no_data: 0 } as Record<GoalStatus, number>;
  for (const row of board.rows) counts[row.status] += 1;
  const monthDoneBp = board.totalWorkDays > 0 ? Math.round((board.elapsedWorkDays / board.totalWorkDays) * 10000) : 0;
  const thisMonth = `${board.today.slice(0, 7)}-01`;

  return (
    <div className="flex flex-col gap-5" data-testid="goals">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-1.5" role="group" aria-label="Month">
          <IconButton label="Month before" variant="outline" icon={<ChevronLeft aria-hidden />} onClick={() => go(addMonths(month, -1))} data-testid="goals-prev" />
          <span className="min-w-[9.5rem] text-center text-md font-semibold text-fg tabular-nums" aria-live="polite" data-testid="goals-month">
            {monthLabel(month)}
          </span>
          <IconButton label="Month after" variant="outline" icon={<ChevronRight aria-hidden />} onClick={() => go(addMonths(month, 1))} data-testid="goals-next" />
          {month !== thisMonth ? (
            <Button variant="ghost" size="sm" onClick={() => go(thisMonth)}>
              This month
            </Button>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <ButtonLink href={routes.wall()} variant="ghost" icon={<Tv aria-hidden />} testId="goals-wall">
            Wall display
          </ButtonLink>
          {board.canManage ? (
            <>
              <ButtonLink href={routes.newImport('goals')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                Import goals
              </ButtonLink>
              <Button leadingIcon={<Plus aria-hidden />} onClick={() => setDraft(EMPTY_DRAFT)} data-testid="goal-add">
                Add a goal
              </Button>
            </>
          ) : null}
        </div>
      </div>

      {query.isError ? <p role="alert" className="rounded-lg border border-border-subtle bg-danger-subtle px-3 py-2 text-sm text-danger-text">We could not refresh the goals. You are looking at the last numbers we loaded.</p> : null}

      {board.rows.length === 0 ? (
        <section className="rounded-xl border border-border-subtle bg-panel shadow-xs">
          <Teach
            icon={Target}
            title={`No goals for ${monthLabel(month)}`}
            why="A goal is a number to aim for, like a 30 percent margin or 40 units per person per hour. Set one for the whole company, a site, a client or a job type. Pulse then shows green, amber or red against it, and tells you if the month is on pace."
            points={['Margin, profit, revenue, pace, cost per unit and more', 'A goal for every month, or for one month only', 'Pace to goal: where you should be by today, and where the month will land']}
            actions={
              board.canManage ? (
                <>
                  <Button leadingIcon={<Plus aria-hidden />} onClick={() => setDraft(EMPTY_DRAFT)} data-testid="goal-add-empty">
                    Add your first goal
                  </Button>
                  <ButtonLink href={routes.newImport('goals')} variant="secondary" icon={<FileSpreadsheet aria-hidden />}>
                    Import from a spreadsheet
                  </ButtonLink>
                </>
              ) : (
                <ButtonLink href={routes.jobs()} variant="secondary">
                  Open jobs
                </ButtonLink>
              )
            }
            footnote={board.canManage ? 'Most teams start with one margin goal for the whole company.' : 'A manager sets the goals. You will see progress against them here.'}
            testId="goals-empty"
          />
        </section>
      ) : (
        <>
          <section aria-label="This month at a glance" className="grid gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs sm:grid-cols-[minmax(0,1fr)_auto] sm:items-center">
            <div className="min-w-0">
              <p className="text-sm font-medium text-fg" data-testid="goals-pace">
                {board.isFuture
                  ? `${monthWord(month)} has not started. It has ${board.totalWorkDays} work days.`
                  : board.isCurrentMonth
                    ? `Work day ${board.elapsedWorkDays} of ${board.totalWorkDays} in ${monthWord(month)}`
                    : `${monthWord(month)} is over. It had ${board.totalWorkDays} work days.`}
              </p>
              <ProgressBar value={monthDoneBp / 100} label="Share of the month's work days that are done" className="mt-2" />
              <p className="mt-1.5 text-xs text-fg-muted">{"Money goals are checked against the pace: by now you should have this share of the month's goal."}</p>
            </div>
            <ul className="flex flex-wrap gap-2" aria-label="Goals by status">
              {(['ahead', 'close', 'behind', 'no_data'] as const).map((status) =>
                counts[status] > 0 ? (
                  <li key={status}>
                    <Badge tone={STATUS_TONE[status]} size="md">
                      {counts[status]} {GOAL_STATUS_LABELS[status].toLowerCase()}
                    </Badge>
                  </li>
                ) : null,
              )}
            </ul>
          </section>

          {groups.map((group) => (
            <section key={group.scope} aria-labelledby={`goals-${group.scope}`} className="flex flex-col gap-3">
              <h2 id={`goals-${group.scope}`} className="text-sm font-semibold text-fg-secondary">
                {SCOPE_HEADINGS[group.scope]}
              </h2>
              <ul className={cn('grid gap-3 lg:grid-cols-2', query.isFetching && query.isPlaceholderData && 'opacity-60')}>
                {group.rows.map((row) => (
                  <li key={row.id} className="min-w-0">
                    <GoalCard
                      row={row}
                      board={board}
                      onEdit={() => setDraft({ id: row.id, scope: row.scope, scopeId: row.scopeId, metric: row.metric, typed: tidy(row.value), everyMonth: row.everyMonth })}
                      onDelete={() => void remove(row)}
                    />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </>
      )}

      {draft ? (
        <GoalDialog
          key={draft.id ?? 'new'}
          draft={draft}
          board={board}
          onClose={() => setDraft(null)}
          onSaved={async (saved, before) => {
            if (before) patchRow(before.id, saved.value);
            setDraft(null);
            await refresh();
            if (before) {
              toast.undo('Goal changed', {
                description: `${GOAL_METRICS[before.metric].label}, ${before.scopeLabel}`,
                onUndo: async () => {
                  // A goal that was moved to "this month only" made a new row: take that one away again.
                  const undone = saved.id !== before.id ? await deleteTargetAction({ id: saved.id }) : await saveTargetAction({ scope: before.scope, scopeId: before.scopeId, metric: before.metric, periodMonth: before.everyMonth ? null : month, value: before.value ?? '0' });
                  if (!undone.ok) throw new Error(undone.error.message);
                  await refresh();
                },
              });
            } else {
              toast.undo('Goal added', {
                onUndo: async () => {
                  const undone = await deleteTargetAction({ id: saved.id });
                  if (!undone.ok) throw new Error(undone.error.message);
                  await refresh();
                },
              });
            }
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ one goal */

function GoalCard({ row, board, onEdit, onDelete }: { readonly row: GoalRowDTO; readonly board: GoalsBoardDTO; readonly onEdit: () => void; readonly onDelete: () => void }) {
  const info = GOAL_METRICS[row.metric];
  const Icon = STATUS_ICON[row.status];
  const goalText = formatGoalNumber(row.metric, row.goal, 'Hidden');
  const actualText = row.hidden ? 'Hidden' : formatGoalNumber(row.metric, row.actual);
  const gapText = formatGoalGap(row.metric, row.gap);
  const month = monthWord(board.month);

  const lines: HowLine[] = [];
  if (info.kind === 'sum') {
    lines.push({ label: `Goal for ${month}`, value: goalText, op: 'start' });
    if (board.totalWorkDays > 0) lines.push({ label: `work days done, out of ${board.totalWorkDays}`, value: String(board.elapsedWorkDays), op: 'times' });
    lines.push({ label: board.isCurrentMonth ? 'where you should be by today' : 'the goal by the end of the month', value: formatGoalNumber(row.metric, row.expected), op: 'total' });
    lines.push({ label: `${info.label} so far`, value: actualText, op: 'note' });
    if (gapText) lines.push({ label: 'Against the pace', value: gapText, op: 'note' });
    if (row.projected !== null && board.isCurrentMonth) lines.push({ label: 'Month end, if the days left go like the days so far', value: formatGoalNumber(row.metric, row.projected), op: 'note' });
  } else {
    lines.push({ label: `${info.label} in ${month}`, value: actualText, op: 'start' });
    lines.push({ label: info.better === 'up' ? 'the goal, at least' : 'the goal, at most', value: goalText, op: 'minus' });
    lines.push({ label: 'gap to the goal', value: gapText ?? 'No numbers yet', op: 'total' });
  }
  const warnings: string[] = [];
  if (row.actual === null && !row.hidden) warnings.push(board.isFuture ? 'This month has not started, so there is nothing to measure yet.' : 'Nothing was logged for this yet, so there is no number to compare.');
  if (row.status === 'close') warnings.push('Close means within 10 percent of the line.');

  const paceLine = (() => {
    if (row.hidden) return 'Money is hidden for your role, so this goal shows no numbers.';
    if (row.actual === null) return board.isFuture ? 'This month has not started yet.' : 'No numbers yet for this month.';
    if (info.kind === 'sum') {
      if (!board.isCurrentMonth) return gapText ? `The month ended ${gapText.replace('ahead', 'over the goal').replace('behind', 'short of the goal')}.` : null;
      const landing = row.projected !== null ? ` At this pace the month ends near ${formatGoalNumber(row.metric, row.projected)}.` : '';
      return `By today you should be at ${formatGoalNumber(row.metric, row.expected)}. You are ${gapText}.${landing}`;
    }
    if (!gapText) return null;
    const good = row.status === 'ahead';
    return `${gapText.charAt(0).toUpperCase()}${gapText.slice(1)} the goal${good ? ', which is where you want to be' : ''}.`;
  })();

  const trend = row.trend.filter((value) => value !== null).length >= 2 ? row.trend : null;

  return (
    <article className="flex h-full flex-col gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs" data-testid={`goal-${row.metric}-${row.scope}`} data-status={row.status}>
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="truncate text-md font-semibold text-fg">{info.label}</h3>
          <p className="truncate text-xs text-fg-muted">
            {row.scopeLabel} · {row.everyMonth ? 'every month' : `${month} only`}
          </p>
        </div>
        <Badge tone={STATUS_TONE[row.status]} icon={<Icon aria-hidden />}>
          {GOAL_STATUS_LABELS[row.status]}
        </Badge>
      </header>

      <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
        <p className="flex items-center gap-1 text-3xl font-semibold tracking-[-0.02em] text-fg tabular-nums" data-testid="goal-actual">
          {actualText}
          {!row.hidden ? <How title={`${info.label}, ${row.scopeLabel}`} formula={`${info.help} ${info.kind === 'sum' ? 'A money goal is spread evenly over the work days of the month, so you can tell early if you are on pace.' : 'It is compared straight to the goal.'}`} lines={lines} warnings={warnings} align="start" /> : null}
        </p>
        <p className="text-sm text-fg-secondary">
          Goal: {info.better === 'up' ? 'at least' : 'at most'} <span className="font-semibold text-fg tabular-nums" data-testid="goal-value">{goalText}</span>
        </p>
      </div>

      {row.goal !== null && !row.hidden ? (
        <BulletChart label={`${info.label} against the goal`} value={row.actual} target={row.goal} format={goalChartFormat(row.metric)} goodWhen={info.better} targetLabel="Goal" size="sm" />
      ) : null}

      {paceLine ? <p className="text-sm text-fg-secondary" data-testid="goal-pace">{paceLine}</p> : null}

      <footer className="mt-auto flex items-end justify-between gap-3 pt-1">
        {trend ? (
          <div className="min-w-0">
            <Sparkline values={trend} label={`${info.label}, ${monthShort(board.trendMonths[0] ?? board.month)} to ${monthShort(board.month)}`} format={goalChartFormat(row.metric)} width={132} height={32} tone={row.status === 'behind' ? 'bad' : row.status === 'ahead' ? 'good' : 'neutral'} />
            <p className="text-2xs text-fg-muted">Last 6 months</p>
          </div>
        ) : (
          <p className="text-2xs text-fg-muted">The trend shows up after two months of numbers.</p>
        )}
        {board.canManage && !row.hidden ? (
          <div className="flex shrink-0 items-center gap-1">
            <IconButton label={`Change the goal for ${info.label.toLowerCase()}, ${row.scopeLabel}`} variant="ghost" size="sm" onClick={onEdit} data-testid="goal-edit" icon={<Pencil aria-hidden />} />
            <IconButton label={`Delete the goal for ${info.label.toLowerCase()}, ${row.scopeLabel}`} variant="ghost" size="sm" onClick={onDelete} data-testid="goal-delete" icon={<Trash2 aria-hidden />} />
          </div>
        ) : null}
      </footer>
    </article>
  );
}

/* ------------------------------------------------------------------ add or change */

function GoalDialog({
  draft: start,
  board,
  onClose,
  onSaved,
}: {
  readonly draft: Draft;
  readonly board: GoalsBoardDTO;
  readonly onClose: () => void;
  readonly onSaved: (saved: { id: string; value: string }, before: GoalRowDTO | null) => Promise<void>;
}) {
  const [draft, setDraft] = useState(start);
  const [error, setError] = useState<{ field: 'scopeId' | 'value' | 'form'; message: string } | null>(null);
  const [saving, setSaving] = useState(false);
  const editing = start.id !== null;
  const before = editing ? (board.rows.find((row) => row.id === start.id) ?? null) : null;
  const info = GOAL_METRICS[draft.metric];

  const metricOptions = useMemo(
    () => TARGET_METRICS.filter((metric) => GOAL_METRICS[metric].scopes.includes(draft.scope) && !(board.moneyHidden && GOAL_METRICS[metric].needsMoney)).map((metric) => ({ value: metric, label: GOAL_METRICS[metric].label, description: GOAL_METRICS[metric].help })),
    [draft.scope, board.moneyHidden],
  );
  const scopeChoices = useMemo(() => {
    const lists: Record<TargetScope, readonly { id: string; name: string }[]> = { org: [], site: board.options.sites, client: board.options.clients, job_type: board.options.jobTypes, vas_service: board.options.services };
    return lists;
  }, [board.options]);
  const scopeOptions = (['org', 'site', 'client', 'job_type', 'vas_service'] as const).filter((scope) => scope === 'org' || scopeChoices[scope].length > 0).map((scope) => ({ value: scope, label: GOAL_SCOPE_LABELS[scope] }));
  const entityOptions = scopeChoices[draft.scope].map((item) => ({ value: item.id, label: item.name }));
  const scopeLabel = draft.scope === 'org' ? 'Whole company' : (scopeChoices[draft.scope].find((item) => item.id === draft.scopeId)?.name ?? 'the one you pick');
  const stored = typedGoalToStored(draft.metric, draft.typed);
  const natural = stored === null ? null : goalToNatural(draft.metric, stored);

  // One goal per thing, measure and month: say so before a save quietly changes or hides one.
  const twin = editing ? null : (board.rows.find((row) => row.scope === draft.scope && row.scopeId === draft.scopeId && row.metric === draft.metric) ?? null);
  const clash = !twin
    ? null
    : twin.everyMonth === draft.everyMonth
      ? `You already have this goal (${formatGoalNumber(twin.metric, twin.goal, 'hidden')}). Saving will change it.`
      : draft.everyMonth
        ? `${monthWord(board.month)} already has its own goal (${formatGoalNumber(twin.metric, twin.goal, 'hidden')}), and that one wins this month. This goal will count in the other months.`
        : `This will take the place of the every month goal (${formatGoalNumber(twin.metric, twin.goal, 'hidden')}) for ${monthWord(board.month)} only.`;

  const setScope = (scope: TargetScope) => {
    const metric = GOAL_METRICS[draft.metric].scopes.includes(scope) ? draft.metric : 'margin_pct';
    setDraft({ ...draft, scope, scopeId: scope === 'org' ? null : (scopeChoices[scope][0]?.id ?? null), metric });
    setError(null);
  };

  const submit = async () => {
    if (draft.scope !== 'org' && !draft.scopeId) return setError({ field: 'scopeId', message: 'Pick what this goal is for.' });
    if (stored === null) return setError({ field: 'value', message: info.unit === 'percent' ? 'Type a number from 1 to 100, like 28.' : info.unit === 'pace' ? 'Type a number above zero, like 40.' : info.unit === 'money_per_unit' ? 'Type a number above zero, like 1.25.' : 'Type a number above zero, like 95000.' });
    setSaving(true);
    setError(null);
    try {
      const result = await saveTargetAction({ scope: draft.scope, scopeId: draft.scopeId, metric: draft.metric, periodMonth: draft.everyMonth ? null : board.month, value: stored });
      if (!result.ok) {
        setError({ field: result.error.fields?.scopeId ? 'scopeId' : result.error.fields?.value ? 'value' : 'form', message: result.error.message });
        return;
      }
      await onSaved({ id: result.data.id, value: stored }, before);
    } catch {
      setError({ field: 'form', message: 'Check your connection and try again.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogContent size="md" data-testid="goal-dialog">
        <DialogHeader title={editing ? 'Change this goal' : 'Add a goal'} description="A goal is one sentence: what to measure, the number to hit, and who it is for." />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <DialogBody className="flex flex-col gap-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Who is it for">{({ inputId }) => <Select id={inputId} value={draft.scope} onValueChange={(value) => setScope(value as TargetScope)} options={scopeOptions} disabled={editing} />}</Field>
              {draft.scope !== 'org' ? (
                <Field label={`Which ${GOAL_SCOPE_LABELS[draft.scope].toLowerCase()}`} error={error?.field === 'scopeId' ? error.message : null}>
                  {({ inputId, invalid }) => <Select id={inputId} value={draft.scopeId ?? undefined} onValueChange={(value) => setDraft({ ...draft, scopeId: value })} options={entityOptions} placeholder="Pick one" invalid={invalid} disabled={editing} />}
                </Field>
              ) : null}
            </div>
            <Field label="What to measure" hint={info.help}>
              {({ inputId, describedBy }) => <Select id={inputId} aria-describedby={describedBy} value={draft.metric} onValueChange={(value) => setDraft({ ...draft, metric: value as TargetMetric })} options={metricOptions} disabled={editing} />}
            </Field>
            <Field label={info.phrase} error={error?.field === 'value' ? error.message : null} hint={`In ${GOAL_UNIT_SUFFIX[info.unit]}.`} required>
              {({ inputId, describedBy, invalid }) => (
                <Input
                  id={inputId}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  inputMode="decimal"
                  autoFocus
                  value={draft.typed}
                  onChange={(event) => {
                    setDraft({ ...draft, typed: event.target.value });
                    setError(null);
                  }}
                  placeholder={info.unit === 'percent' ? '28' : info.unit === 'money' ? '95000' : info.unit === 'pace' ? '40' : '1.85'}
                  data-testid="goal-value-input"
                />
              )}
            </Field>
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-medium text-fg">When</span>
              <ToggleGroup
                label="When the goal counts"
                value={draft.everyMonth ? 'every' : 'month'}
                onValueChange={(value) => setDraft({ ...draft, everyMonth: value === 'every' })}
                options={[
                  { value: 'every', label: 'Every month' },
                  { value: 'month', label: `${monthLabel(board.month)} only` },
                ]}
              />
              <span className="text-xs text-fg-muted">A goal for one month wins over the every month goal for that month.</span>
            </div>
            {clash ? (
              <p className="flex items-start gap-2 rounded-lg bg-warning-subtle px-3 py-2 text-sm text-warning-text" data-testid="goal-clash">
                <TriangleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
                <span>{clash}</span>
              </p>
            ) : null}
            <p className="rounded-lg border border-border-subtle bg-sunken px-3 py-2.5 text-sm text-fg" data-testid="goal-sentence">
              {goalSentence({ metric: draft.metric, scope: draft.scope, scopeLabel, natural, everyMonth: draft.everyMonth, month: board.month })}
            </p>
            {error?.field === 'form' ? (
              <p role="alert" className="text-sm text-danger-text">
                {error.message}
              </p>
            ) : null}
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" loading={saving} data-testid="goal-save">
              {editing ? 'Save the goal' : 'Add the goal'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ states */

function GoalsSkeleton() {
  return (
    <div role="status" aria-busy="true" className="flex flex-col gap-4" data-testid="goals-loading">
      <span className="sr-only">Loading goals</span>
      <Skeleton height={36} width={280} rounded="lg" />
      <Skeleton height={92} rounded="lg" />
      <div className="grid gap-3 lg:grid-cols-2">
        <Skeleton height={230} rounded="lg" />
        <Skeleton height={230} rounded="lg" />
      </div>
    </div>
  );
}

function GoalsError({ message, onRetry }: { readonly message: string | null; readonly onRetry: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-center gap-3 rounded-xl border border-border-subtle bg-panel px-6 py-10 text-center" data-testid="goals-error">
      <span aria-hidden className="flex size-12 items-center justify-center rounded-2xl bg-danger-subtle text-danger-text">
        <TriangleAlert className="size-6" />
      </span>
      <div>
        <p className="text-md font-semibold text-fg">We could not load the goals</p>
        <p className="mt-1 text-sm text-fg-secondary">{message ?? 'Check your connection and try again.'}</p>
      </div>
      <div className="flex gap-2">
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
        <Link href={routes.home()} className="inline-flex h-8 items-center rounded-md px-3 text-sm font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-focus">
          Back to Home
        </Link>
      </div>
    </div>
  );
}
