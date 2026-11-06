'use client';
/**
 * /welcome onboarding: About you → Team size → What you manage → Starter CRM → Invite → Done.
 * Left-rail stepper (completed steps clickable), per-step validation, Enter = Continue,
 * Back / Skip, animated transitions, draft saved locally so a refresh resumes, and a single
 * POST /onboarding (plus invitations) at the end, landing on the new org home.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { ArrowRight, Check, LayoutDashboard, PartyPopper, Sparkles } from 'lucide-react';
import { Badge, Button, Field, Input, Switch, cn } from '@/components/ui';
import { Logo } from '@/features/shell/logo';
import { ApiClientError, apiRequest } from '@/lib/api';
import type { MeDto, OnboardingResultDto } from '@/server/services/contracts/dto';
import { sendInvitations } from '../api';
import { InviteeList } from '../components/invitee-list';
import { ChoiceChips, InlineError, OptionCards } from '../components/primitives';
import { StepTransition } from '../components/step-transition';
import { BoardGlyph } from '../components/template-icons';
import { TemplateThumbnail } from '../components/template-thumbnail';
import { OnboardingPreview, type StarterPreviews } from './onboarding-preview';

export type { StarterPreviews } from './onboarding-preview';
import { grantableRoles, type InviteRole } from '../model/invites';
import {
  EMPTY_DRAFT,
  MANAGE_OPTIONS,
  ONBOARDING_STEPS,
  ORG_NAME_MAX,
  ROLE_OPTIONS,
  STARTERS,
  TEAM_SIZES,
  buildOnboardingPayload,
  clearDraft,
  findCommittedOrg,
  loadDraft,
  recommendStarter,
  saveDraft,
  starterTemplateIds,
  validateStep,
  type ManageId,
  type OnboardingDraft,
  type RoleId,
  type StarterId,
  type TeamSize,
} from '../model/onboarding';

const TEMPLATE_NAMES: Readonly<Record<string, string>> = {
  'crm-leads': 'Leads',
  'crm-deals': 'Deals',
  'crm-accounts': 'Accounts',
  'crm-contacts': 'Contacts',
  'crm-activities': 'Activities',
  'cs-onboarding': 'Customer onboarding',
  'cs-renewals': 'Renewals',
  'sales-quotes': 'Quotes & proposals',
};

/** Width of the step content + preview; the footer uses the same container so buttons line up. */
const COLUMN = 'mx-auto w-full max-w-[600px] xl:max-w-[1040px]';

const TEAM_SIZE_COPY: Readonly<Record<TeamSize, { title: string; description: string }>> = {
  '1': { title: 'Just me', description: 'Solo seller or founder' },
  '2-5': { title: '2–5 people', description: 'A small, close team' },
  '6-20': { title: '6–20 people', description: 'A growing sales team' },
  '21-100': { title: '21–100 people', description: 'Several teams' },
  '101-500': { title: '101–500 people', description: 'Multiple departments' },
  '500+': { title: '500+ people', description: 'Enterprise rollout' },
};

const STEP_COPY: Readonly<Record<string, { title: (name: string) => string; subtitle: string }>> = {
  about: {
    title: (name) => (name ? `Welcome, ${name}. Let’s set up KitStak.` : 'Welcome. Let’s set up KitStak.'),
    subtitle: 'Tell us a little about you so we can tailor your workspace.',
  },
  team: { title: () => 'How big is your team?', subtitle: 'We’ll suggest the right way to share boards and dashboards.' },
  manage: { title: () => 'What do you want to manage?', subtitle: 'Pick everything that applies. You can add more later.' },
  starter: { title: () => 'Pick your starter CRM', subtitle: 'Every board comes connected, with views and a dashboard ready to go.' },
  invite: { title: () => 'Invite your teammates', subtitle: 'KitStak works best together. You can skip this and invite people later.' },
  done: { title: () => 'Your workspace is ready', subtitle: 'Everything is set up. Jump in and add your first deal.' },
};

function storage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Make everything outside the overlay inert while it is shown (the auth layout sits behind). */
function useInertSiblings(ref: React.RefObject<HTMLElement | null>) {
  useLayoutEffect(() => {
    const touched: HTMLElement[] = [];
    let node = ref.current;
    while (node && node.parentElement && node !== document.body) {
      for (const sibling of Array.from(node.parentElement.children)) {
        if (sibling !== node && sibling instanceof HTMLElement && !sibling.inert && sibling.tagName !== 'SCRIPT') {
          sibling.inert = true;
          touched.push(sibling);
        }
      }
      node = node.parentElement;
    }
    return () => {
      for (const element of touched) element.inert = false;
    };
  }, [ref]);
}

