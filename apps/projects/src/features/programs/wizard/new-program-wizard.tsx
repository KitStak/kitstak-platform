'use client';
/**
 * New program wizard (/programs/new, docs/programs/SPEC.md 5.4). Steps: Start, Basics, Variants,
 * Price card, Schedule and Links and review, with a live preview rail, drafts that save on their
 * own two seconds after a change (and with Mod S), per step validation that focuses the first
 * field to fix, server field errors that send you back to the owning step, and Quick setup.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Lock, Save, X } from 'lucide-react';
import { pulseUrls } from '@kitstak/pulse-bridge/urls';
import { Button, Dialog, DialogContent, DialogFooter, DialogHeader, IconButton, WizardSteps, cn, toast } from '@/components/ui';
import { Page } from '@/components/layout/page';
import { apiGet, apiPath } from '@/lib/api-client';
import { useHotkey } from '@/lib/hooks/use-hotkeys';
import { formatRelative } from '@/lib/dates';
import { routes } from '@/lib/routes';
import type { ProgramDetailDTO } from '@/lib/program-types';
import { createProgramAction, deleteProgramDraftAction, saveProgramDraftAction } from '@/server/actions/programs';
import { useShell } from '@/features/shell/shell-context';
import { programHref, programPageLive, useHydrated } from '@/features/programs/kit';
import { PreviewRail, ProjectedMonth } from './preview-rail';
import { QuickSetup } from './quick-setup';
import { StepBasics, takenMessages } from './step-basics';
import { StepPrice } from './step-price';
import { StepReview, StepSchedule } from './step-review';
import { StepStart } from './step-start';
import { StepVariants } from './step-variants';
import {
  applyCopyInclude,
  copyIncludeText,
  emptyState,
  fixCountText,
  readCopyInclude,
  readyText,
  stateFromDraft,
  stateFromPrefill,
  stepCaption,
  stepForField,
  stepNumber,
  stepProblems,
  syncScheduleLines,
  toPayload,
  unitOf,
  visibleSteps,
  type StepId,
  type WizardEnv,
  type WizardState,
} from './wizard-model';
import type { WizardData } from './wizard-types';

function initialState(data: WizardData, env: WizardEnv): { state: WizardState; skipStart: boolean; quick: boolean } {
  if (data.draft) {
    const restored = stateFromDraft(data.draft.payload, env);
    if (restored) return { state: restored, skipStart: restored.start.mode !== null && restored.step !== 'start', quick: false };
  }
  const url = data.url;
  if (data.prefill) {
    let state = stateFromPrefill(data.prefill, env, data.prefillExtra);
    if (url.name && !state.basics.name) state = { ...state, basics: { ...state.basics, name: url.name, key: data.suggestedKey ?? state.basics.key } };
    if (state.start.mode === 'copy') state = applyCopyInclude(state, readCopyInclude(url.include), env);
    const quick = url.mode === 'quick';
    if (!url.crmItem && !url.template && !url.copy) state = { ...state, start: { ...state.start, mode: quick ? 'quick' : 'scratch' } };
    return { state: { ...state, step: 'basics' }, skipStart: true, quick };
  }
  let state = emptyState(env);
  if (url.name) state = { ...state, basics: { ...state.basics, name: url.name, key: data.suggestedKey ?? '' } };
  const mode = url.mode;
  if (mode === 'quick') return { state: { ...state, start: { ...state.start, mode: 'quick' }, step: 'basics' }, skipStart: true, quick: true };
  if (mode === 'scratch') return { state: { ...state, start: { ...state.start, mode: 'scratch' }, step: 'basics' }, skipStart: true, quick: false };
  if (mode) return { state: { ...state, start: { ...state.start, mode } }, skipStart: false, quick: false };
  return { state, skipStart: false, quick: false };
}

/** Enter in a one line field moves to the next field, never to the next step. */
function nextFieldOnEnter(event: KeyboardEvent<HTMLElement>) {
  const target = event.target as HTMLElement;
  if (event.key !== 'Enter' || event.shiftKey || event.metaKey || event.ctrlKey) return;
  if (!(target instanceof HTMLInputElement) || ['checkbox', 'radio', 'button', 'submit'].includes(target.type)) return;
  event.preventDefault();
  const fields = [...event.currentTarget.querySelectorAll<HTMLElement>('input:not([type=hidden]):not([disabled]), textarea:not([disabled]), button[role=combobox]:not([disabled])')].filter((node) => node.offsetParent !== null);
  const index = fields.indexOf(target);
  fields[index + 1]?.focus();
}

