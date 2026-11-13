'use client';
/**
 * The launcher's guided-setup card: live progress ring, auto-detected checklist with
 * operational ordering, deep links into the exact screens, skip/undo, and a celebration
 * when the org is ready for business. Re-checks on window focus so steps completed in
 * CRM/WMS check themselves off when the user comes back.
 */
import { useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowUpRight,
  Check,
  ChevronDown,
  Lock,
  MoreHorizontal,
  PartyPopper,
  RotateCcw,
} from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  buttonVariants,
  cn,
} from '@/components/ui';
import type { SetupState, SetupStepView } from '@/server/onboarding';
import {
  dismissSetupGuide,
  restoreSetupGuide,
  skipSetupStep,
  unskipSetupStep,
} from '@/server/onboarding-actions';
import { ConfettiBurst } from './confetti';
import { ProgressRing } from './progress-ring';

const COLLAPSE_KEY = 'kitstak.portal.setupGuide.collapsed';
const FOCUS_REFRESH_MS = 5_000;

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSE_KEY) === '1';
  } catch {
    return false;
  }
}

function writeCollapsed(collapsed: boolean): void {
  try {
    localStorage.setItem(COLLAPSE_KEY, collapsed ? '1' : '0');
  } catch {
    // Per-viewer convenience only; losing it is fine.
  }
}

export interface SetupGuideProps {
  readonly orgName: string;
  readonly state: SetupState;
  readonly canManage: boolean;
}

interface StepRowProps {
  readonly step: SetupStepView;
  readonly index: number;
  readonly isNext: boolean;
  readonly justDone: boolean;
  readonly canManage: boolean;
  readonly pending: boolean;
  readonly onSkip: (key: string) => void;
  readonly onUnskip: (key: string) => void;
}

function StepStatusIcon({ step, index, isNext, justDone }: Omit<StepRowProps, 'canManage' | 'pending' | 'onSkip' | 'onUnskip'>) {
  if (step.status === 'done') {
    return (
      <span
        className={cn(
          'flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-fg-inverse',
          justDone && 'animate-check-pop motion-reduce:animate-none',
        )}
      >
        <Check aria-hidden className="size-3.5" strokeWidth={3} />
      </span>
    );
  }
  if (step.status === 'skipped') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-fg-muted">
        <Check aria-hidden className="size-3 opacity-40" />
      </span>
    );
  }
  if (step.lockedBy) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-default bg-sunken text-fg-muted">
        <Lock aria-hidden className="size-3" />
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        isNext ? 'border-primary text-primary-text' : 'border-border-strong text-fg-muted',
      )}
    >
      {index + 1}
    </span>
  );
}

