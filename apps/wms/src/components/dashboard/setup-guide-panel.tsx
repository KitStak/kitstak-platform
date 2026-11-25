'use client';

/**
 * "Get set up" panel — first-run guided setup at the top of the dashboard.
 *
 * Server-rendered state arrives via `initial` (no pop-in on first paint); the panel
 * then owns refetching. Completion is DETECTED from live data (setup-guide-model),
 * so finishing a step elsewhere checks it off here. Steps the viewer cannot open
 * render a disabled CTA with the reason, never hidden. Skip / dismiss are org-level
 * decisions behind the company-settings key; viewers get a read-only guide with no
 * skip/dismiss affordances (contract: docs/integration/ONBOARDING.md).
 */
import * as React from 'react';
import Link from 'next/link';
import { Check, EllipsisVertical, Lock, PartyPopper, Undo2 } from 'lucide-react';
import { Pill } from '@kitstak/ui/dashboard';
import { Button, buttonVariants } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { ProgressRing } from '@/components/ui/progress-ring';
import { DisabledReason } from '@/components/ui/tooltip';
import { useApiMutation, useApiQuery } from '@/lib/query-client';
import { hasPermission, useMe } from '@/lib/permissions-client';
import { cn } from '@/lib/utils';
import {
  setupStepHref,
  setupSummaryLabel,
  type SetupGuide,
  type SetupStepLink,
  type SetupStepState,
} from '@/lib/setup-guide-model';
import { ConfettiBurst } from './confetti-burst';

const GUIDE_KEY = ['setup-guide'] as const;
const MANAGE_PERMISSION = 'settings.company_settings.update';
const CTA_REASON = 'You do not have permission for this page. Ask an admin to grant it or do this step.';

type GuideAction = { readonly action: 'skip' | 'unskip' | 'dismiss' | 'restore'; readonly stepKey?: string };

/** null = /api/me not loaded yet (render CTAs enabled; server re-checks anyway). */
function usePermissionSet(): ReadonlySet<string> | null {
  const me = useMe();
  const permissions = me.data?.data.permissions;
  return React.useMemo(() => (permissions ? new Set(permissions) : null), [permissions]);
}

function allowed(perms: ReadonlySet<string> | null, keys: readonly string[]): boolean {
  return perms === null || hasPermission(perms, keys, 'any');
}

function StepMarker({
  step,
  index,
  current,
}: {
  readonly step: SetupStepState;
  readonly index: number;
  readonly current: boolean;
}) {
  const base = 'flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold';
  if (step.status === 'done')
    return (
      <span className={cn(base, 'bg-success-subtle text-success-text')} data-testid="step-done">
        <Check className="h-4 w-4" aria-hidden />
        <span className="sr-only">Done</span>
      </span>
    );
  if (step.status === 'locked')
    return (
      <span className={cn(base, 'bg-muted text-fg-muted')}>
        <Lock className="h-3.5 w-3.5" aria-hidden />
        <span className="sr-only">Locked</span>
      </span>
    );
  return (
    <span
      className={cn(
        base,
        'tabular-nums',
        step.status === 'skipped'
          ? 'border border-dashed border-border-strong bg-transparent text-fg-muted'
          : // The current step is marked by a solid neutral number and the words "Next step", not by color.
            current
            ? 'bg-fg text-fg-inverse'
            : 'border border-border-strong text-fg-muted',
      )}
      aria-hidden
    >
      {index + 1}
    </span>
  );
}

function CtaLink({
  link,
  stepKey,
  enabled,
  current,
}: {
  readonly link: SetupStepLink;
  readonly stepKey: SetupStepState['key'];
  readonly enabled: boolean;
  readonly current: boolean;
}) {
  // The page keeps no crimson button here: the current step gets the outline button, the rest a quiet one.
  const variant = current ? 'secondary' : 'ghost';
  if (!enabled)
    return (
      <DisabledReason reason={CTA_REASON}>
        <Button size="sm" variant={variant} disabled>
          {link.label}
        </Button>
      </DisabledReason>
    );
  return (
    <Link
      href={setupStepHref(link.href, stepKey)}
      className={buttonVariants({ variant, size: 'sm' })}
    >
      {link.label}
    </Link>
  );
}