interface Completion {
  readonly result: OnboardingResultDto;
  readonly invited: number;
  readonly inviteFailures: number;
}

const subscribeNothing = () => () => {};

/** Client-only gate: the saved draft lives in localStorage, so render the flow after hydration. */
export interface OnboardingFlowProps {
  readonly firstName: string;
  readonly retry?: boolean;
  /** Mini-board previews keyed by template id (computed on the server). */
  readonly previews?: StarterPreviews;
}

export function OnboardingFlow(props: OnboardingFlowProps) {
  const isClient = useSyncExternalStore(subscribeNothing, () => true, () => false);
  if (!isClient) {
    return <div aria-busy="true" className="fixed inset-0 z-[var(--z-overlay)] bg-panel lg:grid lg:grid-cols-[320px_1fr]"><div className="auth-hero hidden lg:block" /></div>;
  }
  return <OnboardingFlowInner {...props} />;
}

function OnboardingFlowInner({ firstName, retry = false, previews = {} }: OnboardingFlowProps) {
  const router = useRouter();
  const rootRef = useRef<HTMLDivElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [saved] = useState(() => loadDraft(storage()));
  const [step, setStep] = useState(saved?.step ?? 0);
  const [maxReached, setMaxReached] = useState(saved?.step ?? 0);
  const [direction, setDirection] = useState<1 | -1>(1);
  const [draft, setDraft] = useState<OnboardingDraft>(saved?.draft ?? EMPTY_DRAFT);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [defaultRole, setDefaultRole] = useState<InviteRole>('member');
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(
    retry ? 'Your account is ready, but we couldn’t finish setting up your workspace. Let’s try again.' : null,
  );
  const [completion, setCompletion] = useState<Completion | null>(null);
  /** Orgs the user belonged to before the first POST, and whether a POST may have reached the server. */
  const knownOrgIds = useRef<ReadonlySet<string> | null>(null);
  const attempted = useRef(false);

  useInertSiblings(rootRef);

  useEffect(() => {
    if (!completion) saveDraft(storage(), { step, draft });
  }, [step, draft, completion]);

  const current = ONBOARDING_STEPS[step] ?? ONBOARDING_STEPS[0];
  const total = ONBOARDING_STEPS.length;
  const recommended = useMemo(() => recommendStarter(draft), [draft]);
  const starter: StarterId = draft.starter ?? recommended;

  // Move focus to the step heading so screen readers announce the new step.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (current.id === 'about') document.getElementById('onboarding-org-name')?.focus();
      else headingRef.current?.focus();
    }, 280);
    return () => window.clearTimeout(timer);
  }, [step, current.id]);

  const update = (patch: Partial<OnboardingDraft>) => {
    setDraft((value) => ({ ...value, ...patch }));
    if (Object.keys(errors).length) setErrors({});
  };

  const goTo = (index: number) => {
    setDirection(index > step ? 1 : -1);
    setStep(index);
    setMaxReached((value) => Math.max(value, index));
  };

  const finish = useCallback(
    async (finalDraft: OnboardingDraft) => {
      setSubmitting(true);
      setSubmitError(null);
      const payload = buildOnboardingPayload(finalDraft, firstName);
      let result: OnboardingResultDto;
      try {
        if (!knownOrgIds.current || attempted.current) {
          // Snapshot memberships before the first POST; on a retry, look for the org an earlier
          // POST created (its response may have been lost) instead of creating a second one.
          const me = await apiRequest<MeDto>('/me');
          if (attempted.current && knownOrgIds.current) {
            const committed = findCommittedOrg(me.organizations, knownOrgIds.current, payload.organizationName);
            if (committed) {
              clearDraft(storage());
              router.replace(`/${committed.slug}`);
              router.refresh();
              return;
            }
          }
          if (!knownOrgIds.current) knownOrgIds.current = new Set(me.organizations.map((org) => org.id));
        }
        attempted.current = true;
        result = await apiRequest<OnboardingResultDto>('/onboarding', { method: 'POST', body: payload });
      } catch (cause) {
        setSubmitting(false);
        setSubmitError(
          cause instanceof ApiClientError && cause.code !== 'NETWORK_ERROR'
            ? cause.message
            : 'We couldn’t reach KitStak. Check your connection and try again.',
        );
        return;
      }
      let invited = 0;
      let inviteFailures = 0;
      if (finalDraft.invitees.length) {
        try {
          const results = await sendInvitations(result.organization.id, {
            invitations: finalDraft.invitees.map((invitee) => ({ email: invitee.email, role: invitee.role })),
          });
          invited = results.filter((row) => row.ok).length;
          inviteFailures = results.length - invited;
        } catch {
          inviteFailures = finalDraft.invitees.length;
        }
      }
      clearDraft(storage());
      setCompletion({ result, invited, inviteFailures });
      setSubmitting(false);
      setDirection(1);
      setStep(total - 1);
      setMaxReached(total - 1);
    },
    [firstName, total, router],
  );

  const next = (event?: FormEvent) => {
    event?.preventDefault();
    if (submitting) return;
    if (current.id === 'done') {
      if (completion) {
        setSubmitting(true);
        router.replace(`/${completion.result.organization.slug}`);
        router.refresh();
      }
      return;
    }
    const found = validateStep(current.id, draft);
    setErrors(found);
    if (Object.keys(found).length) {
      document.getElementById('onboarding-org-name')?.focus();
      return;
    }
    if (current.id === 'invite') {
      void finish(draft);
      return;
    }
    goTo(step + 1);
  };

  const skipStep = () => {
    if (current.id === 'invite') void finish({ ...draft, invitees: [] });
    else goTo(step + 1);
  };

  const skipAll = () => {
    if (submitting) return;
    void finish({ ...draft, starter: draft.starter ?? recommended, invitees: draft.invitees });
  };

  const copy = STEP_COPY[current.id] ?? STEP_COPY.about!;
  const progressPct = Math.round((step / (total - 1)) * 100);
  const isDone = current.id === 'done';

  return (
    <div
      ref={rootRef}
      data-testid="onboarding-flow"
      className="fixed inset-0 z-[var(--z-overlay)] flex flex-col overflow-hidden bg-panel text-fg lg:grid lg:grid-cols-[320px_minmax(0,1fr)]"
    >
      {/* Rail (desktop) */}
      <aside className="auth-hero relative hidden flex-col gap-10 overflow-y-auto p-8 pb-20 text-white lg:flex" aria-label="Setup progress">
        <Logo size={30} tone="inverse" />
        <ol className="flex flex-col gap-1" data-testid="onboarding-stepper">
          {ONBOARDING_STEPS.map((item, index) => {
            const state = index < step ? 'done' : index === step ? 'current' : 'upcoming';
            const clickable = !completion && index !== step && index <= maxReached && item.id !== 'done' && !submitting;
            return (
              <li key={item.id} aria-current={state === 'current' ? 'step' : undefined}>
                <button
                  type="button"
                  disabled={!clickable}
                  onClick={() => goTo(index)}
                  className={cn(
                    'flex h-11 w-full items-center gap-3 rounded-lg px-3 text-left text-md transition-colors duration-[var(--duration-fast)]',
                    'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white disabled:cursor-default',
                    state === 'current' ? 'bg-white/15 font-semibold' : 'text-white/80',
                    clickable && 'hover:bg-white/10 hover:text-white',
                  )}
                >
                  <span
                    className={cn(
                      'inline-flex size-6 shrink-0 items-center justify-center rounded-full text-xs font-semibold transition-colors duration-[var(--duration-normal)]',
                      state === 'done' ? 'bg-white text-[var(--primary-700)]' : state === 'current' ? 'bg-white/25 ring-2 ring-white' : 'bg-white/10',
                    )}
                  >
                    {state === 'done' ? <Check aria-hidden strokeWidth={3} className="size-3.5" /> : index + 1}
                  </span>
                  <span className="truncate">{item.title}</span>
                  {item.optional && state === 'upcoming' ? <span className="ml-auto text-xs text-white/60">Optional</span> : null}
                </button>
              </li>
            );
          })}
        </ol>
        <p className="text-sm text-white/80" data-testid="onboarding-rail-note">
          You can change everything later in settings. Nothing is shared until you invite people.
        </p>
      </aside>

      {/* Main */}
      <div className="flex min-h-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border-subtle px-4 py-3 lg:border-b-0 lg:px-10 lg:pt-6">
          <span className="lg:hidden">
            <Logo size={26} />
          </span>
          <span className="ml-auto text-sm text-fg-muted tabular-nums" data-testid="onboarding-step-count">
            Step {step + 1} of {total}
          </span>
          {!isDone ? (
            <Button variant="ghost" size="sm" onClick={skipAll} disabled={submitting} data-testid="onboarding-skip-all">
              Skip setup
            </Button>
          ) : null}
        </header>
        <div
          className="h-1 bg-muted lg:mx-10 lg:rounded-full"
          role="progressbar"
          aria-label="Setup progress"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={progressPct}
        >
          <div
            className="h-full rounded-full bg-primary transition-[width] duration-[var(--duration-slower)] ease-[var(--ease-standard)]"
            style={{ width: `${Math.max(4, progressPct)}%` }}
          />
        </div>

        <form
          noValidate
          onSubmit={next}
          onKeyDown={(event) => {
            // Enter always means Continue: on a radio it picks that option first, on a
            // checkbox (Space toggles) it just advances.
            const target = event.target as HTMLElement;
            const role = target.getAttribute('role');
            if (event.key !== 'Enter' || (role !== 'radio' && role !== 'checkbox')) return;
            event.preventDefault();
            if (role === 'radio') target.click();
            next();
          }}
          className="flex min-h-0 flex-1 flex-col"
        >
          <ScrollFade>
            <div
              className={cn(
                COLUMN,
                // Top-anchored so the heading stays put between steps; short steps leave room below.
                'grid items-start gap-10 xl:grid-cols-[minmax(0,600px)_minmax(0,380px)] xl:justify-between',
              )}
            >
              <StepTransition stepKey={current.id} direction={direction}>
                <div className="flex flex-col gap-6">
                  <div className="flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                    {isDone ? (
                      <span className="inline-flex size-10 shrink-0 animate-pop-in items-center justify-center rounded-full bg-success-subtle text-success">
                        <PartyPopper aria-hidden className="size-5" />
                      </span>
                    ) : null}
                    <h1
                      ref={headingRef}
                      tabIndex={-1}
                      className="font-heading text-2xl font-semibold tracking-[-0.01em] text-fg outline-none"
                      data-testid="onboarding-heading"
                    >
                      {copy.title(firstName)}
                    </h1>
                    </div>
                    <p className="text-md text-fg-secondary [text-wrap:pretty]">{copy.subtitle}</p>
                  </div>

                  {submitError && !isDone ? (
                    <InlineError onRetry={current.id === 'invite' ? () => void finish(draft) : undefined}>{submitError}</InlineError>
                  ) : null}

                  <StepBody
                    stepId={current.id}
                    draft={draft}
                    errors={errors}
                    update={update}
                    recommended={recommended}
                    starter={starter}
                    previews={previews}
                    defaultRole={defaultRole}
                    setDefaultRole={setDefaultRole}
                    submitting={submitting}
                    completion={completion}
                    onSubmitShortcut={() => next()}
                  />
                </div>
              </StepTransition>
              {!isDone ? (
                <div className="hidden xl:block">
                  <OnboardingPreview draft={draft} starter={starter} firstName={firstName} previews={previews} stepId={current.id} />
                </div>
              ) : null}
            </div>
          </ScrollFade>

          <footer className="border-t border-border-subtle px-4 py-3 sm:px-8 lg:px-12">
            <div className={cn(COLUMN, 'flex items-center gap-2')} data-testid="onboarding-footer">
            {step > 0 && !isDone ? (
              <Button variant="ghost" size="lg" onClick={() => goTo(step - 1)} disabled={submitting} data-testid="onboarding-back">
                Back
              </Button>
            ) : null}
            <span className="flex-1" />
            {current.optional && !isDone ? (
              <Button variant="tertiary" size="lg" onClick={skipStep} disabled={submitting} data-testid="onboarding-skip">
                Skip
              </Button>
            ) : null}
            <Button
              type="submit"
              size="lg"
              loading={submitting}
              trailingIcon={<ArrowRight aria-hidden />}
              data-testid="onboarding-next"
            >
              {isDone ? 'Go to my workspace' : current.id === 'invite' ? (draft.invitees.length ? 'Invite and finish' : 'Finish setup') : 'Continue'}
            </Button>
            </div>
          </footer>
        </form>
      </div>
    </div>
  );
}