function StepRow({ step, index, isNext, justDone, canManage, pending, onSkip, onUnskip }: StepRowProps) {
  const settled = step.status !== 'todo';
  const locked = step.status === 'todo' && step.lockedBy !== null;
  const actionable = step.status === 'todo' && !locked;
  // The wizard writes org-level answers; members without a managing role can't take it.
  const canShowCta = step.key !== 'profile' || canManage;
  const ctaClass = cn(
    buttonVariants({ variant: isNext ? 'primary' : 'secondary', size: 'sm' }),
    'shrink-0',
  );
  const cta = actionable && canShowCta ? (
    step.external ? (
      <a href={step.href} target="_blank" rel="noopener" className={ctaClass}>
        {step.cta}
        <ArrowUpRight aria-hidden className="size-3.5" />
      </a>
    ) : (
      <Link href={step.href} className={ctaClass}>
        {step.cta}
      </Link>
    )
  ) : null;

  return (
    <li
      className={cn(
        'group grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 px-5 py-3 sm:grid-cols-[auto_1fr_auto]',
        isNext && 'bg-sunken/60',
      )}
      aria-current={isNext ? 'step' : undefined}
    >
      <StepStatusIcon step={step} index={index} isNext={isNext} justDone={justDone} />
      <div className="min-w-0">
        <div className="flex flex-wrap items-baseline gap-x-2">
          <p
            className={cn(
              'text-sm font-medium sm:truncate',
              settled ? 'text-fg-muted' : 'text-fg',
              step.status === 'skipped' && 'line-through decoration-border-strong',
            )}
          >
            {step.title}
          </p>
          {step.status === 'todo' ? (
            <span className="shrink-0 text-2xs text-fg-muted tabular-nums">~{step.minutes} min</span>
          ) : null}
        </div>
        {step.status === 'todo' ? (
          <p className="mt-0.5 truncate text-xs text-fg-muted">
            {locked ? (
              <>
                Unlocks after <span className="font-medium text-fg-secondary">{step.lockedBy}</span>
              </>
            ) : (
              step.description
            )}
          </p>
        ) : null}
      </div>
      <div className="col-start-2 flex items-center gap-1.5 sm:col-start-auto">
        {step.status === 'done' ? (
          <span className="text-xs font-medium text-success-text">
            Done{step.auto ? ' · detected' : ''}
          </span>
        ) : null}
        {step.status === 'skipped' && canManage ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => onUnskip(step.key)}
            leadingIcon={<RotateCcw aria-hidden />}
          >
            Undo skip
          </Button>
        ) : null}
        {actionable && canManage && !isNext ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => onSkip(step.key)}
            className="opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:opacity-60"
          >
            Skip
          </Button>
        ) : null}
        {cta}
      </div>
    </li>
  );
}

