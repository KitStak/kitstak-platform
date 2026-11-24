'use client';
/**
 * The launcher's guided-setup card: live progress ring and the quick start, the 3 to 5 steps the
 * welcome screen promised (docs/billing/SPEC.md 5.7). The next step is open with its one filled
 * button; the others are one line each, so the app tiles stay on the first screen. The deeper
 * steps of each app sit behind "Show all steps". Auto-detected ticks, deep links into the exact
 * screens, skip and undo, and a celebration when the first steps are done. Re-checks on window focus so steps completed in
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
  /** 'home' is the launcher card; 'settings' is the always-on copy in Organization settings. */
  readonly placement?: 'home' | 'settings';
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
  /** On a phone this row waits behind "Show all steps", so the app tiles stay on the first screen. */
  readonly foldOnPhone?: boolean;
}

function StepStatusIcon({ step, index, isNext, justDone }: Omit<StepRowProps, 'canManage' | 'pending' | 'onSkip' | 'onUnskip' | 'foldOnPhone'>) {
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

function StepRow({ step, index, isNext, justDone, canManage, pending, onSkip, onUnskip, foldOnPhone = false }: StepRowProps) {
  const settled = step.status !== 'todo';
  const locked = step.status === 'todo' && step.lockedBy !== null;
  const actionable = step.status === 'todo' && !locked;
  // The wizard writes org-level answers; members without a managing role can't take it.
  const canShowCta = step.key !== 'profile' || canManage;
  // The next step is open: its description shows and its button is the one filled button of the
  // card. Every other row is one quiet line, so the whole quick start fits above the app tiles.
  // On a phone a row with a link is two lines: the title on the first, the link under it. A title
  // such as "Create your CRM workspace" then has the whole width and never wraps beside its link.
  const stacked = isNext || (actionable && canShowCta);
  const ctaClass = cn(buttonVariants({ variant: isNext ? 'primary' : 'ghost', size: isNext ? 'md' : 'sm' }), 'shrink-0', !isNext && 'max-sm:-ml-2.5');
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
  const skip =
    actionable && canManage && step.key !== 'profile' ? (
      <Button
        variant="ghost"
        size="sm"
        disabled={pending}
        onClick={() => onSkip(step.key)}
        aria-label={`Skip: ${step.title}`}
        className={cn(
          // On the open step Skip is always there. On the quiet rows it shows on hover and on
          // keyboard focus, and not at all on touch screens, where the row has room for one button.
          !isNext && 'opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100 pointer-coarse:hidden',
        )}
      >
        Skip
      </Button>
    ) : null;

  return (
    <li
      data-testid={`setup-step-${step.key}`}
      data-status={step.status}
      className={cn(
        'group grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 px-5',
        isNext ? 'gap-y-2 bg-sunken/60 py-3.5' : 'min-h-11 py-1.5',
        stacked && 'max-sm:grid-cols-[auto_minmax(0,1fr)]',
        stacked && !isNext && 'max-sm:pt-2.5 max-sm:pb-1',
        foldOnPhone && 'max-sm:hidden',
      )}
      aria-current={isNext ? 'step' : undefined}
    >
      <StepStatusIcon step={step} index={index} isNext={isNext} justDone={justDone} />
      <div className="min-w-0">
        <p className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
          <span
            className={cn(
              'text-sm font-medium',
              settled || locked ? 'text-fg-muted' : 'text-fg',
              step.status === 'skipped' && 'line-through decoration-border-strong',
            )}
          >
            {step.title}
          </span>
          {step.status === 'todo' && !locked ? <span className="shrink-0 text-2xs text-fg-muted tabular-nums">{step.minutes} min</span> : null}
        </p>
        {/* Text wraps. It never ends in an ellipsis, so a promise is never cut mid sentence. */}
        {isNext ? <p className="mt-0.5 text-sm text-fg-secondary">{step.description}</p> : null}
        {locked ? (
          <p className="text-xs text-fg-muted">
            After <span className="font-medium text-fg-secondary">{step.lockedBy}</span>
          </p>
        ) : null}
      </div>
      <div className={cn('flex items-center justify-end gap-1.5', stacked && 'max-sm:col-start-2 max-sm:justify-start')}>
        {step.status === 'done' ? <span className="text-xs font-medium text-success-text">Done</span> : null}
        {step.status === 'skipped' && canManage ? (
          <Button
            variant="ghost"
            size="sm"
            disabled={pending}
            onClick={() => onUnskip(step.key)}
            leadingIcon={<RotateCcw aria-hidden />}
            aria-label={`Undo skip: ${step.title}`}
          >
            Undo skip
          </Button>
        ) : null}
        {isNext ? (
          <>
            {cta}
            {skip}
          </>
        ) : (
          <>
            {skip}
            {cta}
          </>
        )}
      </div>
    </li>
  );
}

/** The steps the quick start leaves out, folded away until asked for. */
function MoreSteps({
  steps,
  open,
  onToggle,
  rowProps,
  offset,
  foldedOnPhone = 0,
}: {
  readonly steps: readonly SetupStepView[];
  readonly open: boolean;
  readonly onToggle: () => void;
  readonly rowProps: Pick<StepRowProps, 'canManage' | 'pending' | 'onSkip' | 'onUnskip'>;
  /** How many steps come before these, so the numbers carry on. */
  readonly offset: number;
  /** Quick start rows a phone folds away too. The same press shows them, so the label counts them. */
  readonly foldedOnPhone?: number;
}) {
  if (steps.length === 0) return null;
  // The number is the count of rows the press reveals, so it is true on a phone and on a desktop.
  const closedLabel = (hidden: number) => `Show all steps (${hidden} more)`;
  return (
    <div className="border-t border-border-subtle">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-controls="setup-more-steps"
        data-testid="setup-more-toggle"
        className="flex min-h-11 w-full items-center justify-between gap-3 px-5 text-left text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus"
      >
        {open ? (
          <span>Show fewer steps</span>
        ) : foldedOnPhone > 0 ? (
          <>
            <span className="sm:hidden" data-testid="setup-more-label-phone">
              {closedLabel(steps.length + foldedOnPhone)}
            </span>
            <span className="max-sm:hidden">{closedLabel(steps.length)}</span>
          </>
        ) : (
          <span>{closedLabel(steps.length)}</span>
        )}
        <ChevronDown aria-hidden className={cn('size-4 shrink-0 transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none', open && 'rotate-180')} />
      </button>
      {open ? (
        <div id="setup-more-steps">
          <p className="border-t border-border-subtle bg-sunken/40 px-5 py-2 text-xs text-fg-muted">
            Do these when you are ready. They do not count toward your first steps, and each app shows them in its own guide too.
          </p>
          <ol start={offset + 1} className="divide-y divide-border-subtle border-t border-border-subtle" data-testid="setup-more-list">
            {steps.map((step, index) => (
              <StepRow key={step.key} step={step} index={offset + index} isNext={false} justDone={false} {...rowProps} />
            ))}
          </ol>
        </div>
      ) : null}
    </div>
  );
}

export function SetupGuide({ orgName, state, canManage, placement = 'home' }: SetupGuideProps) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [collapsed, setCollapsed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [justDoneKeys, setJustDoneKeys] = useState<readonly string[]>([]);
  const prevStatuses = useRef<ReadonlyMap<string, string> | null>(null);
  const lastRefresh = useRef(0);
  // The guide is the quick start: 3 to 5 steps, the ones the welcome screen promised. The rest of
  // the plan is folded behind "Show all steps" and does not move the count or the minutes.
  const { steps, summary } = state.quick;
  const moreSteps = state.more;
  const [moreOpen, setMoreOpen] = useState(false);

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

  const run = (action: () => Promise<{ ok: boolean; error?: string }>) => {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (!result.ok) setError(result.error ?? 'That did not save. Try again.');
      } catch {
        setError('We could not reach KitStak. Try again.');
      }
      router.refresh();
    });
  };

  const inSettings = placement === 'settings';
  // In settings the guide always shows; the button only decides whether it is also on the home page.
  const homeToggle = canManage ? (
    inSettings ? (
      state.dismissed ? (
        <Button variant="secondary" size="sm" loading={pending} onClick={() => run(restoreSetupGuide)}>
          Show on home
        </Button>
      ) : (
        <Button variant="ghost" size="sm" loading={pending} onClick={() => run(dismissSetupGuide)}>
          Hide from home
        </Button>
      )
    ) : (
      <Button variant="secondary" size="sm" loading={pending} onClick={() => run(dismissSetupGuide)}>
        Dismiss guide
      </Button>
    )
  ) : null;
  const errorLine = error ? (
    <p role="alert" className="mt-3 text-sm text-danger-text">
      {error}
    </p>
  ) : null;

  // Phones, on the launcher: every quick start row but the open one waits behind "Show all steps".
  const foldsOnPhone = !inSettings && summary.nextKey !== null;

  const rowProps = {
    canManage,
    pending,
    onSkip: (key: string) => run(() => skipSetupStep(key)),
    onUnskip: (key: string) => run(() => unskipSetupStep(key)),
  };

  // Celebration only when the quick start is genuinely DONE. Skips never earn confetti.
  if (summary.allDone) {
    return (
      <section
        aria-label="Setup complete"
        className="relative overflow-hidden rounded-2xl border border-border-default bg-panel shadow-xs animate-fade-in"
      >
        {inSettings ? null : <ConfettiBurst />}
        <div className="relative flex flex-wrap items-center gap-4 p-6">
          <span className="flex size-11 items-center justify-center rounded-full bg-success-subtle text-success-text">
            <PartyPopper aria-hidden className="size-5" />
          </span>
          <div className="min-w-0 flex-1">
            <h2 className="text-md font-semibold text-fg">
              {orgName} is ready for business
            </h2>
            <p className="mt-0.5 text-sm text-fg-secondary">
              {moreSteps.some((step) => step.status === 'todo') ? 'Your first steps are done.' : 'Every setup step is done.'}
            </p>
          </div>
          {homeToggle}
        </div>
        {error ? <div className="px-6 pb-4">{errorLine}</div> : null}
        <MoreSteps steps={moreSteps} open={moreOpen} onToggle={() => setMoreOpen((current) => !current)} rowProps={rowProps} offset={steps.length} />
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
              {homeToggle}
            </div>
          ) : null}
        </div>
        {errorLine}
      </section>
    );
  }

  return (
    <section
      aria-label="Setup guide"
      className="overflow-hidden rounded-2xl border border-border-default bg-panel shadow-xs animate-fade-in"
    >
      {state.dismissed && !inSettings ? (
        <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-sunken px-5 py-2.5">
          <p className="text-xs text-fg-muted">
            This guide is hidden from your home page. It stays in Organization settings.
          </p>
          {canManage ? (
            <Button variant="secondary" size="sm" loading={pending} onClick={() => run(restoreSetupGuide)}>
              Show it again
            </Button>
          ) : null}
        </div>
      ) : null}
      {/*
        Phones: the ring, the title and the two small buttons share the first line. The progress
        line gets the full width under the title, so "Set up Harbor Supply Co" and "2 of 5 done ·
        about 7 min left" never wrap into three or four short lines. In settings, "Hide from home"
        sits on its own line under them. From 640 px up it is one row.
      */}
      <header className="grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-4 gap-y-0.5 px-5 py-4 sm:flex sm:gap-4">
        <div className="max-sm:row-span-2 max-sm:self-start">
          <ProgressRing percent={summary.percent} />
        </div>
        <div className="min-w-0 flex-1 max-sm:contents">
          {/* The name wraps on a phone. It is never cut with an ellipsis. */}
          <h2 className="min-w-0 text-md font-semibold text-balance break-words text-fg">Set up {orgName}</h2>
          <p className="mt-0.5 text-sm text-fg-muted max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-2" data-testid="setup-progress">
            {summary.doneCount} of {summary.totalCount} done
            {summary.skippedCount > 0 ? <> · {summary.skippedCount} skipped</> : null}
            {summary.remainingMinutes > 0 ? (
              <> · about {summary.remainingMinutes} min left</>
            ) : null}
          </p>
        </div>
        {inSettings && homeToggle ? (
          <div className="max-sm:col-span-2 max-sm:col-start-2 max-sm:row-start-3 max-sm:-ml-2.5 max-sm:justify-self-start">{homeToggle}</div>
        ) : null}
        <div className="flex shrink-0 items-center gap-1 max-sm:col-start-3 max-sm:row-start-1">
          {!inSettings && canManage ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Setup guide options"
                className="flex size-8 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
              >
                <MoreHorizontal aria-hidden className="size-4" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end">
                <DropdownMenuItem onSelect={() => run(dismissSetupGuide)}>
                  <span className="flex flex-col">
                    <span>Dismiss setup guide</span>
                    <span className="text-xs text-fg-muted">It moves to Organization settings and keeps checking off steps.</span>
                  </span>
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
        </div>
      </header>
      {error ? <div className="px-5 pb-3">{errorLine}</div> : null}
      {collapsed ? null : (
        <>
          <ol className="divide-y divide-border-subtle border-t border-border-subtle" data-testid="setup-steps">
            {steps.map((step, index) => (
              <StepRow
                key={step.key}
                step={step}
                index={index}
                isNext={step.key === summary.nextKey}
                justDone={justDoneKeys.includes(step.key)}
                // Phones, on the launcher: only the open step shows until "Show all steps" is pressed,
                // so the person's own app tile is on the first screen under the guide.
                foldOnPhone={foldsOnPhone && !moreOpen && step.key !== summary.nextKey}
                {...rowProps}
              />
            ))}
          </ol>
          {moreSteps.length === 0 && !inSettings && steps.length > 1 ? (
            // With no extra steps there is no "Show all steps" row, so phones get their own.
            <button
              type="button"
              onClick={() => setMoreOpen((current) => !current)}
              aria-expanded={moreOpen}
              data-testid="setup-phone-toggle"
              className="flex min-h-11 w-full items-center justify-between gap-3 border-t border-border-subtle px-5 text-left text-sm font-medium text-fg-secondary hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-focus sm:hidden"
            >
              <span>{moreOpen ? 'Show fewer steps' : `Show all ${steps.length} steps`}</span>
              <ChevronDown aria-hidden className={cn('size-4 shrink-0 transition-transform duration-[var(--duration-fast)] motion-reduce:transition-none', moreOpen && 'rotate-180')} />
            </button>
          ) : null}
          <MoreSteps
            steps={moreSteps}
            open={moreOpen}
            onToggle={() => setMoreOpen((current) => !current)}
            rowProps={rowProps}
            offset={steps.length}
            foldedOnPhone={foldsOnPhone ? steps.length - 1 : 0}
          />
        </>
      )}
    </section>
  );
}