function listJoin(items: readonly string[]): string {
  if (items.length <= 1) return items.join('');
  return `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`;
}

/**
 * Scroll area for the step content with a bottom fade + shadow above the footer whenever more
 * content sits below the fold, so nothing looks cut off by the footer.
 */
function ScrollFade({ children }: { readonly children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [more, setMore] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    const measure = () => setMore(node.scrollHeight - node.scrollTop - node.clientHeight > 4);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    for (const child of Array.from(node.children)) observer.observe(child);
    node.addEventListener('scroll', measure, { passive: true });
    return () => {
      observer.disconnect();
      node.removeEventListener('scroll', measure);
    };
  }, []);
  return (
    <div className="relative flex min-h-0 flex-1 flex-col">
      <div
        ref={ref}
        data-testid="onboarding-scroll"
        className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 pt-[clamp(24px,8vh,96px)] pb-10 sm:px-8 lg:px-12"
      >
        {children}
      </div>
      <div
        aria-hidden
        data-testid="onboarding-scroll-fade"
        data-visible={more || undefined}
        className={cn(
          'pointer-events-none absolute inset-x-0 bottom-0 h-12 bg-gradient-to-t from-[var(--surface-panel)] to-transparent opacity-0 transition-opacity duration-[var(--duration-fast)] ease-out',
          more && 'opacity-100',
        )}
      />
    </div>
  );
}

