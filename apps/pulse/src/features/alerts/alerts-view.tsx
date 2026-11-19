'use client';
/**
 * The alert inbox. Each alert says what happened, why, and the next step, with a link to the job
 * (or client, service or month) behind it. Snooze it, hand it to someone, mark it done or dismiss
 * it, one at a time or many at once. Every change shows at once and has Undo.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlarmClock, ArrowRight, Download, BellOff, BellRing, CalendarClock, Check, CircleAlert, Info, ListChecks, MoreHorizontal, RefreshCw, RotateCcw, TriangleAlert, UserRound, X } from 'lucide-react';
import {
  Badge,
  Button,
  Checkbox,
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
  IsoDatePicker,
  IconButton,
  SearchInput,
  Skeleton,
  Tabs,
  TabsList,
  TabsTrigger,
  UserPicker,
  toast,
} from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { ScrollX } from '@/components/ui/scroll-x';
import { ButtonLink } from '@/components/pulse/button-link';
import { PersonAvatar } from '@/components/pulse/person';
import { Teach } from '@/components/pulse/teach';
import { How } from '@/features/calculator/how';
import { downloadCsv } from '@/features/profit/csv-download';
import { useShell } from '@/features/shell/shell-context';
import { SavedViewsBar } from '@/features/views/saved-views-bar';
import { useUrlState, useUrlText } from '@/features/views/use-url-state';
import { apiGet, apiPath } from '@/lib/api-client';
import { RelativeTime } from '@/components/pulse/local-time';
import { addDaysIso, formatRelative } from '@/lib/dates';
import { formatMoney, formatMoneyPlain } from '@/lib/format';
import { usePeople } from '@/lib/hooks/use-data';
import { shortDate } from '@/lib/profit/calendar';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { AlertDTO } from '@/lib/types';
import { evaluateAlertsAction, updateAlertAction } from '@/server/actions/alerts';
import { bulkUpdateAlertsAction } from '@/server/actions/money-ops';
import { INBOX_TABS, applyChange, bucketOf, changeMessage, inTab, inverseChange, linkLabel, matchesSearch, snoozeChoices, type InboxChange, type InboxTab } from './alert-model';

type Bucket = 'open' | 'snoozed' | 'done';
const bucketKey = (bucket: Bucket) => ['alerts', 'inbox', bucket] as const;

async function fetchBucket(bucket: Bucket): Promise<AlertDTO[]> {
  if (bucket !== 'done') return apiGet<AlertDTO[]>(apiPath('alerts', { status: bucket, limit: 500 }));
  const [resolved, dismissed] = await Promise.all([apiGet<AlertDTO[]>(apiPath('alerts', { status: 'resolved', limit: 200 })), apiGet<AlertDTO[]>(apiPath('alerts', { status: 'dismissed', limit: 200 }))]);
  return [...resolved, ...dismissed].sort((a, b) => (b.resolvedAt ?? '').localeCompare(a.resolvedAt ?? ''));
}

const SEVERITY = {
  critical: { label: 'Urgent', icon: CircleAlert, chip: 'bg-danger-subtle text-danger-text', tone: 'danger' },
  warning: { label: 'Heads up', icon: TriangleAlert, chip: 'bg-warning-subtle text-warning-text', tone: 'warning' },
  info: { label: 'Good to know', icon: Info, chip: 'bg-muted text-icon-strong', tone: 'neutral' },
} as const;

export interface AlertsViewProps {
  readonly initialOpen: readonly AlertDTO[];
  readonly initialSnoozed: readonly AlertDTO[];
  /** Today in the workspace's time zone. Snooze dates count from it. */
  readonly today: string;
  readonly canManageRules: boolean;
}

