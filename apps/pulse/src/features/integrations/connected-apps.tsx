'use client';
/**
 * The body of Settings, Connected apps: each sibling KitStak app's connection state, what
 * flows where in plain words, when it last synced and what it saw, "Sync now", the switches
 * for what is pulled, and every link between a job and a sibling record with its live status.
 */
import Link from 'next/link';
import { useEffect, useState } from 'react';
import {
  ArrowDownToLine,
  ArrowUpFromLine,
  ArrowUpRight,
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleSlash,
  Link2,
  RefreshCw,
  Unlink,
} from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppIcon } from '@kitstak/ui/app-icon';
import { Button, IconButton, Skeleton, Switch, cn, toast } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { formatRelative } from '@/lib/dates';
import { useServerAction } from '@/lib/hooks/use-action';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { setLinkImportsTimeAction, syncNowAction } from '@/server/actions/integrations';
import { addJobLinkAction, removeJobLinkAction } from '@/server/actions/jobs';
import { updateSettingsAction } from '@/server/actions/settings';
import { integrationKeys, useConnectedApps, useLinkedJobs, useLiveRecords } from './api';
import { LinkRecordDialog } from './link-record-dialog';
import { RecordChip, findLive } from './record-chip';
import {
  SIBLING_APP_NAMES,
  TARGET_WORDS,
  type AppConnectionDTO,
  type ConnectedAppsDTO,
  type LinkedJobDTO,
  type SiblingApp,
} from './types';

type SwitchKey = keyof ConnectedAppsDTO['switches'];

/** A label inside a sentence: "Work order" is "work order", but "CRM deal" keeps its capitals. */
const inSentence = (words: string): string => (/^[A-Z]{2,}/.test(words) ? words : `${words.charAt(0).toLowerCase()}${words.slice(1)}`);

interface Flow {
  readonly text: string;
  /** A switch that turns this flow on or off. */
  readonly toggle?: SwitchKey;
}

const INTO_PULSE: Readonly<Record<SiblingApp, readonly Flow[]>> = {
  crm: [
    {
      text: 'A won deal can become a job. Its name, account and value fill in the new job, and the value becomes the quote.',
      toggle: 'crmSuggestJobs',
    },
    {
      text: 'The stage of a linked deal shows on its job. When the deal value changes in CRM, the job tells you the quote is different.',
    },
  ],
  wms: [
    {
      text: 'Kits built on a linked work order come in as units for that day. You add the people and the hours.',
    },
    {
      text: 'Parts a linked work order used come in as materials, at the cost the warehouse has for one part.',
      toggle: 'wmsSyncMaterials',
    },
    {
      text: 'Warehouse bills come in as billed amounts for each client. They show what was invoiced and never change profit.',
      toggle: 'wmsSyncBilling',
    },
    { text: 'A work order that is short of parts marks its job, so it shows up as at risk.' },
  ],
  projects: [
    {
      text: 'Time logged on a linked project comes in as labor hours for that day, costed with your own labor rate.',
      toggle: 'projectsTimeImport',
    },
    { text: 'The status and progress of a linked project show on its job.' },
  ],
};

const BACK_TO_APP: Readonly<Record<SiblingApp, string>> = {
  crm: 'Deals and accounts get a Profit tab with the revenue, cost, profit and margin of their jobs.',
  wms: 'Work orders get a Job profit card, and clients get a Client profit line.',
  projects: 'The project overview shows Job profit for the jobs linked to it.',
};

const TOGGLE_LABEL: Readonly<Record<SwitchKey, string>> = {
  crmSuggestJobs: 'Suggest jobs from won deals',
  wmsSyncMaterials: 'Pull parts used',
  wmsSyncBilling: 'Pull warehouse bills',
  projectsTimeImport: 'Pull project time',
};

const plural = (count: number, one: string, many: string): string =>
  `${count.toLocaleString('en-US')} ${count === 1 ? one : many}`;

