'use client';
/**
 * Getting started: five small steps, done right here, that end with a real profit number.
 * Each step is judged from real data (a rate exists, a job has a logged day), so the checklist
 * is always true, and each one links to the full screen for later.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowRight, Check, ChevronRight, Crown, FileSpreadsheet, Plug, Sparkles } from 'lucide-react';
import { Button, Field, Input, ProgressBar, toast } from '@/components/ui';
import { cn } from '@/components/ui/cn';
import { Panel } from '@/components/layout/page';
import { ButtonLink } from '@/components/pulse/button-link';
import { ExplainNumber } from '@/components/pulse/explain';
import { SampleDataCard } from '@/features/settings/sections/more';
import { useShell } from '@/features/shell/shell-context';
import { apiGet, apiPath } from '@/lib/api-client';
import { formatMoney, formatMoneyPerHour, formatNumber, formatPercentBp } from '@/lib/format';
import { useRunState } from '@/lib/hooks/use-data';
import { loadedRate } from '@/lib/profit/rates';
import { routes } from '@/lib/routes';
import type { SettingsDTO } from '@/lib/types';
import type { ActionResult } from '@/server/actions/_action';
import { createClientAction } from '@/server/actions/catalog';
import { quickAddJobAction } from '@/server/actions/jobs';
import { createLaborClassAction, createLaborRateAction } from '@/server/actions/labor';
import { saveProductionEntryAction } from '@/server/actions/log';
import { claimPulseOwnershipAction, setOnboardingAction, updateSettingsAction, updateSiteAction } from '@/server/actions/settings';
import type { OnboardingStateDTO } from '@/server/domain/sample';

const onboardingKey = ['onboarding'] as const;
type StepId = 'rate' | 'client' | 'job' | 'day' | 'profit';
const ORDER: readonly StepId[] = ['rate', 'client', 'job', 'day', 'profit'];
const num = (text: string): boolean => /^\d+(\.\d+)?$/.test(text.trim()) && Number(text) > 0;

function StepShell({ index, title, done, active, summary, link, children, id }: { readonly index: number; readonly title: string; readonly done: boolean; readonly active: boolean; readonly summary: ReactNode; readonly link: { href: string; label: string }; readonly children: ReactNode; readonly id: StepId }) {
  return (
    <li data-testid={`step-${id}`} data-state={done ? 'done' : active ? 'active' : 'next'} className={cn('rounded-xl border bg-panel shadow-xs', active ? 'border-primary' : 'border-border-subtle')}>
      <div className="flex items-start gap-3 px-4 py-3.5">
        <span aria-hidden className={cn('mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full text-sm font-semibold tabular-nums', done ? 'bg-success-subtle text-success-text' : active ? 'bg-primary text-primary-fg' : 'bg-muted text-fg-muted')}>
          {done ? <Check className="size-4" strokeWidth={3} /> : index}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="text-base font-semibold text-fg">
              {title}
              <span className="sr-only">{done ? ', done' : active ? ', next' : ', later'}</span>
            </h3>
            <Link href={link.href} className="inline-flex items-center gap-0.5 text-sm font-medium text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
              {link.label}
              <ChevronRight aria-hidden className="size-3.5" />
            </Link>
          </div>
          <div className="mt-0.5 text-sm text-fg-secondary">{summary}</div>
          {active && !done ? <div className="mt-3">{children}</div> : null}
        </div>
      </div>
    </li>
  );
}

export function WelcomeView({ initial, settings, firstName, connected }: { readonly initial: OnboardingStateDTO; readonly settings: SettingsDTO; readonly firstName: string; readonly connected: readonly string[] }) {
  const shell = useShell();
  const router = useRouter();
  const queryClient = useQueryClient();
  const state = useQuery({ queryKey: onboardingKey, queryFn: () => apiGet<OnboardingStateDTO>(apiPath('import/onboarding')), initialData: initial, staleTime: 5_000 }).data;
  const runState = useRunState();
  const [busy, setBusy] = useState<StepId | 'claim' | null>(null);
  const [errors, setErrors] = useState<Readonly<Record<string, string>>>({});
  const [wage, setWage] = useState('16.00');
  const [clientName, setClientName] = useState('');
  const [job, setJob] = useState({ name: '', units: '', price: '' });
  const [day, setDay] = useState({ units: '', people: '', hours: String(Number(settings.defaultShiftHours) || 8) });
  const canRate = shell.can('rate:manage');
  const canJob = shell.can('job:manage');
  const canLog = shell.can('production:log');
  const steps = state.steps;
  const current = ORDER.find((id) => !steps[id]) ?? null;

  // When a step is done, the cursor moves into the next one, so the five steps can be typed straight through.
  const lastStep = useRef(current);
  useEffect(() => {
    if (lastStep.current !== current && current) document.querySelector<HTMLInputElement>(`[data-testid="step-${current}"] input`)?.focus();
    lastStep.current = current;
  }, [current]);

  // The first site follows the browser's time zone, once, while the workspace is still empty.
  useEffect(() => {
    if (!shell.can('settings:manage') || settings.onboarding.browserTimezone || !state.site || state.job) return;
    let zone = '';
    try {
      zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    } catch {
      zone = '';
    }
    if (!zone) return;
    void (async () => {
      await setOnboardingAction({ key: 'browserTimezone', value: zone });
      if (state.site && state.site.timezone !== zone && state.site.timezone === settings.timezone) {
        await updateSiteAction({ siteId: state.site.id, patch: { timezone: zone } });
        await updateSettingsAction({ timezone: zone });
        await queryClient.invalidateQueries({ queryKey: onboardingKey });
      }
    })();
    // Runs once for a fresh workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const finish = async <T,>(id: StepId, call: () => Promise<ActionResult<T>>, done: string): Promise<T | null> => {
    setBusy(id);
    setErrors({});
    try {
      const result = await call();
      if (!result.ok) {
        setErrors(result.error.fields && Object.keys(result.error.fields).length > 0 ? result.error.fields : { form: result.error.message });
        toast.error('That did not save', result.error.message);
        return null;
      }
      await queryClient.invalidateQueries();
      // The last step answers with the profit number itself, and a toast would sit on top of it on a phone.
      if (done !== '') toast.success(done);
      return result.data;
    } catch {
      toast.error('That did not save', 'Check your connection and try again.');
      return null;
    } finally {
      setBusy(null);
    }
  };

  let wageExample: string | null = null;
  const { defaultPayrollTaxBp: taxBp, defaultBenefitsBp: benefitsBp, defaultOtherBurdenBp: otherBp } = settings;
  if (num(wage) && taxBp !== null && benefitsBp !== null && otherBp !== null) {
    try {
      const rate = loadedRate({ wageCents: Math.round(Number(wage) * 100), payrollTaxBp: taxBp, benefitsBp, otherBurdenBp: otherBp, overheadPerHourCents: settings.defaultOverheadPerHourCents ?? 0, overtimeMultiplier: settings.defaultOvertimeMultiplier });
      wageExample = formatMoneyPerHour(Number(rate.loadedRateCents));
    } catch {
      wageExample = null;
    }
  }

  const saveRate = async (): Promise<void> => {
    if (!num(wage)) {
      setErrors({ wage: 'Type the hourly wage, like 16.00.' });
      return;
    }
    setBusy('rate');
    const made = await createLaborClassAction({ name: 'Packer', code: 'PACK' });
    if (!made.ok) {
      setBusy(null);
      setErrors({ wage: made.error.message });
      toast.error('That did not save', made.error.message);
      return;
    }
    await finish('rate', () => createLaborRateAction({ laborClassId: made.data.id, effectiveFrom: `${(state.site?.today ?? new Date().toISOString().slice(0, 10)).slice(0, 4)}-01-01`, wageCents: Math.round(Number(wage) * 100) }), 'Labor rate set');
  };

  const saveClient = async (): Promise<void> => {
    if (clientName.trim() === '') {
      setErrors({ name: 'Type the client name.' });
      return;
    }
    await finish('client', () => createClientAction({ name: clientName.trim() }), 'Client added');
  };

  const saveJob = async (): Promise<void> => {
    const problems: Record<string, string> = {};
    if (job.name.trim() === '') problems.name = 'Give the job a name.';
    if (!num(job.units)) problems.plannedUnits = 'Type how many units, like 5000.';
    if (!num(job.price)) problems.unitPrice = 'Type the price for one, like 2.75.';
    setErrors(problems);
    if (Object.keys(problems).length > 0 || !state.client) return;
    await finish('job', () => quickAddJobAction({ clientId: state.client?.id, name: job.name.trim(), plannedUnits: job.units.trim(), unitPrice: job.price.trim() }), 'Job added');
  };

  const saveDay = async (): Promise<void> => {
    const problems: Record<string, string> = {};
    if (!num(day.units)) problems.unitsGood = 'Type the units finished, like 600.';
    if (!num(day.people)) problems.headcount = 'Type how many people, like 3.';
    if (!num(day.hours)) problems.hours = 'Type the hours each, like 8.';
    setErrors(problems);
    if (Object.keys(problems).length > 0 || !state.job || !state.site) return;
    const hours = (Number(day.people) * Number(day.hours)).toFixed(2);
    const saved = await finish('day', () => saveProductionEntryAction({ jobId: state.job?.id ?? '', workDate: state.site?.today ?? '', unitsGood: day.units.trim(), headcount: day.people.trim(), hours }), '');
    if (saved) router.refresh();
  };

  const claim = async (): Promise<void> => {
    setBusy('claim');
    const result = await claimPulseOwnershipAction();
    setBusy(null);
    if (!result.ok) {
      toast.error('Could not do that', result.error.message);
      return;
    }
    toast.success('You now run Pulse for this workspace');
    window.location.reload();
  };

  const laborHours = num(day.people) && num(day.hours) ? Number(day.people) * Number(day.hours) : null;
  const profit = state.profit;
  const allDone = state.done === ORDER.length;

  return (
    <div className="flex flex-col gap-6" data-testid="welcome" data-done={state.done}>
      {runState.data && !runState.data.hasOwner && runState.data.canClaim ? (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-warning/40 bg-warning-subtle px-4 py-3" data-testid="claim-banner">
          <Crown aria-hidden className="size-5 shrink-0 text-warning-text" />
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-fg">Nobody runs Pulse for this workspace yet</p>
            <p className="text-sm text-fg-secondary">The person who runs Pulse sets labor rates, decides who can see money and closes months.</p>
          </div>
          <Button loading={busy === 'claim'} onClick={() => void claim()} data-testid="claim-button">
            Run Pulse for this workspace
          </Button>
        </div>
      ) : null}

      <section aria-labelledby="steps-title">
        <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h2 id="steps-title" className="text-lg font-semibold text-fg">
              {allDone ? 'You have your first profit number' : 'Five steps to your first profit number'}
            </h2>
            <p className="text-sm text-fg-muted">{allDone ? `Nice work, ${firstName}. Everything below stays here if you want to look back.` : 'Most people finish in under ten minutes. Use round numbers for now. You can fix anything later.'}</p>
          </div>
          <div className="w-full max-w-56" data-testid="welcome-progress">
            <p className="mb-1 text-right text-xs font-medium text-fg-secondary tabular-nums">
              {state.done} of {ORDER.length} done
            </p>
            <ProgressBar value={(state.done / ORDER.length) * 100} label="Steps done" tone={allDone ? 'success' : 'primary'} />
          </div>
        </div>
        <ol className="flex flex-col gap-3">
          <StepShell
            id="rate"
            index={1}
            title="Set a labor rate"
            done={steps.rate}
            active={current === 'rate'}
            link={{ href: routes.labor('rates'), label: 'Labor rates' }}
            summary={steps.rate ? (state.rate ? `${state.rate.name}: one hour really costs ${state.rate.loadedRateCents !== null ? formatMoney(state.rate.loadedRateCents) : 'an amount your role cannot see'}.` : 'Done.') : 'What an hour of work really costs you: the wage plus taxes, benefits and overhead.'}
          >
            {canRate ? (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveRate();
                }}
              >
                <Field label="Hourly wage of a packer" error={errors.wage ?? errors.wageCents ?? null} className="w-48">
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={wage} onChange={(event) => setWage(event.target.value)} leadingIcon={<span className="text-sm text-fg-muted">$</span>} data-testid="step-rate-wage" />}
                </Field>
                <Button type="submit" loading={busy === 'rate'} data-testid="step-rate-save">
                  Save the rate
                </Button>
                <p className="basis-full text-sm text-fg-muted" data-testid="step-rate-example">
                  {wageExample
                    ? `With ${formatPercentBp(taxBp ?? 0)} payroll taxes and ${formatPercentBp(benefitsBp ?? 0)} benefits on top, a packer really costs ${wageExample}. You can add overhead and more labor classes later.`
                    : 'Type a wage to see what an hour really costs.'}
                </p>
              </form>
            ) : (
              <p className="text-sm text-fg-muted">Labor rates hold wages, so an admin sets them. Ask an admin to do this step, then come back.</p>
            )}
          </StepShell>

          <StepShell
            id="client"
            index={2}
            title="Add a client"
            done={steps.client}
            active={current === 'client'}
            link={{ href: routes.settings('catalogs'), label: 'Clients' }}
            summary={steps.client ? `${state.client?.name ?? 'Your client'} is in.` : 'The company you do the work for.'}
          >
            {canJob ? (
              <form
                className="flex flex-wrap items-end gap-3"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveClient();
                }}
              >
                <Field label="Client name" error={errors.name ?? errors.form ?? null} className="min-w-0 flex-1 basis-56">
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={clientName} maxLength={200} onChange={(event) => setClientName(event.target.value)} placeholder="Acme Outdoor Co" data-testid="step-client-name" />}
                </Field>
                <Button type="submit" loading={busy === 'client'} data-testid="step-client-save">
                  Add the client
                </Button>
              </form>
            ) : (
              <p className="text-sm text-fg-muted">Your role cannot add clients. Ask a manager to do this step.</p>
            )}
          </StepShell>

          <StepShell
            id="job"
            index={3}
            title="Add a job"
            done={steps.job}
            active={current === 'job'}
            link={{ href: state.job ? routes.job(state.job.number) : routes.newJob(), label: state.job ? state.job.number : 'More options' }}
            summary={steps.job ? `${state.job?.number ?? ''} ${state.job?.name ?? ''} is ready to log.` : 'One piece of work with a price and a number of units.'}
          >
            {canJob ? (
              <form
                className="grid gap-3 sm:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveJob();
                }}
              >
                <Field label={`Job for ${state.client?.name ?? 'your client'}`} error={errors.name ?? errors.clientId ?? errors.form ?? null}>
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} value={job.name} maxLength={200} onChange={(event) => setJob({ ...job, name: event.target.value })} placeholder="Holiday gift kits" data-testid="step-job-name" />}
                </Field>
                <Field label="Units to build" error={errors.plannedUnits ?? null}>
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={job.units} onChange={(event) => setJob({ ...job, units: event.target.value })} placeholder="5000" data-testid="step-job-units" />}
                </Field>
                <Field label="Price for one" error={errors.unitPrice ?? null}>
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={job.price} onChange={(event) => setJob({ ...job, price: event.target.value })} leadingIcon={<span className="text-sm text-fg-muted">$</span>} placeholder="2.75" data-testid="step-job-price" />}
                </Field>
                <Button type="submit" loading={busy === 'job'} data-testid="step-job-save">
                  Add the job
                </Button>
              </form>
            ) : (
              <p className="text-sm text-fg-muted">Your role cannot add jobs. Ask a manager to do this step.</p>
            )}
          </StepShell>

          <StepShell
            id="day"
            index={4}
            title="Log a day"
            done={steps.day}
            active={current === 'day'}
            link={{ href: routes.log(), label: 'Log work' }}
            summary={steps.day && profit ? `${formatNumber(profit.unitsGood, { maxDigits: 0 })} units in ${formatNumber(profit.hours, { maxDigits: 1 })} labor hours on ${profit.jobNumber}.` : 'Units finished, how many people, and the hours each.'}
          >
            {canLog ? (
              <form
                className="grid gap-3 sm:grid-cols-[repeat(3,minmax(0,1fr))_auto] sm:items-end"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveDay();
                }}
              >
                <Field label={`${state.job?.unitLabel ? state.job.unitLabel.replace(/^./, (char) => char.toUpperCase()) : 'Units'} finished today`} error={errors.unitsGood ?? errors.form ?? null}>
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={day.units} onChange={(event) => setDay({ ...day, units: event.target.value })} placeholder="600" data-testid="step-day-units" />}
                </Field>
                <Field label="People" error={errors.headcount ?? null}>
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={day.people} onChange={(event) => setDay({ ...day, people: event.target.value })} placeholder="3" data-testid="step-day-people" />}
                </Field>
                <Field label="Hours each" error={errors.hours ?? null}>
                  {({ inputId, invalid }) => <Input id={inputId} invalid={invalid} inputMode="decimal" value={day.hours} onChange={(event) => setDay({ ...day, hours: event.target.value })} data-testid="step-day-hours" />}
                </Field>
                <Button type="submit" loading={busy === 'day'} data-testid="step-day-save">
                  Log the day
                </Button>
                <p className="text-sm text-fg-muted sm:col-span-4">{laborHours !== null ? `That is ${formatNumber(laborHours, { maxDigits: 2 })} labor hours on ${state.job?.number ?? 'the job'}.` : 'People times hours each gives the labor hours.'}</p>
              </form>
            ) : (
              <p className="text-sm text-fg-muted">Your role cannot log work. Ask a supervisor or a manager to do this step.</p>
            )}
          </StepShell>

          <StepShell
            id="profit"
            index={5}
            title="See your profit"
            done={steps.profit}
            active={current === 'profit'}
            link={{ href: profit ? routes.job(profit.jobNumber) : routes.profit(), label: profit ? 'Open the job' : 'Profit' }}
            summary={steps.profit ? 'Revenue, cost and margin for the job, worked out from what you typed.' : 'Revenue, cost and margin for the job, right away.'}
          >
            <p className="text-sm text-fg-muted">{steps.day ? 'The job has a day logged but no revenue yet. Give it a price for one unit on the job page.' : 'Log a day first. The number shows up here the moment you do.'}</p>
          </StepShell>
        </ol>

        {profit && steps.profit ? (
          <div role="status" className="mt-3 rounded-xl border border-success/40 bg-success-subtle p-5" data-testid="first-profit">
            <p className="flex items-center gap-2 text-sm font-semibold text-success-text">
              <Sparkles aria-hidden className="size-4" />
              Your first profit number
            </p>
            {state.moneyHidden || profit.profitCents === null ? (
              <p className="mt-2 text-base text-fg">
                {profit.jobNumber} has {formatNumber(profit.unitsGood, { maxDigits: 0 })} units in {formatNumber(profit.hours, { maxDigits: 1 })} labor hours. Your role does not show money, so ask an admin if you need to see the profit.
              </p>
            ) : (
              <>
                <p className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-fg">
                  <span className="text-3xl font-semibold tabular-nums" data-testid="first-profit-value">
                    {formatMoney(profit.profitCents)}
                  </span>
                  <span className="text-base">
                    profit on {profit.jobNumber} so far{profit.marginBp !== null ? `, a ${formatPercentBp(profit.marginBp)} margin` : ''}
                  </span>
                  <ExplainNumber metric="profit" scope={{ jobId: profit.jobId, from: '2000-01-01', to: '2100-01-01' }} label="How we got this profit" align="start" />
                </p>
                <p className="mt-1 text-sm text-fg-secondary tabular-nums">
                  {formatMoney(profit.revenueCents)} earned less {formatMoney(profit.costCents)} of cost. The cost is {formatNumber(profit.hours, { maxDigits: 1 })} labor hours at your labor rate, plus anything else on the job.
                </p>
              </>
            )}
            <div className="mt-3 flex flex-wrap gap-2">
              <ButtonLink href={routes.job(profit.jobNumber)} icon={<ArrowRight aria-hidden className="size-4" />} testId="first-profit-open">
                Open the job
              </ButtonLink>
              <ButtonLink href={routes.home()} variant="secondary">
                Go to Home
              </ButtonLink>
            </div>
          </div>
        ) : null}
      </section>

      <section aria-labelledby="other-ways" className="flex flex-col gap-3">
        <h2 id="other-ways" className="text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
          Other ways to start
        </h2>
        <Panel>
          <SampleDataCard initial={state.sample} canManage={shell.can('sample:manage')} compact />
        </Panel>
        <ul className="grid gap-3 sm:grid-cols-2">
          {canLog ? (
            <li>
              <Link href={routes.importCenter()} data-testid="start-import" className="group flex h-full items-start gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
                  <FileSpreadsheet className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">Import spreadsheets</span>
                  <span className="mt-0.5 block text-sm text-fg-muted">Bring in clients, jobs, daily production and costs from the files you already keep. Every kind of data has a template.</span>
                </span>
                <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ) : null}
          {connected.length > 0 && shell.can('settings:manage') ? (
            <li>
              <Link href={routes.settingsApps()} data-testid="start-connect" className="group flex h-full items-start gap-3 rounded-xl border border-border-subtle bg-panel p-4 shadow-xs transition-colors hover:border-border-strong hover:bg-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
                <span aria-hidden className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary-subtle text-primary-text">
                  <Plug className="size-5" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-semibold text-fg">Use your KitStak apps</span>
                  <span className="mt-0.5 block text-sm text-fg-muted">Pulse can read {connected.join(', ')} for this workspace, so deals, work orders and time flow in on their own.</span>
                </span>
                <ChevronRight aria-hidden className="mt-0.5 size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ) : null}
        </ul>
      </section>

      <section aria-labelledby="next-title">
        <h2 id="next-title" className="mb-2 text-2xs font-semibold tracking-[0.06em] text-fg-muted uppercase">
          When you are ready for more
        </h2>
        <ul className="divide-y divide-border-subtle rounded-xl border border-border-subtle bg-panel shadow-xs">
          {[
            { label: 'Decide who can see money', detail: 'Supervisors and viewers see units and hours only, until you say so.', href: routes.settings('people') },
            { label: 'Set a target pace', detail: 'How many units one person should finish in an hour.', href: routes.targetPace() },
            { label: 'Tell Pulse when to warn you', detail: 'Plain sentence rules, like a job heading under 15% margin.', href: routes.alertRules() },
            { label: 'Close a month', detail: 'Lock the numbers once the month is done.', href: routes.settingsClose() },
            { label: 'How Pulse does the math', detail: 'The whole cost model in plain words.', href: routes.settings('math') },
          ].map((item) => (
            <li key={item.label}>
              <Link href={item.href} className="group flex items-center gap-3 px-4 py-3 hover:bg-hover focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus">
                <span className="min-w-0 flex-1">
                  <span className="block text-sm font-medium text-fg">{item.label}</span>
                  <span className="block text-sm text-fg-muted">{item.detail}</span>
                </span>
                <ChevronRight aria-hidden className="size-4 shrink-0 text-icon transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