export function AlertsView({ initialOpen, initialSnoozed, today, canManageRules }: AlertsViewProps) {
  const shell = useShell();
  const router = useRouter();
  const queryClient = useQueryClient();
  const meId = shell.user.id;
  const canAct = shell.can('production:log');
  const canAssign = shell.can('alert:manage');
  // The tab and the search live in the address bar, so a list can be shared and kept as a saved view.
  const url = useUrlState();
  const tabParam = url.get('tab');
  const tab: InboxTab = INBOX_TABS.some((item) => item.id === tabParam) ? (tabParam as InboxTab) : 'open';
  const setTab = (value: InboxTab) => url.set({ tab: value === 'open' ? null : value });
  const [search, setSearch] = useUrlText('q');
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set());
  const [pickDay, setPickDay] = useState<readonly AlertDTO[] | null>(null);
  const [checking, setChecking] = useState(false);

  const open = useQuery({ queryKey: bucketKey('open'), queryFn: () => fetchBucket('open'), initialData: [...initialOpen], staleTime: 20_000, refetchInterval: 60_000 });
  const snoozed = useQuery({ queryKey: bucketKey('snoozed'), queryFn: () => fetchBucket('snoozed'), initialData: [...initialSnoozed], staleTime: 20_000 });
  const done = useQuery({ queryKey: bucketKey('done'), queryFn: () => fetchBucket('done'), enabled: tab === 'done', staleTime: 20_000 });
  const people = usePeople({ enabled: canAssign });
  const peopleById = useMemo(() => new Map((people.data ?? []).map((person) => [person.id, person])), [people.data]);

  const active = tab === 'done' ? done : tab === 'snoozed' ? snoozed : open;
  const inThisTab = useMemo(() => (active.data ?? []).filter((alert) => inTab(alert, tab, meId)), [active.data, tab, meId]);
  const visible = useMemo(() => inThisTab.filter((alert) => matchesSearch(alert, search)), [inThisTab, search]);
  const picked = visible.filter((alert) => selected.has(alert.id));
  const counts = { open: open.data.length, mine: open.data.filter((alert) => alert.assignedTo === meId).length, snoozed: snoozed.data.length, done: done.data?.length };

  const refreshBadges = () => {
    void queryClient.invalidateQueries({ queryKey: qk.badges() });
    void queryClient.invalidateQueries({ queryKey: qk.alertsUnread() });
    router.refresh();
  };

  /** Puts changed alerts into the right cached lists. A list that was never loaded is left alone. */
  const place = (alerts: readonly AlertDTO[]) => {
    const ids = new Set(alerts.map((alert) => alert.id));
    for (const bucket of ['open', 'snoozed', 'done'] as const) {
      queryClient.setQueryData<AlertDTO[]>(bucketKey(bucket), (current) => {
        if (!current) return current;
        const kept = current.filter((alert) => !ids.has(alert.id));
        const incoming = alerts.filter((alert) => bucketOf(alert) === bucket);
        // Keep the place of a row that stays in the list (an assign), put a row that moved in at the top.
        const stay = new Map(incoming.map((alert) => [alert.id, alert]));
        const inPlace = current.map((alert) => stay.get(alert.id) ?? alert).filter((alert) => !ids.has(alert.id) || stay.has(alert.id));
        const moved = incoming.filter((alert) => !current.some((item) => item.id === alert.id));
        return moved.length + inPlace.length === kept.length + incoming.length ? [...moved, ...inPlace] : [...incoming, ...kept];
      });
    }
  };

  const send = async (targets: readonly AlertDTO[], change: InboxChange): Promise<{ ok: true; failed: number } | { ok: false; message: string }> => {
    try {
      if (targets.length === 1) {
        const result = await updateAlertAction({ alertId: targets[0]!.id, change });
        return result.ok ? { ok: true, failed: 0 } : { ok: false, message: result.error.message };
      }
      const result = await bulkUpdateAlertsAction({ alertIds: targets.map((alert) => alert.id), change });
      return result.ok ? { ok: true, failed: result.data.failed } : { ok: false, message: result.error.message };
    } catch {
      return { ok: false, message: 'Check your connection and try again.' };
    }
  };

  const change = async (targets: readonly AlertDTO[], next: InboxChange) => {
    if (targets.length === 0) return;
    const before = targets;
    const now = new Date().toISOString();
    place(before.map((alert) => applyChange(alert, next, now)));
    setSelected(new Set());
    const result = await send(before, next);
    if (!result.ok) {
      place(before);
      toast.error("Couldn't change the alert", result.message);
      return;
    }
    refreshBadges();
    if (result.failed > 0) {
      toast.warning(`${result.failed} ${result.failed === 1 ? 'alert was' : 'alerts were'} not changed`, 'Someone else may have changed them. The list is refreshed.');
      void queryClient.invalidateQueries({ queryKey: ['alerts', 'inbox'] });
    }
    const person = next.action === 'assign' && next.userId ? (peopleById.get(next.userId)?.name ?? null) : null;
    toast.undo(changeMessage(next, before.length, person), {
      description: next.action === 'snooze' ? `Back on ${shortDate(next.until)}.` : next.action === 'dismiss' ? 'It stays quiet while nothing changes.' : before.length === 1 ? before[0]!.title : undefined,
      onUndo: async () => {
        // Each alert goes back to its own earlier state, so group the ones that share an undo.
        const groups = new Map<string, { change: InboxChange; alerts: AlertDTO[] }>();
        for (const alert of before) {
          const inverse = inverseChange(alert, next);
          const key = JSON.stringify(inverse);
          const group = groups.get(key) ?? { change: inverse, alerts: [] };
          group.alerts.push(alert);
          groups.set(key, group);
        }
        place(before);
        for (const group of groups.values()) {
          const undone = await send(group.alerts, group.change);
          if (!undone.ok) {
            void queryClient.invalidateQueries({ queryKey: ['alerts', 'inbox'] });
            throw new Error(undone.message);
          }
        }
        refreshBadges();
      },
    });
  };

  const checkNow = async () => {
    setChecking(true);
    try {
      const result = await evaluateAlertsAction();
      if (!result.ok) {
        toast.error("Couldn't check the rules", result.error.message);
        return;
      }
      await queryClient.invalidateQueries({ queryKey: ['alerts', 'inbox'] });
      refreshBadges();
      const { created, resolved } = result.data;
      toast.success(created === 0 && resolved === 0 ? 'Checked. Nothing new.' : `Checked. ${created} new, ${resolved} cleared on their own.`);
    } catch {
      toast.error("Couldn't check the rules", 'Check your connection and try again.');
    } finally {
      setChecking(false);
    }
  };

  /** The alerts on screen, in the order shown. Money stays out for people who may not see it. */
  const exportCsv = () => {
    const seesMoney = shell.seesMoney;
    const headers = ['Alert', 'What happened', 'Next step', 'How urgent', 'About', ...(seesMoney ? ['Money at stake'] : []), 'Status', 'Assigned to', 'Snoozed until', 'First seen', 'Last seen', 'Done on'];
    const rows = visible.map((alert) => [
      alert.title,
      alert.body,
      alert.nextStep ?? '',
      SEVERITY[alert.severity].label,
      alert.entityLabel ?? '',
      ...(seesMoney ? [alert.impactCents === null ? '' : formatMoneyPlain(alert.impactCents)] : []),
      alert.status === 'open' ? 'Needs you' : alert.status === 'snoozed' ? 'Snoozed' : alert.status === 'dismissed' ? 'Dismissed' : 'Done',
      alert.assignedTo ? (peopleById.get(alert.assignedTo)?.name ?? (alert.assignedTo === meId ? shell.user.name : '')) : '',
      alert.snoozedUntil ?? '',
      alert.firstSeenAt.slice(0, 10),
      alert.lastSeenAt.slice(0, 10),
      alert.resolvedAt ? alert.resolvedAt.slice(0, 10) : '',
    ]);
    downloadCsv(`alerts-${tab}-${today}.csv`, headers, rows);
    toast.success(`Saved ${rows.length} ${rows.length === 1 ? 'alert' : 'alerts'} as a CSV file`);
  };

  const allPicked = visible.length > 0 && picked.length === visible.length;
  const choices = snoozeChoices(today);

  return (
    <div className="flex flex-col gap-4" data-testid="alerts">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs value={tab} onValueChange={(value) => (setTab(value as InboxTab), setSelected(new Set()))}>
          <ScrollX label="Alert lists" tabStop={false} fade="app" className="max-w-full">
          <TabsList variant="pill" aria-label="Alert lists">
            {INBOX_TABS.map((item) => (
              <TabsTrigger key={item.id} value={item.id} variant="pill" count={counts[item.id]} className="shrink-0 whitespace-nowrap" aria-controls="alerts-panel" data-testid={`alerts-tab-${item.id}`}>
                {item.label}
              </TabsTrigger>
            ))}
          </TabsList>
          </ScrollX>
        </Tabs>
        <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
          <SearchInput value={search} onValueChange={setSearch} placeholder="Search alerts" aria-label="Search alerts" containerClassName="min-w-0 flex-1 sm:w-56 sm:flex-none" />
          <Button variant="secondary" leadingIcon={<Download aria-hidden />} onClick={exportCsv} disabled={visible.length === 0} data-testid="alerts-export">
            Export CSV
          </Button>
          {canAct ? (
            <Button variant="secondary" leadingIcon={<RefreshCw aria-hidden />} loading={checking} onClick={() => void checkNow()} data-testid="alerts-check">
              Check now
            </Button>
          ) : null}
        </div>
      </div>
      <SavedViewsBar page="alerts" />

      {active.isError && active.data ? <p role="alert" className="rounded-lg bg-danger-subtle px-3 py-2 text-sm text-danger-text">We could not refresh the alerts. You are looking at the last list we loaded.</p> : null}

      <section id="alerts-panel" role="tabpanel" aria-label={INBOX_TABS.find((item) => item.id === tab)?.label} className="overflow-hidden rounded-xl border border-border-subtle bg-panel shadow-xs">
        {active.isLoading || (!active.data && !active.isError) ? (
          <div role="status" aria-busy="true" className="flex flex-col gap-3 p-4" data-testid="alerts-loading">
            <span className="sr-only">Loading alerts</span>
            <Skeleton height={84} rounded="lg" />
            <Skeleton height={84} rounded="lg" />
            <Skeleton height={84} rounded="lg" />
          </div>
        ) : !active.data ? (
          <div role="alert" className="flex flex-col items-center gap-3 px-6 py-10 text-center" data-testid="alerts-error">
            <p className="text-md font-semibold text-fg">We could not load these alerts</p>
            <p className="text-sm text-fg-secondary">{active.error instanceof Error ? active.error.message : 'Check your connection and try again.'}</p>
            <Button variant="secondary" onClick={() => void active.refetch()}>
              Try again
            </Button>
          </div>
        ) : inThisTab.length === 0 ? (
          <EmptyTab tab={tab} canManageRules={canManageRules} onShowOpen={() => setTab('open')} />
        ) : (
          <>
            {canAct ? (
              <div className={cn('flex min-h-11 flex-wrap items-center gap-2 border-b border-border-subtle px-4 py-2', picked.length > 0 && 'bg-selected')} role="region" aria-label="Change many alerts at once">
                <Checkbox size="sm" aria-label="Pick every alert in this list" checked={allPicked ? true : picked.length > 0 ? 'indeterminate' : false} onCheckedChange={(value) => setSelected(value === true ? new Set(visible.map((alert) => alert.id)) : new Set())} data-testid="alerts-pick-all" />
                {picked.length === 0 ? (
                  <span className="text-sm text-fg-muted">
                    {visible.length} {visible.length === 1 ? 'alert' : 'alerts'}
                    {search ? ` match "${search}"` : tab === 'open' ? ', worst first' : ''}
                  </span>
                ) : (
                  <>
                    <span className="mr-1 text-sm font-medium text-fg" aria-live="polite" data-testid="alerts-picked">
                      {picked.length} picked
                    </span>
                    {tab === 'open' || tab === 'mine' ? (
                      <>
                        <SnoozeMenu choices={choices} onPick={(until) => void change(picked, { action: 'snooze', until })} onPickDay={() => setPickDay(picked)}>
                          <Button size="sm" variant="secondary" leadingIcon={<AlarmClock aria-hidden />} data-testid="alerts-bulk-snooze">
                            Snooze
                          </Button>
                        </SnoozeMenu>
                        {canAssign ? (
                          <UserPicker
                            people={people.data ?? []}
                            meId={meId}
                            value={null}
                            onChange={(userId) => void change(picked, { action: 'assign', userId })}
                            aria-label="Hand the picked alerts to someone"
                            trigger={
                              <Button size="sm" variant="secondary" leadingIcon={<UserRound aria-hidden />} data-testid="alerts-bulk-assign">
                                Assign
                              </Button>
                            }
                          />
                        ) : null}
                        <Button size="sm" variant="secondary" leadingIcon={<Check aria-hidden />} onClick={() => void change(picked, { action: 'resolve' })} data-testid="alerts-bulk-resolve">
                          Mark done
                        </Button>
                        <Button size="sm" variant="ghost" leadingIcon={<BellOff aria-hidden />} onClick={() => void change(picked, { action: 'dismiss' })} data-testid="alerts-bulk-dismiss">
                          Dismiss
                        </Button>
                      </>
                    ) : (
                      <Button size="sm" variant="secondary" leadingIcon={<RotateCcw aria-hidden />} onClick={() => void change(picked, { action: tab === 'snoozed' ? 'unsnooze' : 'reopen' })} data-testid="alerts-bulk-reopen">
                        {tab === 'snoozed' ? 'Bring back now' : 'Open again'}
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
                      Clear
                    </Button>
                  </>
                )}
              </div>
            ) : null}
            {visible.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-10 text-center" data-testid="alerts-no-match">
                <p className="text-md font-semibold text-fg">{`No alert matches "${search}"`}</p>
                <p className="text-sm text-fg-secondary">Try a job number, a client name or one word of what happened.</p>
                <Button variant="secondary" onClick={() => setSearch('')}>
                  Clear the search
                </Button>
              </div>
            ) : (
              <ul className="divide-y divide-border-subtle" data-testid="alerts-list">
                {visible.map((alert) => (
                  <AlertRow
                    key={alert.id}
                    alert={alert}
                    canAct={canAct}
                    canAssign={canAssign}
                    picked={selected.has(alert.id)}
                    onPick={(value) =>
                      setSelected((current) => {
                        const next = new Set(current);
                        if (value) next.add(alert.id);
                        else next.delete(alert.id);
                        return next;
                      })
                    }
                    people={people.data ?? []}
                    meId={meId}
                    choices={choices}
                    onChange={(next) => void change([alert], next)}
                    onPickDay={() => setPickDay([alert])}
                  />
                ))}
              </ul>
            )}
          </>
        )}
      </section>

      <p className="text-xs text-fg-muted">
        Pulse checks every rule when numbers change and at least once an hour. An alert clears on its own when the problem is gone.{' '}
        <Link href={routes.alertRules()} className="text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
          See the rules
        </Link>
      </p>

      {pickDay ? (
        <PickDayDialog
          today={today}
          count={pickDay.length}
          onCancel={() => setPickDay(null)}
          onPick={(until) => {
            const targets = pickDay;
            setPickDay(null);
            void change(targets, { action: 'snooze', until });
          }}
        />
      ) : null}
    </div>
  );
}

