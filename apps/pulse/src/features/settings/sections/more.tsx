'use client';
/** Settings sections: your notifications, device links, sample data, the danger zone and how the math works. */
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BellRing, FlaskConical, Skull, TriangleAlert } from 'lucide-react';
import { Button, ConfirmDialog, Dialog, DialogBody, DialogContent, DialogFooter, DialogHeader, Field, Input, Skeleton, Switch, toast } from '@/components/ui';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { RULE_GROUPS, RULE_KINDS } from '@/features/alerts/rule-kinds';
import { DeviceLinksPanel } from '@/features/kiosk/device-links-panel';
import { useShell } from '@/features/shell/shell-context';
import { ALERT_KINDS, type AlertKind } from '@/lib/constants';
import { apiGet, apiPath } from '@/lib/api-client';
import { useUserPrefs } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import type { SampleStateDTO } from '@/server/domain/sample';
import { clearSampleDataAction, loadSampleDataAction, purgeAllDataAction } from '@/server/actions/data';
import { updateUserPrefsAction } from '@/server/actions/views';

/* ------------------------------------------------------------------------------------------ */
/* Notifications (per person)                                                                  */
/* ------------------------------------------------------------------------------------------ */

export function NotificationsSection() {
  const shell = useShell();
  const queryClient = useQueryClient();
  const prefs = useUserPrefs();
  const [busy, setBusy] = useState<string | null>(null);
  const notify = (prefs.data?.notify ?? {}) as Readonly<Record<string, boolean>>;
  const digest = prefs.data?.digest !== false;
  const kinds = ALERT_KINDS.filter((kind) => {
    const group = RULE_KINDS[kind].group;
    if (group === 'Connected apps') return shell.integrations.crm || shell.integrations.wms || shell.integrations.projects;
    return true;
  });

  const save = async (patch: Record<string, unknown>, key: string, done: string, undo: Record<string, unknown>): Promise<void> => {
    setBusy(key);
    const result = await updateUserPrefsAction({ patch });
    setBusy(null);
    if (!result.ok) {
      toast.error('Could not save that', result.error.message);
      return;
    }
    queryClient.setQueryData(qk.prefs(), result.data);
    toast.undo(done, {
      onUndo: async () => {
        const back = await updateUserPrefsAction({ patch: undo });
        if (!back.ok) throw new Error(back.error.message);
        queryClient.setQueryData(qk.prefs(), back.data);
      },
    });
  };

  const setKind = (kind: AlertKind, on: boolean): Promise<void> => save({ notify: { ...notify, [kind]: on } }, kind, on ? 'You will be told about this again' : 'You will not be told about this any more', { notify });

  return (
    <div className="flex flex-col gap-5">
      <Panel title="Your notifications">
        <div className="flex flex-col gap-4">
          <p className="flex items-start gap-2.5 text-sm text-fg-secondary">
            <BellRing aria-hidden className="mt-0.5 size-5 shrink-0 text-icon-strong" />
            <span>These switches are yours alone. They choose what lands under the bell for you. Who gets told about each alert in the first place is set on the alert rules.</span>
          </p>
          {prefs.isError ? (
            <div className="flex flex-col items-start gap-2" role="alert">
              <p className="text-sm text-fg-secondary">We could not load your choices.</p>
              <Button variant="secondary" onClick={() => void prefs.refetch()}>
                Try again
              </Button>
            </div>
          ) : prefs.isLoading ? (
            <Skeleton height={200} />
          ) : (
            <>
              <Switch
                checked={digest}
                disabled={busy === 'digest'}
                onCheckedChange={(checked) => void save({ digest: checked }, 'digest', checked ? 'Daily summary is on' : 'Daily summary is off', { digest })}
                label="One summary a day"
                description="When something needs you, Pulse leaves one note a day under the bell with what to look at first."
                data-testid="notify-digest"
              />
              {RULE_GROUPS.map((group) => {
                const list = kinds.filter((kind) => RULE_KINDS[kind].group === group);
                if (list.length === 0) return null;
                return (
                  <fieldset key={group} className="flex flex-col gap-3 border-t border-border-subtle pt-4">
                    <legend className="sr-only">{group}</legend>
                    <p aria-hidden className="text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
                      {group}
                    </p>
                    {list.map((kind) => (
                      <Switch key={kind} size="sm" checked={notify[kind] !== false} disabled={busy === kind} onCheckedChange={(checked) => void setKind(kind, checked)} label={RULE_KINDS[kind].label} description={RULE_KINDS[kind].help} data-testid={`notify-${kind}`} />
                    ))}
                  </fieldset>
                );
              })}
            </>
          )}
        </div>
      </Panel>
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border-subtle bg-panel px-4 py-3 shadow-xs">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-fg">Alert rules</p>
          <p className="text-sm text-fg-muted">Plain sentence rules like &quot;Tell me when a job&apos;s margin is heading under 15%&quot;, and who gets told.</p>
        </div>
        <ButtonLink href={routes.alertRules()} variant="secondary" size="sm">
          Open alert rules
        </ButtonLink>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Device links                                                                                */
/* ------------------------------------------------------------------------------------------ */

export function DevicesSection() {
  return (
    <div className="flex flex-col gap-5">
      <Panel title="Floor tablets">
        <DeviceLinksPanel kind="kiosk" />
      </Panel>
      <Panel title="Wall displays">
        <DeviceLinksPanel kind="wall" />
      </Panel>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Sample data                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export const sampleKey = ['sample-state'] as const;

export function useSampleState(initial?: SampleStateDTO) {
  return useQuery({ queryKey: sampleKey, queryFn: () => apiGet<SampleStateDTO>(apiPath('import/sample')), initialData: initial, staleTime: 30_000 });
}

/** Load and remove the made up shop. Used on the settings page and on the welcome page. */
export function SampleDataCard({ initial, canManage, compact = false }: { readonly initial?: SampleStateDTO; readonly canManage: boolean; readonly compact?: boolean }) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const state = useSampleState(initial);
  const [busy, setBusy] = useState<'load' | 'clear' | null>(null);
  const [confirm, setConfirm] = useState(false);
  const loaded = state.data?.loaded ?? false;

  const refreshAll = async (next: SampleStateDTO): Promise<void> => {
    queryClient.setQueryData(sampleKey, next);
    await queryClient.invalidateQueries();
    router.refresh();
  };

  const load = async (): Promise<void> => {
    setBusy('load');
    const result = await loadSampleDataAction();
    setBusy(null);
    if (!result.ok) {
      toast.error('Could not load the sample data', result.error.message);
      return;
    }
    await refreshAll(result.data);
    toast.success('Sample data loaded', `${result.data.jobs} jobs with logged work, costs and invoices. Open Home to see the numbers.`);
  };

  const clear = async (): Promise<void> => {
    setBusy('clear');
    const result = await clearSampleDataAction();
    setBusy(null);
    setConfirm(false);
    if (!result.ok) {
      toast.error('Could not remove the sample data', result.error.message);
      return;
    }
    await refreshAll(result.data);
    toast.success('Sample data removed', 'Your own jobs, entries and settings were not touched.');
  };

  return (
    <div className="flex flex-col gap-3" data-testid="sample-card" data-loaded={loaded ? 'yes' : 'no'}>
      <div className="flex items-start gap-3">
        <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
          <FlaskConical className="size-5" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-fg">{loaded ? 'Sample data is loaded' : 'Try Pulse with a made up shop'}</p>
          <p className="mt-0.5 text-sm text-fg-secondary">
            {loaded
              ? `${state.data?.jobs ?? 0} sample jobs, ${state.data?.clients ?? 0} sample clients and ${state.data?.entries ?? 0} days of logged work are in your workspace. Every sample name ends in "(sample)". Removing it never touches your own data.`
              : compact
                ? 'Five jobs with two weeks of logged work, costs and invoices. One is healthy, one is heading for a loss. See real profit numbers in a few seconds, then remove it with one click.'
                : 'Five jobs in different states with two weeks of logged work, three labor rates, materials, extra services, costs and invoices. One job is healthy and one is heading for a loss, so you can see what Pulse tells you about each. Remove it all with one click.'}
          </p>
        </div>
      </div>
      {canManage ? (
        <div className="flex flex-wrap items-center gap-2">
          {loaded ? (
            <>
              <ButtonLink href={routes.jobs()} variant="secondary" testId="sample-open">
                See the sample jobs
              </ButtonLink>
              <Button variant="danger" loading={busy === 'clear'} onClick={() => setConfirm(true)} data-testid="sample-clear">
                Remove sample data
              </Button>
            </>
          ) : (
            <Button loading={busy === 'load'} onClick={() => void load()} data-testid="sample-load">
              Load sample data
            </Button>
          )}
          {busy === 'load' ? (
            <span role="status" className="text-sm text-fg-muted">
              Building the shop. This takes a few seconds.
            </span>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">Only an admin can load or remove sample data.</p>
      )}
      <ConfirmDialog
        open={confirm}
        onOpenChange={setConfirm}
        title="Remove the sample data?"
        description="Every sample job, client, rate and entry is deleted. Work you logged on a sample job goes with that job. Your own jobs and entries stay exactly as they are."
        confirmLabel="Remove sample data"
        destructive
        loading={busy === 'clear'}
        onConfirm={() => void clear()}
      />
    </div>
  );
}

export function SampleDataSection({ initial, canManage }: { readonly initial?: SampleStateDTO; readonly canManage: boolean }) {
  return (
    <Panel title="Sample data">
      <SampleDataCard initial={initial} canManage={canManage} />
    </Panel>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* Danger zone                                                                                 */
/* ------------------------------------------------------------------------------------------ */

export function DangerSection({ sample, canManageSample }: { readonly sample?: SampleStateDTO; readonly canManageSample: boolean }) {
  const shell = useShell();
  const queryClient = useQueryClient();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [typed, setTyped] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isOwner = shell.pulseRole === 'owner';
  const matches = typed.trim().toLowerCase() === shell.org.slug.toLowerCase();

  const purge = async (): Promise<void> => {
    setBusy(true);
    const result = await purgeAllDataAction({ confirm: typed });
    setBusy(false);
    if (!result.ok) {
      setError(result.error.message);
      return;
    }
    setOpen(false);
    setTyped('');
    await queryClient.invalidateQueries();
    router.refresh();
    toast.success('All Pulse data was deleted', 'Your settings, sites and people are still here. You can start again from Getting started.');
  };

  return (
    <div className="flex flex-col gap-5">
      <SampleDataSection initial={sample} canManage={canManageSample} />
      <section className="rounded-xl border border-danger/45 bg-panel shadow-xs" aria-labelledby="danger-title" data-testid="danger-zone">
        <header className="flex items-center gap-2 border-b border-danger/30 px-4 py-3">
          <TriangleAlert aria-hidden className="size-4 text-danger-text" />
          <h2 id="danger-title" className="text-base font-semibold text-fg">
            Danger zone
          </h2>
        </header>
        <div className="flex flex-wrap items-center gap-4 p-4">
          <div className="min-w-0 flex-1 basis-64">
            <p className="text-sm font-semibold text-fg">Delete all Pulse data</p>
            <p className="mt-0.5 text-sm text-fg-secondary">
              Deletes every job, client, entry, rate, plan, goal, import and report in {shell.org.name}, closed months included. Your settings, sites, people and the audit log are kept. This cannot be undone, so export everything first.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ButtonLink href={routes.exportCenter()} variant="secondary">
              Export first
            </ButtonLink>
            <Button
              variant="danger"
              leadingIcon={<Skull aria-hidden className="size-4" />}
              disabled={!isOwner}
              onClick={() => {
                setTyped('');
                setError(null);
                setOpen(true);
              }}
              data-testid="purge-open"
            >
              Delete all data
            </Button>
          </div>
          {!isOwner ? <p className="basis-full text-sm text-fg-muted">Only the owner of Pulse for this workspace can do this.</p> : null}
        </div>
      </section>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent size="sm" data-testid="purge-dialog">
          <DialogHeader title="Delete all Pulse data?" description={`This removes every job, client and entry of ${shell.org.name} for good. Type ${shell.org.slug} to confirm.`} />
          <DialogBody>
            <form
              id="purge-form"
              className="pb-2"
              onSubmit={(event) => {
                event.preventDefault();
                if (matches) void purge();
              }}
            >
              <Field label={`Type ${shell.org.slug}`} error={error}>
                {({ inputId, invalid }) => (
                  <Input
                    id={inputId}
                    invalid={invalid}
                    autoFocus
                    autoComplete="off"
                    value={typed}
                    onChange={(event) => {
                      setTyped(event.target.value);
                      setError(null);
                    }}
                    data-testid="purge-confirm"
                  />
                )}
              </Field>
            </form>
          </DialogBody>
          <DialogFooter>
            <Button variant="secondary" onClick={() => setOpen(false)}>
              Keep my data
            </Button>
            <Button variant="danger" type="submit" form="purge-form" disabled={!matches} loading={busy} data-testid="purge-run">
              Delete everything
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/* ------------------------------------------------------------------------------------------ */
/* How Pulse does the math                                                                     */
/* ------------------------------------------------------------------------------------------ */

/** The plain words cost model of the spec. This text is the in app "How Pulse does the math" page. */
const MATH: readonly { readonly term: string; readonly text: string }[] = [
  { term: 'A job', text: 'One piece of work for one client, like building 5,000 holiday gift kits. One job has one kind of unit and one price. If you build three kit versions at three prices, make three jobs.' },
  { term: 'Money in', text: 'What the client pays: the price per unit times units finished, plus any extra services, plus other fees.' },
  { term: 'Money out', text: 'Four buckets. Labor: hours times what an hour really costs you. Materials: parts and supplies that you pay for. Other costs: freight, packaging, outside help. Time not on a job: meetings, cleanup and waiting, spread across the jobs that ran.' },
  { term: 'Profit and margin', text: 'Profit is money in minus money out. Margin is profit as a share of money in.' },
  { term: 'Real cost of an hour', text: 'The wage, plus payroll taxes and benefits, plus overhead per hour. A $16.00 wage with 9% taxes, 12% benefits and $2.40 of overhead really costs $21.76 an hour.' },
  { term: 'Quote, budget, actual', text: 'The quote is what you told the client. The budget is what you think it will cost you. Actual is what happened.' },
  { term: 'Status', text: 'Pulse watches every open job and says if it is on track, needs a heads up, is at risk, or is losing money, and tells you why.' },
  { term: 'Job profit and company profit', text: 'These are two numbers. Jobs carry the costs you put on them. The company also pays for rent, salaried staff and paid time nobody logged. Pulse shows the walk from one number to the other, line by line.' },
  { term: 'One place per cost', text: 'Put each cost in one place only. A supervisor’s pay goes either in overhead per hour or in company costs, never both.' },
  { term: 'Closed months', text: 'When a month is closed its numbers stop moving. New rates, prices and rules only change open months.' },
];

export function MathSection() {
  return (
    <Panel title="How Pulse does the math">
      <dl className="flex flex-col divide-y divide-border-subtle" data-testid="math">
        {MATH.map((item) => (
          <div key={item.term} className="grid gap-1 py-3 first:pt-0 last:pb-0 sm:grid-cols-[200px_minmax(0,1fr)] sm:gap-4">
            <dt className="text-sm font-semibold text-fg">{item.term}</dt>
            <dd className="text-sm text-fg-secondary">{item.text}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 border-t border-border-subtle pt-3 text-sm text-fg-muted">Any number on a job, a client or the home page has a small &quot;how we got this&quot; button next to it that shows the same math with your own figures.</p>
    </Panel>
  );
}