/** What the last good sync saw, in plain words. */
function seenLines(app: AppConnectionDTO): string[] {
  const c = app.counts;
  const has = (key: string): boolean => typeof c[key] === 'number';
  const lines: string[] = [];
  if (app.app === 'crm' && has('wonDeals')) {
    lines.push(
      `${plural(c.wonDeals ?? 0, 'won deal', 'won deals')} in CRM, ${c.wonDealsNoJob ?? 0} with no job yet`,
    );
  }
  if (app.app === 'wms') {
    if (has('workOrders'))
      lines.push(
        `${plural(c.workOrders ?? 0, 'work order', 'work orders')} in the warehouse, ${c.linkedWorkOrders ?? 0} linked to a job`,
      );
    if (has('buildDays'))
      lines.push(`${plural(c.buildDays ?? 0, 'day', 'days')} of kits built on linked work orders`);
    if (has('billLines')) lines.push(`${plural(c.billLines ?? 0, 'bill line', 'bill lines')} read`);
    if (has('vasRecords') && (c.vasRecords ?? 0) > 0)
      lines.push(
        has('vasInPulse')
          ? `${plural(c.vasRecords ?? 0, 'extra service record', 'extra service records')} in the warehouse, ${c.vasInPulse ?? 0} in Pulse as extra service entries, ${c.vasContractPriced ?? 0} priced by a contract rate`
          : `${plural(c.vasRecords ?? 0, 'extra service record', 'extra service records')} in the warehouse`,
      );
    if (has('contractJobs') && (c.contractJobs ?? 0) > 0)
      lines.push(`${plural(c.contractJobs ?? 0, 'linked job follows', 'linked jobs follow')} a warehouse contract rate for work orders`);
  }
  if (app.app === 'projects' && has('linkedProjects')) {
    lines.push(
      `${plural(c.linkedProjects ?? 0, 'linked project', 'linked projects')}, ${plural(c.timeDays ?? 0, 'day', 'days')} of logged time pulled`,
    );
  }
  return lines;
}

function runLine(app: AppConnectionDTO): string | null {
  const run = app.lastRun;
  if (!run || run.status !== 'ok') return null;
  const parts: string[] = [];
  if (run.created > 0) parts.push(`${run.created} added`);
  if (run.updated > 0) parts.push(`${run.updated} updated`);
  if (run.skippedClosed > 0) parts.push(`${run.skippedClosed} left out because the month is closed`);
  if (run.skipped > 0) parts.push(`${run.skipped} skipped`);
  return parts.length > 0 ? `Last sync: ${parts.join(', ')}.` : 'Last sync: nothing new.';
}

/** "5 minutes ago", worked out in the browser only so the server and the page never disagree. */
function Ago({ iso }: { readonly iso: string }) {
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    const tick = () => setText(formatRelative(iso));
    tick();
    const timer = setInterval(tick, 30_000);
    return () => clearInterval(timer);
  }, [iso]);
  return (
    <time
      dateTime={iso}
      title={new Date(iso).toISOString().replace('T', ' ').slice(0, 16) + ' UTC'}
      data-testid="last-synced"
    >
      {text ?? 'a moment ago'}
    </time>
  );
}

const STATE = {
  connected: { label: 'Connected', icon: CircleCheck, className: 'text-success-text' },
  not_set_up: { label: 'Not set up yet', icon: CircleDashed, className: 'text-fg-muted' },
  not_on_plan: { label: 'Not on your plan', icon: CircleSlash, className: 'text-fg-muted' },
} as const;