export function NewProgramWizard({ data }: { readonly data: WizardData }) {
  const router = useRouter();
  const hydrated = useHydrated();
  const { can, user, appUrls } = useShell();
  const env = useMemo<WizardEnv>(() => ({ today: data.today, userId: user.id, timezone: data.calendar.timezone, workingDays: data.calendar.workingDays, holidays: data.calendar.holidays }), [data.today, data.calendar, user.id]);
  const initial = useMemo(() => initialState(data, env), [data, env]);
  const [state, setState] = useState<WizardState>(initial.state);
  const [skipStart, setSkipStart] = useState(initial.skipStart);
  const [quick, setQuick] = useState(initial.quick);
  const [tried, setTried] = useState<ReadonlySet<StepId>>(new Set());
  const [creating, setCreating] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [draft, setDraft] = useState<{ id: string | null; version: number | undefined; savedAt: string | null }>({ id: data.draft?.id ?? null, version: data.draft?.version, savedAt: data.draft?.updatedAt ?? null });
  const [dirty, setDirty] = useState(false);
  const [, tick] = useState(0);
  const formRef = useRef<HTMLDivElement>(null);
  const savingRef = useRef(false);

  const set = useCallback((update: (s: WizardState) => WizardState) => {
    setState((old) => update(old));
    setDirty(true);
  }, []);

  const steps = visibleSteps(skipStart);
  const stepIndex = Math.max(0, steps.findIndex((step) => step.id === state.step));
  const taken = useMemo(() => takenMessages(data.taken, state.basics.name), [data.taken, state.basics.name]);
  const problems = stepProblems(state, state.step, taken);
  const showErrors = tried.has(state.step);
  const moneyVisible = true;

  // Re-render the "Draft saved 2 min ago" text.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 30_000);
    return () => clearInterval(timer);
  }, []);

  const saveDraft = useCallback(
    async (manual: boolean) => {
      if (savingRef.current) return;
      if (!state.basics.name.trim()) {
        if (manual) toast.info('Name the program first', 'Drafts save once the program has a name.');
        return;
      }
      savingRef.current = true;
      const result = await saveProgramDraftAction({ id: draft.id ?? undefined, title: state.basics.name.trim(), step: stepNumber(state.step), payload: state as unknown as Record<string, unknown>, expectedVersion: draft.version });
      savingRef.current = false;
      if (!result.ok) {
        if (result.error.code === 'CONFLICT') {
          // Someone (another tab) saved this draft: keep typing on a fresh copy.
          setDraft({ id: null, version: undefined, savedAt: null });
        }
        if (manual) toast.error("Couldn't save the draft", result.error.message);
        return;
      }
      setDraft({ id: result.data.id, version: result.data.version, savedAt: result.data.savedAt });
      setDirty(false);
      if (manual) toast.success('Draft saved', 'Find it under New program, Resume a draft.');
    },
    [draft.id, draft.version, state],
  );

  // Autosave two seconds after the last change, once the name is filled.
  useEffect(() => {
    if (!dirty || creating || !state.basics.name.trim()) return;
    const timer = setTimeout(() => void saveDraft(false), 2000);
    return () => clearTimeout(timer);
  }, [dirty, creating, state, saveDraft]);

  useHotkey('mod+s', () => void saveDraft(true), { allowInInputs: true });

  const goTo = (step: StepId) => {
    setState((old) => {
      const moved = { ...old, step };
      if (step !== 'schedule' && step !== 'review') return moved;
      // Keep the schedule lines in step with the variants; the run takes its name from the program.
      const synced = syncScheduleLines(moved);
      return synced.schedule.name || !old.basics.name ? synced : { ...synced, schedule: { ...synced.schedule, name: `${old.basics.name.trim()} run` } };
    });
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const focusFirstProblem = () => {
    requestAnimationFrame(() => {
      const node = formRef.current?.querySelector<HTMLElement>('[aria-invalid="true"], [role="alert"]');
      if (!node) return;
      const focusable = node.matches('input, textarea, button') ? node : node.closest('[data-field]')?.querySelector<HTMLElement>('input, button, textarea');
      (focusable ?? node).focus?.();
      node.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  };

  const startContinue = () => {
    const mode = state.start.mode;
    if (!mode) return;
    if (mode === 'deal' && state.start.crmItemId) return router.push(routes.newProgram({ crmItem: state.start.crmItemId }));
    if (mode === 'template' && state.start.templateId) return router.push(routes.newProgram({ template: state.start.templateId }));
    if (mode === 'copy' && state.start.copyKey) return router.push(`${routes.newProgram({ copy: state.start.copyKey })}&include=${encodeURIComponent(copyIncludeText(state.start.copyInclude))}`);
    goTo('basics');
  };

  const next = () => {
    if (Object.keys(problems).length > 0) {
      setTried((old) => new Set([...old, state.step]));
      focusFirstProblem();
      return;
    }
    if (state.step === 'start') return startContinue();
    const following = steps[stepIndex + 1];
    if (following) goTo(following.id);
  };

  const back = () => {
    const previous = steps[stepIndex - 1];
    if (previous) goTo(previous.id);
  };

  const create = async (input: WizardState = state) => {
    // Every step must be fine; the first one with problems takes the focus.
    for (const step of steps) {
      if (step.id === 'start') continue;
      if (Object.keys(stepProblems(input, step.id, taken)).length > 0) {
        setTried((old) => new Set([...old, step.id]));
        goTo(step.id);
        toast.error('A step needs another look', `Fix ${step.title} first.`);
        focusFirstProblem();
        return;
      }
    }
    setCreating(true);
    const result = await createProgramAction(toPayload(input));
    if (!result.ok) {
      setCreating(false);
      const fields = Object.keys(result.error.fields ?? {});
      toast.error("Couldn't create the program", result.error.message);
      if (fields.length) {
        const owner = stepForField(fields[0]!);
        setTried((old) => new Set([...old, owner]));
        goTo(owner === 'start' ? 'basics' : owner);
      }
      return;
    }
    const { key, generated } = result.data;
    if (draft.id) void deleteProgramDraftAction({ id: draft.id });
    setDirty(false);
    const scheduled = input.schedule.enabled && input.schedule.lines.some((line) => line.include);
    toast.success(readyText(key, generated, input.schedule.leadDays, scheduled), input.price.later ? 'Add a price card from its Price card tab.' : undefined);
    if (input.links.pulse === 'new') {
      try {
        const detail = await apiGet<ProgramDetailDTO>(apiPath(`programs/${key}`));
        const url = pulseUrls(appUrls.pulse ?? '').newJobFromProgram({ programId: detail.id, name: input.basics.name, clientHint: input.basics.customer?.id ?? null, unitLabel: unitOf(input.basics).plural });
        window.open(url, '_blank', 'noopener');
      } catch {
        toast.info('Make the Pulse job from the program', 'Open the program and use Link a Pulse job.');
      }
    }
    const home = programHref(key) ?? routes.programs();
    const openPlanner = input.links.openPlanner ?? !scheduled;
    const overlay = programPageLive('overlays') && programHref(key) ? (input.links.importPast ? '?import=output' : openPlanner ? '?plan=week' : '') : '';
    router.push(`${home}${overlay}`);
    router.refresh();
  };

  const close = () => {
    if (dirty && state.basics.name.trim()) setLeaving(true);
    else router.push(routes.programs());
  };

  if (!can('project:create')) {
    return (
      <Page title="New program" width="narrow" breadcrumbs={[{ label: 'Programs', href: routes.programs() }, { label: 'New program' }]}>
        <div className="rounded-xl border border-border-subtle bg-panel p-6 text-center">
          <Lock aria-hidden className="mx-auto mb-2 size-6 text-icon" />
          <p className="font-semibold text-fg">You can&apos;t create programs in this workspace</p>
          <p className="mt-1 text-sm text-fg-muted">Ask an admin to let you create programs, or to create this one for you.</p>
        </div>
      </Page>
    );
  }

  const savedText = draft.savedAt && hydrated ? `Draft saved ${formatRelative(draft.savedAt)}` : dirty && state.basics.name.trim() ? 'Saving soon' : null;
  const headerActions = (
    <div className="flex items-center gap-2">
      {savedText ? <span className="hidden text-xs text-fg-muted sm:inline" aria-live="polite" data-testid="draft-saved">{savedText}</span> : null}
      <Button variant="secondary" leadingIcon={<Save aria-hidden />} onClick={() => void saveDraft(true)} data-testid="save-draft">Save draft</Button>
      <IconButton label="Close" icon={<X aria-hidden />} onClick={close} />
    </div>
  );

  const leaveDialog = (
    <Dialog open={leaving} onOpenChange={setLeaving}>
      <DialogContent size="sm" role="alertdialog" hideClose>
        <DialogHeader title="Leave without saving?" description="Your latest changes are not in the draft yet." />
        <DialogFooter>
          <Button variant="ghost" onClick={() => setLeaving(false)}>Keep editing</Button>
          <Button variant="secondary" onClick={() => router.push(routes.programs())}>Discard</Button>
          <Button onClick={async () => { await saveDraft(true); router.push(routes.programs()); }}>Save draft</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );

  if (quick) {
    return (
      <Page title="Quick setup" subtitle="Name, kits and one rate on one page. Everything else takes its default." width="narrow" breadcrumbs={[{ label: 'Programs', href: routes.programs() }, { label: 'New program' }]} actions={headerActions}>
        <QuickSetup
          state={state}
          set={set}
          data={data}
          env={env}
          creating={creating}
          onCreate={(input) => { setState(input); void create(input); }}
          onFullSetup={() => {
            setQuick(false);
            setSkipStart(true);
            setState((old) => ({ ...old, start: { ...old.start, mode: 'scratch' }, step: 'basics' }));
          }}
        />
        {leaveDialog}
      </Page>
    );
  }

  const isLast = state.step === 'review';
  const optional = state.step === 'schedule' || state.step === 'review';
  const fix = showErrors ? fixCountText(problems) : null;
  const title = steps[stepIndex]?.title ?? '';

  return (
    <Page title="New program" breadcrumbs={[{ label: 'Programs', href: routes.programs() }, { label: 'New program' }]} actions={headerActions}>
      <WizardSteps steps={steps.map((step) => ({ id: step.id, title: step.title }))} current={stepIndex} className="mb-6 hidden max-w-[900px] px-0 md:flex" />
      <p className="mb-4 text-sm font-medium text-fg-secondary md:hidden" data-testid="wizard-step-caption">{stepCaption(steps, state.step)}</p>

      <div className={cn('grid items-start gap-6', state.step !== 'start' && 'lg:grid-cols-[minmax(0,1fr)_320px]')}>
        <div ref={formRef} key={state.step} className="flex max-w-[760px] min-w-0 animate-step-in flex-col gap-5" onKeyDown={nextFieldOnEnter} data-testid={`wizard-step-${state.step}`}>
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="text-lg font-semibold text-fg">{state.step === 'start' ? 'How do you want to start?' : title}</h2>
            {fix ? <span className="text-sm font-semibold text-danger-text" data-testid="fix-count">{fix}</span> : null}
          </div>

          {state.step === 'start' ? (
            <StepStart
              state={state}
              set={set}
              data={data}
              problems={problems}
              showErrors={showErrors}
              onPickDeal={(id, title) => set((s) => ({ ...s, start: { ...s.start, crmItemId: id, crmItemTitle: title } }))}
              onPickTemplate={(id, name) => set((s) => ({ ...s, start: { ...s.start, templateId: id, templateName: name } }))}
              onPickCopy={(key) => set((s) => ({ ...s, start: { ...s.start, copyKey: key } }))}
            />
          ) : state.step === 'basics' ? (
            <StepBasics state={state} set={set} data={data} problems={problems} showErrors={showErrors} moneyVisible={moneyVisible} onChangeStart={() => router.push(routes.newProgram())} />
          ) : state.step === 'variants' ? (
            <StepVariants state={state} set={set} data={data} problems={problems} showErrors={showErrors} />
          ) : state.step === 'price' ? (
            <StepPrice state={state} set={set} data={data} problems={problems} showErrors={showErrors} env={env} onLater={() => { set((s) => ({ ...s, price: { ...s.price, later: true } })); goTo('schedule'); }} />
          ) : state.step === 'schedule' ? (
            <StepSchedule state={state} set={set} data={data} problems={problems} showErrors={showErrors} env={env} />
          ) : (
            <StepReview state={state} set={set} data={data} problems={problems} showErrors={showErrors} env={env} goTo={goTo} />
          )}

          {state.step !== 'start' ? (
            <div className="lg:hidden">
              <button type="button" onClick={() => setPreviewOpen((open) => !open)} aria-expanded={previewOpen} className="flex w-full items-center justify-between rounded-lg border border-border-subtle bg-panel px-3 py-2 text-sm font-medium text-fg outline-none focus-visible:outline-2 focus-visible:outline-focus">
                Preview
                <ChevronDown aria-hidden className={cn('size-4 text-icon transition-transform', previewOpen && 'rotate-180')} />
              </button>
              {previewOpen ? <div className="mt-2"><ProjectedMonth state={state} env={env} compact /></div> : null}
            </div>
          ) : null}

          <div className="sticky bottom-0 z-[2] -mx-6 flex items-center justify-between gap-3 border-t border-border-subtle bg-app/95 px-6 py-3 backdrop-blur md:static md:mx-0 md:bg-transparent md:px-0 md:pt-5 md:pb-0 md:backdrop-blur-none">
            {stepIndex > 0 ? (
              <Button variant="ghost" leadingIcon={<ArrowLeft aria-hidden />} onClick={back} disabled={creating}>Back</Button>
            ) : (
              <span />
            )}
            <div className="flex items-center gap-2">
              {optional && !isLast ? <Button variant="secondary" onClick={() => { set((s) => ({ ...s, schedule: { ...s.schedule, enabled: false } })); goTo('review'); }}>Skip</Button> : null}
              {isLast ? (
                <Button size="lg" loading={creating} onClick={() => void create()} data-testid="create-program">{creating ? 'Creating program' : 'Create program'}</Button>
              ) : (
                <Button trailingIcon={<ArrowRight aria-hidden />} onClick={next} disabled={state.step === 'start' && !state.start.mode} data-testid="wizard-next">Continue</Button>
              )}
            </div>
          </div>
        </div>

        {state.step !== 'start' ? (
          <div className="sticky top-4 hidden lg:block">
            <PreviewRail state={state} env={env} onGo={(step) => goTo(step)} />
          </div>
        ) : null}
      </div>
      {leaveDialog}
    </Page>
  );
}