interface StepRowProps {
  readonly step: SetupStepState;
  readonly index: number;
  /** The first ready step: the one the guide points at next. */
  readonly current: boolean;
  readonly perms: ReadonlySet<string> | null;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onAction: (vars: GuideAction) => void;
}

function StepRow({ step, index, current, perms, canManage, busy, onAction }: StepRowProps) {
  return (
    <li
      className="group flex items-center gap-3 px-5 py-3"
      data-testid={`setup-step-${step.key}`}
      data-status={step.status}
      data-current={current || undefined}
    >
      <StepMarker step={step} index={index} current={current} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'text-sm font-medium',
            // Vocabulary (contract): done = muted, NO strikethrough; strikethrough means skipped.
            step.status === 'ready' ? 'text-foreground' : 'text-fg-muted',
            step.status === 'skipped' && 'line-through decoration-border-strong',
          )}
        >
          {step.title}
        </p>
        {step.status === 'locked' ? (
          <p className="mt-0.5 text-xs text-fg-muted">Unlocks after {step.lockedBy}</p>
        ) : step.status === 'skipped' ? (
          <p className="mt-0.5 text-xs text-fg-muted">Skipped. Live data still checks this off.</p>
        ) : step.status === 'ready' ? (
          <p className="mt-0.5 text-xs text-secondary">
            {current ? (
              <>
                <span className="font-medium text-fg">Next step</span>
                <span aria-hidden> · </span>
              </>
            ) : null}
            {step.description}
          </p>
        ) : null}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {step.status === 'done' ? (
          <Pill tone="positive">Done, detected</Pill>
        ) : step.status === 'ready' ? (
          <>
            {canManage ? (
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                onClick={() => onAction({ action: 'skip', stepKey: step.key })}
                className={cn(
                  // Hover/focus-revealed on fine pointers; always visible (reduced emphasis)
                  // on coarse pointers.
                  'text-fg-muted transition-opacity',
                  'pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100',
                  'pointer-coarse:opacity-70',
                  'focus-visible:opacity-100',
                )}
              >
                Skip
              </Button>
            ) : null}
            {step.secondary && allowed(perms, step.secondary.permission) ? (
              <Link
                href={setupStepHref(step.secondary.href, step.key)}
                className="hidden text-xs font-medium text-fg-secondary hover:text-fg hover:underline sm:inline"
              >
                {step.secondary.label}
              </Link>
            ) : null}
            <CtaLink
              link={step.cta}
              stepKey={step.key}
              enabled={allowed(perms, step.cta.permission)}
              current={current}
            />
          </>
        ) : step.status === 'skipped' && canManage ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => onAction({ action: 'unskip', stepKey: step.key })}
          >
            <Undo2 className="h-3.5 w-3.5" aria-hidden />
            Undo skip
          </Button>
        ) : null}
      </div>
    </li>
  );
}

/** All five steps DETECTED done — the only state that celebrates (skips never do). */
function Celebration({
  canManage,
  busy,
  onDismiss,
}: {
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      className="relative flex flex-col items-center gap-3 overflow-hidden px-6 py-8 text-center"
      data-testid="setup-celebration"
    >
      <ConfettiBurst />
      <span className="flex h-12 w-12 items-center justify-center rounded-full bg-success-subtle text-success-text">
        <PartyPopper className="h-6 w-6" aria-hidden />
      </span>
      <div>
        <p className="text-base font-semibold text-foreground">Your warehouse is ready</p>
      </div>
      {canManage ? (
        <Button variant="secondary" size="sm" disabled={busy} onClick={onDismiss}>
          Dismiss
        </Button>
      ) : null}
    </div>
  );
}

/**
 * Everything settled but some steps only skipped: a quiet wrap-up with undo
 * affordances instead of an endless frozen checklist — and never confetti.
 */