function AppCard({
  app,
  data,
  portalUrl,
  syncing,
  onSync,
  onToggle,
  savingToggle,
}: {
  readonly app: AppConnectionDTO;
  readonly data: ConnectedAppsDTO;
  readonly portalUrl: string;
  readonly syncing: boolean;
  readonly onSync: () => void;
  readonly onToggle: (key: SwitchKey, value: boolean) => void;
  readonly savingToggle: SwitchKey | null;
}) {
  const name = SIBLING_APP_NAMES[app.app];
  const state = STATE[app.state];
  const StateIcon = state.icon;
  const connected = app.state === 'connected';
  const busy = syncing || app.running;
  const seen = seenLines(app);
  const last = runLine(app);
  return (
    <li
      data-testid={`app-${app.app}`}
      data-state={
        app.state === 'connected' ? 'connected' : app.state === 'not_set_up' ? 'not-set-up' : 'not-licensed'
      }
      className="flex flex-col gap-4 px-4 py-4 sm:px-5"
    >
      <div className="flex flex-wrap items-start gap-x-3 gap-y-2">
        <span
          aria-hidden
          className={cn(
            'flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted',
            !connected && 'opacity-60 grayscale',
          )}
        >
          <AppIcon app={app.app} size={32} />
        </span>
        <div className="min-w-0 flex-1 basis-48">
          <h2 className="text-md font-semibold text-fg">{name}</h2>
          <p className={cn('mt-0.5 inline-flex items-center gap-1.5 text-sm font-medium', state.className)}>
            <StateIcon aria-hidden className="size-4" />
            {state.label}
            {connected ? (
              <span className="font-normal text-fg-muted">
                {' · '}
                {app.lastSyncedAt ? (
                  <>
                    last synced <Ago iso={app.lastSyncedAt} />
                  </>
                ) : (
                  'not synced yet'
                )}
              </span>
            ) : null}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {connected && data.canManage ? (
            <Button
              size="sm"
              variant="secondary"
              onClick={onSync}
              loading={busy}
              leadingIcon={<RefreshCw aria-hidden />}
              data-testid={`sync-${app.app}`}
            >
              {busy ? 'Syncing' : 'Sync now'}
            </Button>
          ) : null}
          {app.state === 'not_on_plan' ? (
            <a
              href={`${portalUrl}/billing/upgrade?module=${app.app}`}
              className="inline-flex h-7 items-center gap-1 rounded-md border border-border-input bg-panel px-2.5 text-xs font-medium text-fg hover:bg-muted focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              See plans
              <ArrowUpRight aria-hidden className="size-3.5" />
            </a>
          ) : (
            <a
              href={app.url}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-7 items-center gap-1 rounded-md px-2 text-xs font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              Open {name.replace('KitStak ', '')}
              <ArrowUpRight aria-hidden className="size-3.5" />
              <span className="sr-only"> in a new tab</span>
            </a>
          )}
        </div>
      </div>

      {app.lastError && connected ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger-subtle px-3 py-2 text-sm text-danger-text"
          data-testid={`sync-error-${app.app}`}
        >
          <CircleAlert aria-hidden className="mt-0.5 size-4 shrink-0" />
          <span>
            The last sync did not finish. {app.lastError} Your earlier numbers are untouched. Press Sync now
            to try again.
          </span>
        </p>
      ) : null}

      {app.state === 'not_set_up' ? (
        <p className="text-sm text-fg-secondary">
          {app.app === 'wms'
            ? 'Your plan includes the warehouse app, but this workspace has no warehouse yet. Once one is set up, work orders can feed your jobs. Until then, type units by hand or import a spreadsheet.'
            : `Your plan includes ${name}, but it has no data for this workspace yet. Nothing is needed from you here. Pulse works on its own until then.`}
        </p>
      ) : app.state === 'not_on_plan' ? (
        <p className="text-sm text-fg-secondary">
          Pulse does not need {name}. Everything it would bring in can also be typed or{' '}
          <Link href={routes.importCenter()} className="font-medium text-fg-link hover:underline">
            imported from a spreadsheet
          </Link>
          .
        </p>
      ) : null}

      <div className={cn('grid gap-4 md:grid-cols-2', !connected && 'opacity-[0.88]')}>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] text-fg-secondary uppercase">
            <ArrowDownToLine aria-hidden className="size-3.5" />
            {connected ? 'Comes into Pulse' : 'Would come into Pulse'}
          </h3>
          <ul className="mt-2 flex flex-col gap-2.5">
            {INTO_PULSE[app.app].map((flow) => {
              const on = flow.toggle ? data.switches[flow.toggle] : true;
              return (
                <li key={flow.text} className="flex items-start gap-3 text-sm text-fg-secondary">
                  <span
                    className={cn(
                      'min-w-0 flex-1',
                      flow.toggle && !on && 'text-fg-muted line-through decoration-border-strong',
                    )}
                  >
                    {flow.text}
                  </span>
                  {flow.toggle && connected ? (
                    <Switch
                      size="sm"
                      checked={on}
                      disabled={!data.canManage || savingToggle === flow.toggle}
                      onCheckedChange={(value) => onToggle(flow.toggle as SwitchKey, value)}
                      aria-label={TOGGLE_LABEL[flow.toggle]}
                      data-testid={`switch-${flow.toggle}`}
                    />
                  ) : null}
                </li>
              );
            })}
          </ul>
        </div>
        <div>
          <h3 className="flex items-center gap-1.5 text-xs font-semibold tracking-[0.04em] text-fg-secondary uppercase">
            <ArrowUpFromLine aria-hidden className="size-3.5" />
            {connected
              ? `Shows in ${name.replace('KitStak ', '')}`
              : `Would show in ${name.replace('KitStak ', '')}`}
          </h3>
          <p className="mt-2 text-sm text-fg-secondary">{BACK_TO_APP[app.app]}</p>
          {connected ? (
            <p className="mt-2 text-sm text-fg-secondary" data-testid={`linked-count-${app.app}`}>
              {app.linkedJobs === 0
                ? 'No job is linked yet.'
                : `${plural(app.linkedJobs, 'job is', 'jobs are')} linked.`}
            </p>
          ) : null}
        </div>
      </div>

      {connected && (seen.length > 0 || last) ? (
        <div
          className="rounded-lg bg-sunken px-3 py-2.5 text-sm text-fg-secondary"
          data-testid={`sync-summary-${app.app}`}
        >
          {seen.length > 0 ? (
            <ul className="flex flex-col gap-0.5">
              {seen.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>
          ) : null}
          {last ? <p className={cn('text-fg-muted', seen.length > 0 && 'mt-1')}>{last}</p> : null}
          {app.app === 'wms' && (app.counts.vasNoPrice ?? 0) > 0 ? (
            <p className="mt-2 border-t border-border-subtle pt-2 text-fg" data-testid="vas-no-price">
              <strong className="font-semibold">
                {plural(app.counts.vasNoPrice ?? 0, 'extra service entry has', 'extra service entries have')} no price yet
              </strong>
              , so that work earns nothing on paper. Add a rate for the service to the client&apos;s contract in the{' '}
              <a
                href={`${app.url}/billing`}
                target="_blank"
                rel="noreferrer"
                className="rounded-sm text-fg-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                warehouse<span className="sr-only"> (opens in a new tab)</span>
              </a>{' '}
              and sync again. Or type a price on the entry in Pulse: on the job, under Money in, or in{' '}
              <Link
                href={routes.settingsClose()}
                className="rounded-sm text-fg-link underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                Close a month
              </Link>
              , under Extra services.
            </p>
          ) : null}
          {app.app === 'wms' && (app.counts.vasNoClient ?? 0) > 0 ? (
            <p className="mt-1 text-fg-muted" data-testid="vas-no-client">
              {plural(app.counts.vasNoClient ?? 0, 'record was', 'records were')} left out because the client is not in Pulse yet. Add the
              client, then sync again.
            </p>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function LinkRow({
  link,
  live,
  loading,
  appUrl,
  canManage,
  onRemove,
  onImportsTime,
}: {
  readonly link: LinkedJobDTO;
  readonly live: ReturnType<typeof findLive>;
  readonly loading: boolean;
  readonly appUrl: string | null;
  readonly canManage: boolean;
  readonly onRemove: () => void;
  readonly onImportsTime: (value: boolean) => void;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 sm:px-5" data-testid="linked-row">
      <Link
        href={routes.job(link.jobNumber)}
        className="flex min-w-0 flex-1 basis-56 items-center gap-2 rounded-md text-sm hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
      >
        <span className="shrink-0 rounded-sm bg-sunken px-1.5 py-px text-2xs font-semibold tracking-[0.04em] text-fg-secondary tabular-nums">
          {link.jobNumber}
        </span>
        <span className="truncate font-medium text-fg">{link.jobName}</span>
      </Link>
      <span className="flex min-w-0 max-w-full items-center gap-2 sm:max-w-[46%]">
        <span className="sr-only">linked to a {inSentence(TARGET_WORDS[link.targetType])}</span>
        <RecordChip
          type={link.targetType}
          id={link.targetId}
          title={link.title}
          status={link.status}
          url={appUrl && link.path ? `${appUrl}${link.path}` : null}
          live={live}
          loading={loading}
          size="sm"
        />
      </span>
      {link.targetType === 'pm_project' ? (
        <Switch
          size="sm"
          checked={link.importsTime}
          disabled={!canManage}
          onCheckedChange={onImportsTime}
          label="Count its time"
          data-testid="imports-time"
        />
      ) : null}
      {canManage ? (
        <IconButton
          label={`Remove the link between ${link.jobNumber} and ${link.title ?? 'this record'}`}
          icon={<Unlink aria-hidden />}
          size="sm"
          onClick={onRemove}
          data-testid="unlink"
        />
      ) : null}
    </li>
  );
}

export interface ConnectedAppsViewProps {
  readonly initial: ConnectedAppsDTO;
  readonly initialLinks: LinkedJobDTO[];
  readonly portalUrl: string;
}

export function ConnectedAppsView({ initial, initialLinks, portalUrl }: ConnectedAppsViewProps) {
  const queryClient = useQueryClient();
  const status = useConnectedApps(initial);
  const links = useLinkedJobs(initialLinks);
  const data = status.data ?? initial;
  const rows = links.data ?? initialLinks;
  const [syncing, setSyncing] = useState<SiblingApp | 'all' | null>(null);
  const [savingToggle, setSavingToggle] = useState<SwitchKey | null>(null);
  const [linking, setLinking] = useState(false);
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [timeOverride, setTimeOverride] = useState<ReadonlyMap<string, boolean>>(new Map());
  const shown = rows
    .filter((row) => !hidden.has(row.linkId))
    .map((row) =>
      timeOverride.has(row.linkId) ? { ...row, importsTime: timeOverride.get(row.linkId) as boolean } : row,
    );
  const live = useLiveRecords(shown.map((row) => ({ type: row.targetType, id: row.targetId })));
  const connected = { crm: false, wms: false, projects: false } as Record<SiblingApp, boolean>;
  for (const app of data.apps) connected[app.app] = app.state === 'connected';
  const anyConnected = data.apps.some((app) => app.state === 'connected');
  const urlOf = (app: SiblingApp): string | null => data.apps.find((item) => item.app === app)?.url ?? null;

  const refreshAll = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: integrationKeys.root() }),
      queryClient.invalidateQueries({ queryKey: qk.jobsRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.streams() }),
      queryClient.invalidateQueries({ queryKey: qk.profitRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.summaryRoot() }),
      queryClient.invalidateQueries({ queryKey: qk.badges() }),
    ]);
  };

  const sync = useServerAction(syncNowAction, { errorTitle: "Couldn't sync" });
  const runSync = async (source: SiblingApp | 'all') => {
    setSyncing(source);
    try {
      const results = await sync.run({ source });
      if (!results) return;
      await refreshAll();
      const failed = results.filter((result) => result.status === 'failed');
      const ran = results.filter((result) => result.status === 'ok');
      if (failed.length > 0)
        toast.error("Couldn't finish the sync", failed.map((result) => result.message).join(' '));
      else if (ran.length === 0) toast.success(results[0]?.message ?? 'Nothing to sync.');
      else
        toast.success(
          ran.length === 1 ? (ran[0]?.message ?? 'Synced.') : 'Synced all connected apps.',
          ran.length > 1 ? ran.map((result) => result.message).join(' ') : undefined,
        );
    } finally {
      setSyncing(null);
    }
  };

  const toggle = async (key: SwitchKey, value: boolean) => {
    setSavingToggle(key);
    const before = data;
    // Show the new position at once. Put it back if the save fails.
    queryClient.setQueryData<ConnectedAppsDTO>(integrationKeys.status(), {
      ...data,
      switches: { ...data.switches, [key]: value },
    });
    const save = async (next: boolean): Promise<boolean> => {
      const result = await updateSettingsAction({ [key]: next });
      if (!result.ok) {
        queryClient.setQueryData<ConnectedAppsDTO>(integrationKeys.status(), before);
        toast.error("Couldn't save your change", result.error.message);
        return false;
      }
      await queryClient.invalidateQueries({ queryKey: qk.settings() });
      return true;
    };
    try {
      if (await save(value)) {
        toast.undo(`${TOGGLE_LABEL[key]}: ${value ? 'on' : 'off'}`, {
          onUndo: async () => {
            queryClient.setQueryData<ConnectedAppsDTO>(integrationKeys.status(), (current) =>
              current ? { ...current, switches: { ...current.switches, [key]: !value } } : current,
            );
            await save(!value);
          },
        });
      }
    } finally {
      setSavingToggle(null);
    }
  };

  const remove = async (link: LinkedJobDTO) => {
    setHidden((current) => new Set(current).add(link.linkId));
    const gone = await removeJobLinkAction({ linkId: link.linkId });
    if (!gone.ok) {
      setHidden((current) => {
        const next = new Set(current);
        next.delete(link.linkId);
        return next;
      });
      toast.error("Couldn't remove the link", gone.error.message);
      return;
    }
    await refreshAll();
    toast.undo(`Removed the link between ${link.jobNumber} and ${link.title ?? 'the record'}`, {
      onUndo: async () => {
        const back = await addJobLinkAction({
          jobId: link.jobId,
          link: {
            targetType: link.targetType,
            targetId: link.targetId,
            importsTime: link.importsTime,
            title: link.title,
            status: link.status,
            url: link.path,
          },
        });
        if (!back.ok) throw new Error(back.error.message);
        await refreshAll();
      },
    });
  };

  const setImportsTime = async (link: LinkedJobDTO, value: boolean) => {
    setTimeOverride((current) => new Map(current).set(link.linkId, value));
    const result = await setLinkImportsTimeAction({ linkId: link.linkId, importsTime: value });
    if (!result.ok) {
      setTimeOverride((current) => {
        const next = new Map(current);
        next.delete(link.linkId);
        return next;
      });
      toast.error("Couldn't save your change", result.error.message);
      return;
    }
    await queryClient.invalidateQueries({ queryKey: integrationKeys.links() });
    toast.success(
      value
        ? `Time on ${link.title ?? 'the project'} now counts as labor on ${link.jobNumber}. It comes in with the next sync.`
        : `Time on ${link.title ?? 'the project'} no longer comes into ${link.jobNumber}. Hours already pulled stay until you delete them.`,
    );
  };

  return (
    <div className="flex flex-col gap-5" data-testid="connected-apps">
      <Panel
        title="KitStak apps"
        bodyClassName="p-0"
        action={
          anyConnected && data.canManage ? (
            <Button
              size="sm"
              variant="ghost"
              onClick={() => void runSync('all')}
              loading={syncing === 'all'}
              leadingIcon={<RefreshCw aria-hidden />}
              data-testid="sync-all"
            >
              Sync all
            </Button>
          ) : null
        }
      >
        <ul className="divide-y divide-border-subtle">
          {data.apps.map((app) => (
            <AppCard
              key={app.app}
              app={app}
              data={data}
              portalUrl={portalUrl}
              syncing={syncing === app.app || syncing === 'all'}
              onSync={() => void runSync(app.app)}
              onToggle={(key, value) => void toggle(key, value)}
              savingToggle={savingToggle}
            />
          ))}
        </ul>
      </Panel>

      <p className="text-sm text-fg-muted">
        {anyConnected
          ? 'Pulse reads connected apps for this workspace only, never another workspace, and keeps working if one of them is switched off. A sync also runs by itself every few minutes while Pulse is in use. It only adds what is new, so running it again never counts anything twice.'
          : 'Nothing is connected, and nothing has to be. Every kind of data can come in from a spreadsheet instead.'}{' '}
        <Link
          href={anyConnected ? `${portalUrl}/billing` : routes.importCenter()}
          className="font-medium text-fg-link hover:underline"
        >
          {anyConnected ? 'Manage apps in the Portal' : 'Go to Import and export'}
        </Link>
      </p>

      {anyConnected ? (
        <Panel
          title="Linked records"
          bodyClassName="p-0"
          action={
            data.canManage ? (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setLinking(true)}
                leadingIcon={<Link2 aria-hidden />}
                data-testid="link-a-job"
              >
                Link a job
              </Button>
            ) : null
          }
        >
          {links.isError ? (
            <div role="alert" className="flex flex-col items-start gap-2 px-5 py-5 text-sm text-fg-secondary">
              <p>The list of links did not load.</p>
              <Button size="sm" variant="secondary" onClick={() => void links.refetch()}>
                Try again
              </Button>
            </div>
          ) : links.isPending ? (
            <div role="status" aria-label="Loading links" className="flex flex-col gap-2 px-5 py-4">
              {[0, 1, 2].map((index) => (
                <Skeleton key={index} height={32} rounded="md" />
              ))}
            </div>
          ) : shown.length === 0 ? (
            <div className="flex flex-col items-start gap-3 px-5 py-6" data-testid="links-empty">
              <p className="text-md font-semibold text-fg">No job is linked to another app yet</p>
              <p className="max-w-[60ch] text-sm text-fg-secondary">
                A link ties a job to the deal, work order or project it belongs to. A linked job keeps that
                record&apos;s status next to its own numbers, pulls in what the other app already knows, and
                shows its profit back on that record.
              </p>
              {data.canManage ? (
                <Button size="sm" onClick={() => setLinking(true)} leadingIcon={<Link2 aria-hidden />}>
                  Link a job
                </Button>
              ) : (
                <p className="text-sm text-fg-muted">A manager can link a job.</p>
              )}
            </div>
          ) : (
            <ul className="divide-y divide-border-subtle" data-testid="linked-list">
              {shown.map((link) => {
                const app: SiblingApp = link.targetType.startsWith('crm_')
                  ? 'crm'
                  : link.targetType.startsWith('wms_')
                    ? 'wms'
                    : 'projects';
                return (
                  <LinkRow
                    key={link.linkId}
                    link={link}
                    live={findLive(live.data, link)}
                    loading={live.isPending}
                    appUrl={urlOf(app)}
                    canManage={data.canManage}
                    onRemove={() => void remove(link)}
                    onImportsTime={(value) => void setImportsTime(link, value)}
                  />
                );
              })}
            </ul>
          )}
        </Panel>
      ) : null}

      <LinkRecordDialog
        open={linking}
        onOpenChange={setLinking}
        connected={connected}
        onLinked={refreshAll}
      />
    </div>
  );
}
