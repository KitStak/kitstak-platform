'use client';
/**
 * Getting-started checklist on Home for new people. Every step is checked off from real data
 * (projects, tasks, due dates, a finished task, ⌘K use, teammates). Hide it with ×; the Help menu's
 * "Getting started" (/?tour=1) brings it back.
 */
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Check, X } from 'lucide-react';
import { withThemeParam } from '@kitstak/ui/theme-handoff';
import { Button, IconButton, cn, toast } from '@/components/ui';
import { addDaysIso, todayIso } from '@/lib/dates';
import { usePeople } from '@/lib/hooks/use-data';
import { routes } from '@/lib/routes';
import type { TaskSummary } from '@/lib/types';
import { updatePrefsAction } from '@/server/actions/prefs';
import { useUsedSearch } from '@/features/command/usage-flags';
import { useShell } from '@/features/shell/shell-context';
import { useShellStore } from '@/features/shell/store';
import { gettingStartedSteps, type GettingStartedStepId } from './home-model';

function ProgressRing({ done, total }: { readonly done: number; readonly total: number }) {
  const r = 18;
  const c = 2 * Math.PI * r;
  const pct = total ? done / total : 0;
  return (
    <svg width="48" height="48" viewBox="0 0 48 48" aria-hidden className="shrink-0 -rotate-90">
      <circle cx="24" cy="24" r={r} fill="none" strokeWidth="5" className="stroke-[var(--color-sunken)]" />
      <circle
        cx="24"
        cy="24"
        r={r}
        fill="none"
        strokeWidth="5"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - pct)}
        className="stroke-[var(--color-success)] transition-[stroke-dashoffset] duration-500 ease-out motion-reduce:transition-none"
      />
    </svg>
  );
}

export function GettingStartedCard({
  projectCount,
  createdTaskCount,
  tasks,
  dismissed,
  force,
}: {
  readonly projectCount: number;
  readonly createdTaskCount: number;
  readonly tasks: readonly TaskSummary[];
  readonly dismissed: boolean;
  readonly force: boolean;
}) {
  const router = useRouter();
  const { user, can, appUrls } = useShell();
  const openQuickAdd = useShellStore((state) => state.openQuickAdd);
  const openPalette = useShellStore((state) => state.openPalette);
  const people = usePeople();
  const usedSearch = useUsedSearch();
  const [hidden, setHidden] = useState(dismissed && !force);

  const steps = gettingStartedSteps({
    projectCount,
    createdTaskCount,
    tasks,
    usedSearch,
    peopleCount: people.data?.length ?? 1,
  });
  const doneCount = steps.filter((step) => step.done).length;
  if (hidden || (doneCount === steps.length && !force)) return null;

  const hide = async () => {
    setHidden(true);
    const result = await updatePrefsAction({ home: { gettingStartedDismissed: true } });
    if (!result.ok) {
      setHidden(false);
      toast.error("Couldn't hide the checklist", result.error.message);
      return;
    }
    toast.success('Checklist hidden', 'Bring it back any time from Help → Getting started.');
  };

  const actions: Record<GettingStartedStepId, { label: string; run: () => void } | null> = {
    project: can('project:create') ? { label: 'Start a project', run: () => router.push(routes.newProject()) } : null,
    task: { label: 'Add a task', run: () => openQuickAdd({ assigneeId: user.id, text: 'Order shipping labels tomorrow !high' }) },
    due: { label: 'Add a dated task', run: () => openQuickAdd({ assigneeId: user.id, dueDate: addDaysIso(todayIso(), 1) }) },
    done: { label: 'Open My work', run: () => router.push(routes.myWork()) },
    search: { label: 'Try search', run: () => openPalette() },
    team: { label: 'Invite people', run: () => window.open(withThemeParam(`${appUrls.portal}/settings/organization`), '_blank', 'noopener') },
  };

  return (
    <section className="rounded-xl border border-border-subtle bg-panel shadow-xs" aria-labelledby="getting-started-title" data-testid="getting-started">
      <header className="flex items-center gap-4 px-5 pt-4 pb-3">
        <span className="relative flex items-center justify-center">
          <ProgressRing done={doneCount} total={steps.length} />
          <span className="absolute text-xs font-semibold text-fg tabular-nums">
            {doneCount}/{steps.length}
          </span>
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="getting-started-title" className="text-base font-semibold text-fg">
            {doneCount === steps.length ? 'You’re all set!' : 'Get started with KitStak Projects'}
          </h2>
          <p className="text-sm text-fg-muted">
            {doneCount === steps.length ? 'You’ve tried everything that matters. Hide this whenever you like.' : 'Six quick steps to feel at home. Each one takes under a minute.'}
          </p>
        </div>
        <IconButton label="Hide checklist" icon={<X aria-hidden />} onClick={() => void hide()} data-testid="getting-started-hide" />
      </header>
      <ol className="grid gap-2 px-3 pb-3 sm:grid-cols-2 xl:grid-cols-3">
        {steps.map((step) => {
          const action = actions[step.id];
          return (
            <li
              key={step.id}
              data-done={step.done || undefined}
              className={cn('flex items-start gap-3 rounded-lg border px-3 py-3', step.done ? 'border-transparent bg-sunken/60 max-sm:hidden' : 'border-border-subtle bg-panel')}
            >
              <span
                aria-hidden
                className={cn(
                  'mt-0.5 flex size-5 shrink-0 items-center justify-center rounded-full border',
                  step.done ? 'border-success bg-success text-primary-fg' : 'border-border-strong text-transparent',
                )}
              >
                <Check className="size-3" strokeWidth={3} />
              </span>
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className={cn('text-sm font-medium', step.done ? 'text-fg-muted line-through decoration-1' : 'text-fg')}>
                  {step.title}
                  <span className="sr-only">{step.done ? ' (done)' : ' (to do)'}</span>
                </span>
                <span className="text-xs text-fg-muted">{step.description}</span>
                {!step.done && action ? (
                  <Button variant="ghost" size="sm" className="mt-1 -ml-2 w-fit text-fg-link" trailingIcon={<ArrowRight aria-hidden />} onClick={action.run}>
                    {action.label}
                  </Button>
                ) : null}
              </span>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