function WrappedUp({
  guide,
  canManage,
  busy,
  onAction,
}: {
  readonly guide: SetupGuide;
  readonly canManage: boolean;
  readonly busy: boolean;
  readonly onAction: (vars: GuideAction) => void;
}) {
  const skipped = guide.steps.filter((step) => step.status === 'skipped');
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-4" data-testid="setup-wrapped-up">
      <p className="text-sm text-secondary">
        Wrapped up: {skipped.length} {skipped.length === 1 ? 'step' : 'steps'} skipped.
      </p>
      {canManage
        ? skipped.map((step) => (
            <Button
              key={step.key}
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => onAction({ action: 'unskip', stepKey: step.key })}
            >
              <Undo2 className="h-3.5 w-3.5" aria-hidden />
              Undo skip · {step.title}
            </Button>
          ))
        : null}
    </div>
  );
}

export function SetupGuidePanel({ initial = null }: { readonly initial?: SetupGuide | null }) {
  const perms = usePermissionSet();
  const q = useApiQuery<SetupGuide | null>(GUIDE_KEY, '/api/setup-guide', {
    staleTime: 30_000,
    ...(initial ? { initialData: { data: initial }, initialDataUpdatedAt: Date.now() } : {}),
  });
  const mutation = useApiMutation<GuideAction, SetupGuide>({
    path: '/api/setup-guide',
    invalidate: [GUIDE_KEY],
    successMessage: false,
    errorTitle: 'Setup guide',
  });
  const guide = q.data?.data;
  // No placeholder while loading: the server-rendered path always has `initial`, and the
  // guide must never reserve space once dismissed, hidden by the rollout guard, or on error.
  if (!guide || !guide.visible) return null;

  const canManage = allowed(perms, [MANAGE_PERMISSION]);
  const busy = mutation.isPending;
  const onAction = (vars: GuideAction) => mutation.mutate(vars);
  const currentKey = guide.steps.find((step) => step.status === 'ready')?.key ?? null;

  return (
    <section
      aria-label="Get set up"
      data-testid="setup-guide"
      className="rounded-xl border border-border bg-surface shadow-xs"
    >
      {guide.allDone ? (
        <Celebration canManage={canManage} busy={busy} onDismiss={() => onAction({ action: 'dismiss' })} />
      ) : (
        <>
          <header className="flex items-center gap-4 px-5 pb-2 pt-4">
            <ProgressRing
              value={guide.settledCount}
              max={guide.totalCount}
              size={44}
              thickness={5}
              // One progress treatment (contract): the dashboard data color until 100%, success only at 100%.
              tone={guide.settledCount === guide.totalCount ? 'success' : 'data'}
              label="Setup progress"
            />
            <div className="min-w-0 flex-1">
              <h2 className="text-base font-semibold text-foreground">Get set up</h2>
              <p className="mt-0.5 text-xs text-secondary tabular-nums" data-testid="setup-summary">
                {setupSummaryLabel(guide)}
              </p>
            </div>
            {canManage ? (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button size="icon-sm" variant="ghost" aria-label="Setup guide options">
                    <EllipsisVertical className="h-4 w-4" aria-hidden />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent>
                  <DropdownMenuItem
                    disabled={busy}
                    description="Hide this guide for everyone. Finished steps stay done."
                    onSelect={() => onAction({ action: 'dismiss' })}
                  >
                    Dismiss guide
                  </DropdownMenuItem>
                </DropdownMenuContent>
              </DropdownMenu>
            ) : null}
          </header>
          {guide.allSettled ? (
            <WrappedUp guide={guide} canManage={canManage} busy={busy} onAction={onAction} />
          ) : (
            <ol className="divide-y divide-border-subtle" aria-label="Setup steps in order">
              {guide.steps.map((step, index) => (
                <StepRow
                  key={step.key}
                  step={step}
                  index={index}
                  current={step.key === currentKey}
                  perms={perms}
                  canManage={canManage}
                  busy={busy}
                  onAction={onAction}
                />
              ))}
            </ol>
          )}
        </>
      )}
    </section>
  );
}