interface StepBodyProps {
  readonly stepId: string;
  readonly draft: OnboardingDraft;
  readonly errors: Record<string, string>;
  readonly update: (patch: Partial<OnboardingDraft>) => void;
  readonly recommended: StarterId;
  readonly starter: StarterId;
  readonly previews: StarterPreviews;
  readonly defaultRole: InviteRole;
  readonly setDefaultRole: (role: InviteRole) => void;
  readonly submitting: boolean;
  readonly completion: Completion | null;
  readonly onSubmitShortcut: () => void;
}

function StepBody({
  stepId,
  draft,
  errors,
  update,
  recommended,
  starter,
  previews,
  defaultRole,
  setDefaultRole,
  submitting,
  completion,
  onSubmitShortcut,
}: StepBodyProps) {
  if (stepId === 'about') {
    return (
      <div className="flex flex-col gap-6">
        <Field label="Company or team name" required error={errors.organizationName}>
          {({ describedBy, invalid }) => (
            <Input
              id="onboarding-org-name"
              size="lg"
              autoComplete="organization"
              value={draft.organizationName}
              maxLength={ORG_NAME_MAX + 10}
              onChange={(event) => update({ organizationName: event.target.value })}
              placeholder="e.g. Acme Robotics"
              aria-describedby={describedBy}
              invalid={invalid}
              data-testid="onboarding-org-input"
            />
          )}
        </Field>
        <fieldset>
          <legend className="mb-2 text-sm font-semibold text-fg-secondary">What best describes your role?</legend>
          <OptionCards<RoleId>
            label="Your role"
            testId="onboarding-roles"
            columns={2}
            compact
            className="auto-rows-fr"
            value={draft.role}
            onChange={(role) => update({ role })}
            options={ROLE_OPTIONS.map((option) => ({ value: option.id, title: option.label, description: option.hint }))}
          />
        </fieldset>
      </div>
    );
  }
  if (stepId === 'team') {
    return (
      <OptionCards<TeamSize>
        label="Team size"
        testId="onboarding-team-size"
        columns={3}
        compact
        className="auto-rows-fr max-sm:grid-cols-2"
        options={TEAM_SIZES.map((size) => ({ value: size, ...TEAM_SIZE_COPY[size] }))}
        value={draft.teamSize}
        onChange={(teamSize) => update({ teamSize })}
      />
    );
  }
  if (stepId === 'manage') {
    return (
      <ChoiceChips<ManageId>
        label="What you manage"
        size="lg"
        multiple
        testId="onboarding-manages"
        options={MANAGE_OPTIONS.map((option) => ({ value: option.id, label: option.label }))}
        value={draft.manages}
        onToggle={(id) =>
          update({ manages: draft.manages.includes(id) ? draft.manages.filter((value) => value !== id) : [...draft.manages, id] })
        }
      />
    );
  }
  if (stepId === 'starter') {
    const boardIds = starterTemplateIds(starter, draft.manages);
    const boards = boardIds.map((id) => TEMPLATE_NAMES[id] ?? id);
    // Three tiles fill one row: up to three thumbnails, or two plus a "+N more" tile.
    const withPreview = boardIds.filter((id) => previews[id]);
    const shown = withPreview.length > 3 ? withPreview.slice(0, 2) : withPreview;
    const extra = withPreview.length - shown.length;
    return (
      <div className="flex flex-col gap-5">
        <OptionCards<StarterId>
          label="Starter CRM"
          testId="onboarding-starters"
          columns={2}
          className="auto-rows-fr"
          value={starter}
          onChange={(value) => update({ starter: value })}
          options={STARTERS.map((option) => ({
            value: option.id,
            title: option.title,
            description: option.description,
            badge:
              option.id === recommended ? (
                <Badge tone="primary" size="sm" icon={<Sparkles aria-hidden />}>
                  Recommended
                </Badge>
              ) : undefined,
          }))}
        />
        <Switch
          checked={draft.withSampleData}
          onCheckedChange={(withSampleData) => update({ withSampleData })}
          label="Include sample data"
          description="Explore with realistic example deals and accounts. Clear them any time."
        />
        <div className="flex flex-col gap-2">
          <p className="text-sm font-semibold text-fg-secondary" data-testid="onboarding-board-list">
            You’ll get {listJoin(boards)}
            {boards.includes('Deals') ? (
              <span className="font-normal text-fg-muted">
                {' '}
                + <LayoutDashboard aria-hidden className="inline size-3.5 align-[-2px] text-icon" /> Sales dashboard
              </span>
            ) : null}
          </p>
          <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-testid="onboarding-starter-thumbnails">
            {shown.map((id) => {
              const preview = previews[id];
              if (!preview) return null;
              return (
                <li key={id} className="h-[124px] animate-fade-in overflow-hidden rounded-xl border border-border-subtle">
                  <TemplateThumbnail board={preview.board} accent={preview.accent} icon={<BoardGlyph templateId={id} />} />
                </li>
              );
            })}
            {extra > 0 ? (
              <li
                className="flex h-[124px] flex-col items-center justify-center gap-1 rounded-xl border border-dashed border-border-strong text-center"
                data-testid="onboarding-starter-more"
              >
                <span className="font-heading text-lg font-semibold text-fg">+{extra}</span>
                <span className="text-sm text-fg-secondary">{extra === 1 ? 'more board' : 'more boards'}</span>
              </li>
            ) : null}
          </ul>
        </div>
      </div>
    );
  }
  if (stepId === 'invite') {
    return (
      <InviteeList
        invitees={draft.invitees}
        onChange={(invitees) => update({ invitees })}
        roles={grantableRoles('owner')}
        defaultRole={defaultRole}
        onDefaultRoleChange={setDefaultRole}
        disabled={submitting}
        onSubmitShortcut={onSubmitShortcut}
      />
    );
  }
  if (stepId === 'done' && completion) {
    const { result, invited, inviteFailures } = completion;
    return (
      <div className="flex flex-col gap-4" data-testid="onboarding-done">
        <ul className="flex flex-col gap-2 rounded-lg border border-border-subtle p-4">
          <li className="flex items-center gap-2 text-base text-fg">
            <Check aria-hidden className="size-4 text-success" /> Organization <strong className="font-semibold">{result.organization.name}</strong>
          </li>
          <li className="flex items-center gap-2 text-base text-fg">
            <Check aria-hidden className="size-4 text-success" /> Workspace <strong className="font-semibold">{result.workspace.name}</strong> with{' '}
            {result.boards.length} connected boards
          </li>
          {invited ? (
            <li className="flex items-center gap-2 text-base text-fg">
              <Check aria-hidden className="size-4 text-success" /> {invited} {invited === 1 ? 'invitation' : 'invitations'} sent
            </li>
          ) : null}
        </ul>
        {inviteFailures ? (
          <InlineError>
            {inviteFailures === 1 ? 'One invitation' : `${inviteFailures} invitations`} couldn’t be sent. Use Invite in the top bar to try again.
          </InlineError>
        ) : null}
        <div className="flex flex-wrap gap-1.5">
          {result.boards.map((board) => (
            <span key={board.id} className="inline-flex h-7 items-center rounded-md bg-muted px-2.5 text-sm text-fg">
              {board.name}
            </span>
          ))}
        </div>
      </div>
    );
  }
  return null;
}