/* ------------------------------------------------------------------ one alert */

function AlertRow({
  alert,
  canAct,
  canAssign,
  picked,
  onPick,
  people,
  meId,
  choices,
  onChange,
  onPickDay,
}: {
  readonly alert: AlertDTO;
  readonly canAct: boolean;
  readonly canAssign: boolean;
  readonly picked: boolean;
  readonly onPick: (value: boolean) => void;
  readonly people: readonly { readonly id: string; readonly name: string; readonly email: string; readonly image?: string | null }[];
  readonly meId: string;
  readonly choices: ReturnType<typeof snoozeChoices>;
  readonly onChange: (change: InboxChange) => void;
  readonly onPickDay: () => void;
}) {
  const severity = SEVERITY[alert.severity];
  const Icon = severity.icon;
  const isOpen = alert.status === 'open';
  const stake = alert.impactCents === null ? null : Math.abs(alert.impactCents);
  return (
    <li className={cn('flex gap-3 px-4 py-3.5', picked && 'bg-selected')} data-testid="alert-row" data-kind={alert.kind} data-status={alert.status} data-alert-id={alert.id}>
      {canAct ? <Checkbox size="sm" className="mt-1.5" aria-label={`Pick: ${alert.title}`} checked={picked} onCheckedChange={(value) => onPick(value === true)} /> : null}
      <span aria-hidden className={cn('mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-lg', severity.chip)}>
        <Icon className="size-4" />
      </span>
      <div className="flex min-w-0 flex-1 flex-col gap-2 lg:flex-row lg:items-start lg:gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold text-fg" data-testid="alert-title">
              {alert.title}
            </h3>
            <Badge tone={severity.tone} size="sm">
              {severity.label}
            </Badge>
            {alert.status === 'snoozed' && alert.snoozedUntil ? (
              <Badge tone="neutral" size="sm" icon={<AlarmClock aria-hidden />}>
                Back on {shortDate(alert.snoozedUntil)}
              </Badge>
            ) : null}
            {alert.status === 'resolved' ? (
              <Badge tone="success" size="sm" icon={<Check aria-hidden />}>
                {alert.resolution === 'cleared' ? 'Cleared on its own' : 'Marked done'}
              </Badge>
            ) : null}
            {alert.status === 'dismissed' ? (
              <Badge tone="neutral" size="sm" icon={<BellOff aria-hidden />}>
                Dismissed
              </Badge>
            ) : null}
          </div>
          <dl className="mt-1 flex flex-col gap-0.5 text-sm">
            <div className="flex gap-1.5">
              <dt className="shrink-0 text-fg-muted">Why:</dt>
              <dd className="min-w-0 text-fg-secondary" data-testid="alert-why">
                {alert.body}
              </dd>
            </div>
            {alert.nextStep ? (
              <div className="flex gap-1.5">
                <dt className="shrink-0 text-fg-muted">Next step:</dt>
                <dd className="min-w-0 font-medium text-fg" data-testid="alert-next">
                  {alert.nextStep}
                </dd>
              </div>
            ) : null}
          </dl>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-fg-muted">
            {alert.url ? (
              <Link href={alert.url} className="inline-flex items-center gap-1 rounded-sm text-sm font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus" data-testid="alert-link">
                {linkLabel(alert)}
                <ArrowRight aria-hidden className="size-3.5" />
              </Link>
            ) : null}
            {stake !== null && stake > 0 ? (
              <span className="inline-flex items-center gap-0.5 tabular-nums" data-testid="alert-stake">
                {formatMoney(stake, { cents: false })} {alert.impactAsOf === 'fired' ? 'at stake when this alert fired' : 'at stake'}
                <How
                  title="Money at stake"
                  formula={
                    alert.impactAsOf === 'fired'
                      ? 'How much profit this problem was costing when the alert fired. The job no longer shows this reason, so the figure is not live. The next check clears the alert if the problem is gone.'
                      : 'How much profit this problem is costing right now, from the same numbers the job page and Home show. The reason above says which numbers.'
                  }
                  lines={[
                    { label: alert.entityLabel ?? 'This alert', value: formatMoney(stake, { cents: false }), op: 'start' },
                    { label: 'First seen', value: formatRelative(alert.firstSeenAt), op: 'note' },
                    { label: 'Last checked', value: formatRelative(alert.lastSeenAt), op: 'note' },
                  ]}
                  footer={
                    alert.url ? (
                      <Link href={alert.url} className="text-sm font-medium text-fg-link underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-focus">
                        {linkLabel(alert)} to see every number
                      </Link>
                    ) : undefined
                  }
                  align="start"
                  className="size-5 pointer-coarse:size-6"
                />
              </span>
            ) : null}
            <span>
              First seen <RelativeTime iso={alert.firstSeenAt} />
            </span>
            {alert.assignedTo ? (
              <span className="inline-flex items-center gap-1" data-testid="alert-assignee">
                <PersonAvatar userId={alert.assignedTo} size="xs" showName />
              </span>
            ) : null}
          </div>
        </div>
        {canAct ? (
          <div className="flex shrink-0 flex-wrap items-center gap-1.5 lg:justify-end">
            {isOpen ? (
              <>
                <Button size="sm" variant="secondary" leadingIcon={<Check aria-hidden />} onClick={() => onChange({ action: 'resolve' })} data-testid="alert-resolve">
                  Done
                </Button>
                <SnoozeMenu choices={choices} onPick={(until) => onChange({ action: 'snooze', until })} onPickDay={onPickDay}>
                  <Button size="sm" variant="secondary" leadingIcon={<AlarmClock aria-hidden />} data-testid="alert-snooze">
                    Snooze
                  </Button>
                </SnoozeMenu>
                {canAssign ? (
                  <UserPicker
                    people={people}
                    meId={meId}
                    value={alert.assignedTo}
                    onChange={(userId) => onChange({ action: 'assign', userId })}
                    aria-label={`Hand to someone: ${alert.title}`}
                    align="end"
                    trigger={
                      <Button size="sm" variant="secondary" leadingIcon={<UserRound aria-hidden />} data-testid="alert-assign">
                        {alert.assignedTo ? 'Reassign' : 'Assign'}
                      </Button>
                    }
                  />
                ) : null}
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <IconButton label={`More for: ${alert.title}`} icon={<MoreHorizontal aria-hidden />} variant="ghost" size="sm" data-testid="alert-more" />
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end">
                    <DropdownMenuItem icon={<BellOff aria-hidden />} description="Stays quiet while nothing changes" onSelect={() => onChange({ action: 'dismiss' })} data-testid="alert-dismiss">
                      Dismiss, this is fine
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            ) : (
              <Button size="sm" variant="secondary" leadingIcon={<RotateCcw aria-hidden />} onClick={() => onChange({ action: alert.status === 'snoozed' ? 'unsnooze' : 'reopen' })} data-testid="alert-reopen">
                {alert.status === 'snoozed' ? 'Bring back now' : 'Open again'}
              </Button>
            )}
          </div>
        ) : null}
      </div>
    </li>
  );
}