export function SetupGuide({ orgName, state, canManage }: SetupGuideProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
  const [justDoneKeys, setJustDoneKeys] = useState<readonly string[]>([]);
  const prevStatuses = useRef<ReadonlyMap<string, string> | null>(null);
  const lastRefresh = useRef(0);
  const { steps, summary } = state;

  // Read the saved preference after mount (localStorage is client only) so SSR markup matches.
  useEffect(() => {
    const frame = requestAnimationFrame(() => setCollapsed(readCollapsed()));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Steps completed in CRM/WMS check themselves off when the user tabs back.
  useEffect(() => {
    if (summary.allDone) return;
    const refresh = () => {
      const now = Date.now();
      if (now - lastRefresh.current < FOCUS_REFRESH_MS) return;
      lastRefresh.current = now;
      router.refresh();
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [router, summary.allDone]);

  // Pop the checkmark on steps that flipped to done since the previous render of data.
  useEffect(() => {
    const current = new Map(steps.map((step) => [step.key, step.status]));
    const previous = prevStatuses.current;
    prevStatuses.current = current;
    if (!previous) return;
    const flipped = steps
      .filter((step) => step.status === 'done' && previous.get(step.key) === 'todo')
      .map((step) => step.key);
    if (flipped.length > 0) {
      setJustDoneKeys(flipped);
      const timer = setTimeout(() => setJustDoneKeys([]), 900);
      return () => clearTimeout(timer);
    }
  }, [steps]);

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      writeCollapsed(!current);
      return !current;
    });
  };

  const run = (action: () => Promise<{ ok: boolean }>) => {
    startTransition(async () => {
      await action();
      router.refresh();
    });
  };

  // Celebration only when everything is genuinely DONE — skips never earn confetti.
  if (summary.allDone) {
    return (
      <section
        aria-label="Setup complete"
        className="relative overflow-hidden rounded-2xl border border-border-default bg-panel p-6 shadow-xs animate-fade-in"
      >
        <ConfettiBurst />
        <div className="relative flex flex-wrap items-center gap-4">
          <span className="flex size-11 items-center justify-center rounded-full bg-success-subtle text-success-text">
            <PartyPopper aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-md font-semibold text-fg">
              {orgName} is ready for business
            </h2>
            <p className="mt-0.5 text-sm text-fg-secondary">
              Every setup step is done. Nice work, your team can get straight to it.
            </p>
          </div>
          {canManage ? (
            <Button variant="secondary" loading={pending} onClick={() => run(dismissSetupGuide)}>
              Dismiss guide
            </Button>
          ) : null}
        </div>
      </section>
    );
  }

  // Everything settled but some steps skipped: a quiet wrap-up, honest about the skips.
  if (summary.allSettled) {
    const skipped = steps.filter((step) => step.status === 'skipped');
    return (
      <section
        aria-label="Setup wrapped up"
        className="rounded-2xl border border-border-default bg-panel p-5 shadow-xs animate-fade-in"
      >
        <div className="flex flex-wrap items-center gap-4">
          <ProgressRing percent={summary.percent} />
          <div className="min-w-0 flex-1">
            <h2 className="text-md font-semibold text-fg">Setup wrapped up</h2>
            <p className="mt-0.5 text-sm text-fg-secondary">
              {summary.doneCount} of {summary.totalCount} done ·{' '}
              {skipped.map((step) => step.title).join(', ')}{' '}
              {skipped.length === 1 ? 'was' : 'were'} skipped.
            </p>
          </div>
          {canManage ? (
            <div className="flex items-center gap-2">
              {skipped.map((step) => (
                <Button
                  key={step.key}
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => run(() => unskipSetupStep(step.key))}
                  leadingIcon={<RotateCcw aria-hidden />}
                >
                  Undo skip
                </Button>
              ))}
              <Button variant="secondary" size="sm" loading={pending} onClick={() => run(dismissSetupGuide)}>
                Dismiss guide
              </Button>
            </div>
          ) : null}
        </div>
      </section>
    );
  }

  return (
    <section
      aria-label="Setup guide"
      className="overflow-hidden rounded-2xl border border-border-default bg-panel shadow-xs animate-fade-in"
    >
      {state.dismissed ? (
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-sunken px-5 py-2.5">
          <p className="text-xs text-fg-muted">
            This guide is hidden from your launcher.
          </p>
          {canManage ? (
            <Button variant="secondary" size="sm" loading={pending} onClick={() => run(restoreSetupGuide)}>
              Show it again
            </Button>
          ) : null}
        </div>
      ) : null}
      <header className="flex items-center gap-4 px-5 py-4">
        <ProgressRing percent={summary.percent} />
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-md font-semibold text-fg">Set up {orgName}</h2>
          <p className="mt-0.5 text-sm text-fg-muted">
            {summary.doneCount} of {summary.totalCount} complete
            {summary.skippedCount > 0 ? <> · {summary.skippedCount} skipped</> : null}
            {summary.remainingMinutes > 0 ? (
              <> · about {summary.remainingMinutes} min left</>
            ) : null}
          </p>
        </div>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger
              aria-label="Setup guide options"
              className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
            >
              <MoreHorizontal aria-hidden className="size-4" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onSelect={() => run(dismissSetupGuide)}>
                Dismiss setup guide
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
        <button
          type="button"
          onClick={toggleCollapsed}
          aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand setup guide' : 'Collapse setup guide'}
          className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          <ChevronDown
            aria-hidden
            className={cn(
              'size-4 transition-transform duration-[var(--duration-fast)]',
              collapsed && '-rotate-90',
            )}
          />
        </button>
      </header>
      {collapsed ? null : (
        <ol className="divide-y divide-border-subtle border-t border-border-subtle">
          {steps.map((step, index) => (
            <StepRow
              key={step.key}
              step={step}
              index={index}
              isNext={step.key === summary.nextKey}
              justDone={justDoneKeys.includes(step.key)}
              canManage={canManage}
              pending={pending}
              onSkip={(key) => run(() => skipSetupStep(key))}
              onUnskip={(key) => run(() => unskipSetupStep(key))}
            />
          ))}
        </ol>
      )}
    </section>
  );
}