function SnoozeMenu({ children, choices, onPick, onPickDay }: { readonly children: React.ReactNode; readonly choices: ReturnType<typeof snoozeChoices>; readonly onPick: (until: string) => void; readonly onPickDay: () => void }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>{children}</DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {choices.map((choice) => (
          <DropdownMenuItem key={choice.label} icon={<AlarmClock aria-hidden />} shortcut={shortDate(choice.until)} onSelect={() => onPick(choice.until)}>
            {choice.label}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem icon={<CalendarClock aria-hidden />} onSelect={onPickDay}>
          Pick a day
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

function PickDayDialog({ today, count, onCancel, onPick }: { readonly today: string; readonly count: number; readonly onCancel: () => void; readonly onPick: (until: string) => void }) {
  const [day, setDay] = useState('');
  const [error, setError] = useState<string | null>(null);
  return (
    <Dialog open onOpenChange={(next) => (!next ? onCancel() : undefined)}>
      <DialogContent size="sm" data-testid="snooze-dialog">
        <DialogHeader title={count === 1 ? 'Snooze this alert' : `Snooze ${count} alerts`} description="It leaves the inbox and comes back on the day you pick, if the problem is still there." />
        <form
          onSubmit={(event) => {
            event.preventDefault();
            if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return setError('Pick a day.');
            if (day <= today) return setError('Pick a day after today.');
            onPick(day);
          }}
        >
          <DialogBody>
            <Field label="Bring it back on" error={error} required>
              {({ inputId, describedBy, invalid }) => (
                <IsoDatePicker
                  id={inputId}
                  min={addDaysIso(today, 1)}
                  value={day || null}
                  aria-describedby={describedBy}
                  invalid={invalid}
                  clearable={false}
                  size="lg"
                  placeholder="Pick a day"
                  onChange={(value) => (setDay(value ?? ''), setError(null))}
                  data-testid="snooze-day"
                />
              )}
            </Field>
          </DialogBody>
          <DialogFooter>
            <Button type="button" variant="secondary" onClick={onCancel}>
              Cancel
            </Button>
            <Button type="submit" data-testid="snooze-save">
              Snooze
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function EmptyTab({ tab, canManageRules, onShowOpen }: { readonly tab: InboxTab; readonly canManageRules: boolean; readonly onShowOpen: () => void }) {
  if (tab === 'open')
    return (
      <Teach
        icon={BellRing}
        title="Nothing needs you right now"
        why="Pulse watches every open job. When one slips, for example the margin is heading under your target or a day was not logged, an alert lands here with what happened, why, and what to do next."
        points={['What happened and why, in plain words', 'The next step, and a link straight to the job', 'Snooze it, hand it to someone, or mark it done']}
        actions={
          <>
            <ButtonLink href={routes.alertRules()} icon={<ListChecks aria-hidden />}>
              {canManageRules ? 'Set up the rules' : 'See the rules'}
            </ButtonLink>
            <ButtonLink href={routes.jobs()} variant="secondary">
              Open jobs
            </ButtonLink>
          </>
        }
        testId="alerts-empty"
      />
    );
  const copy = {
    mine: { icon: UserRound, title: 'Nothing is assigned to you', why: 'When a manager hands you an alert, it shows up here and you get a message. Until then, the full list is under Needs you.' },
    snoozed: { icon: AlarmClock, title: 'Nothing is snoozed', why: 'Snooze an alert when you know about it and cannot act yet. It leaves the inbox and comes back on the day you pick.' },
    done: { icon: X, title: 'Nothing here yet', why: 'Alerts you mark done or dismiss are kept here, next to the ones that cleared on their own when the problem went away.' },
  }[tab];
  return (
    <Teach
      size="sm"
      icon={copy.icon}
      title={copy.title}
      why={copy.why}
      actions={
        <Button variant="secondary" onClick={onShowOpen}>
          Show what needs you
        </Button>
      }
      testId="alerts-empty"
    />
  );
}
