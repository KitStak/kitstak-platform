'use client';
/**
 * "Getting started" checklist on org Home, following the cross-app onboarding contract
 * (docs/integration/ONBOARDING.md). Step completion is derived server-side from real
 * data (boards, deals, members, dashboards) — the card never asks anyone to tick boxes.
 * Progress is a circular ring (settled / total); the celebration fires ONLY when every
 * step is genuinely done, while all-settled-with-skips gets a quiet "wrapped up" row.
 * Owners/admins can skip steps or dismiss the guide; viewers get a read-only card.
 */
import { useRouter } from 'next/navigation';
import { Check, EllipsisVertical, Lock, PartyPopper, RotateCcw, X } from 'lucide-react';
import {
  Button,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  IconButton,
  Skeleton,
  Tooltip,
  cn,
} from '@/components/ui';
import { useCan, useOrg } from '@/features/shell/org-context';
import { routes } from '@/features/shell/routes';
import { startRouteProgress } from '@/features/shell/route-progress';
import { useShellStore } from '@/features/shell/store';
import { useOpenWizard } from '@/features/wizards/use-open-wizard';
import type { SetupGuideStepDto, SetupStepKey } from '@/server/services/setup-guide-model';
import { ConfettiBurst } from './confetti-burst';
import { ProgressRing } from './progress-ring';
import { useSetupGuide, useSetupGuideAction } from './use-setup-guide';

const CTA_LABELS: Readonly<Record<SetupStepKey, string>> = {
  crm_workspace: 'Browse templates',
  crm_first_deal: 'Open your pipeline',
  invite_team: 'Invite teammates',
  crm_dashboard: 'Create a dashboard',
};

const DASHBOARD_DISABLED_REASON =
  'Your workspaces are still loading. Try again in a moment.';

/** In-context arrival (contract): navigating CTAs carry ?setup=<step_key>. */
function withSetupParam(href: string, key: SetupStepKey): string {
  return `${href}${href.includes('?') ? '&' : '?'}setup=${key}`;
}

function StepStatusChip({
  step,
  index,
  current,
}: {
  readonly step: SetupGuideStepDto;
  readonly index: number;
  readonly current: boolean;
}) {
  if (step.status === 'done') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-success text-white animate-pop-in motion-reduce:animate-none">
        <Check aria-hidden className="size-3.5" strokeWidth={3} />
        <span className="sr-only">Done</span>
      </span>
    );
  }
  if (step.status === 'skipped') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-dashed border-border-strong text-fg-muted">
        <Check aria-hidden className="size-3 opacity-40" />
        <span className="sr-only">Skipped</span>
      </span>
    );
  }
  if (step.status === 'locked') {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong bg-sunken text-fg-muted">
        <Lock aria-hidden className="size-3" />
        <span className="sr-only">Locked</span>
      </span>
    );
  }
  return (
    <span
      className={cn(
        'flex size-6 shrink-0 items-center justify-center rounded-full border text-xs font-semibold tabular-nums',
        current ? 'border-primary bg-primary-subtle text-primary-text' : 'border-border-strong text-fg-muted',
      )}
      aria-hidden
    >
      {index + 1}
    </span>
  );
}

function CardShell({ children }: { readonly children: React.ReactNode }) {
  return (
    <section
      aria-labelledby="home-setup-guide"
      data-testid="setup-guide-card"
      className="flex min-w-0 flex-col rounded-xl border border-border-subtle bg-panel shadow-xs"
    >
      {children}
    </section>
  );
}

function StepCta({
  step,
  current,
  workspaceId,
  onRun,
}: {
  readonly step: SetupGuideStepDto;
  readonly current: boolean;
  readonly workspaceId: string | null;
  readonly onRun: (step: SetupGuideStepDto) => void;
}) {
  const needsWorkspace = step.action === 'dashboards' && !workspaceId;
  const button = (
    <Button
      variant={current ? 'primary' : 'secondary'}
      size="sm"
      data-testid={`setup-guide-cta-${step.key}`}
      disabled={needsWorkspace}
      onClick={() => onRun(step)}
    >
      {CTA_LABELS[step.key]}
    </Button>
  );
  if (!needsWorkspace) return button;
  // A disabled button swallows pointer events; the focusable wrapper keeps the
  // tooltip reachable by mouse and keyboard so the reason is always discoverable.
  return (
    <Tooltip content={DASHBOARD_DISABLED_REASON}>
      <span tabIndex={0} className="inline-flex rounded-md outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus">
        {button}
      </span>
    </Tooltip>
  );
}

function Celebration({
  canManage,
  pending,
  onDismiss,
}: {
  readonly canManage: boolean;
  readonly pending: boolean;
  readonly onDismiss: () => void;
}) {
  return (
    <div
      className="relative overflow-hidden rounded-xl animate-fade-in motion-reduce:animate-none"
      data-testid="setup-guide-all-set"
    >
      <ConfettiBurst />
      <div className="relative flex flex-wrap items-center gap-3 px-4 py-3.5">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-success-subtle text-success-text">
          <PartyPopper aria-hidden className="size-4.5" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="home-setup-guide" className="text-md font-semibold text-fg">
            All set
          </h2>
          <p className="text-sm text-fg-muted">
            Your CRM is up and running. Boards, pipeline, team and dashboards are in place.
          </p>
        </div>
        {canManage ? (
          <Button
            variant="secondary"
            size="sm"
            data-testid="setup-guide-dismiss"
            loading={pending}
            onClick={onDismiss}
          >
            Dismiss
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function SetupGuideCard({ workspaceId }: { readonly workspaceId: string | null }) {
  const router = useRouter();
  const { org } = useOrg();
  const canManage = useCan('org:update');
  const guide = useSetupGuide(org.id);
  const action = useSetupGuideAction(org.id);
  const openers = useOpenWizard();
  const requestCreate = useShellStore((state) => state.requestCreate);

  if (guide.isPending) {
    return (
      <CardShell>
        <div className="flex flex-col gap-3 p-4" data-skeleton aria-hidden>
          <Skeleton height={20} width={220} rounded="md" />
          <Skeleton height={44} rounded="md" />
          <Skeleton height={44} rounded="md" />
        </div>
      </CardShell>
    );
  }
  // Auxiliary card: a failed guide fetch must never degrade the home page (the
  // retryable sections below surface connectivity problems already).
  if (guide.isError || !guide.data) return null;
  const { steps, doneCount, skippedCount, totalCount, percent, allDone, allSettled, remainingMinutes, visible } =
    guide.data;
  if (!visible) return null;

  // Celebration ONLY when every step is genuinely done — skips never celebrate.
  if (allDone) {
    return (
      <CardShell>
        <Celebration
          canManage={canManage}
          pending={action.isPending}
          onDismiss={() => action.mutate({ action: 'dismiss' })}
        />
      </CardShell>
    );
  }

  const currentKey = steps.find((step) => step.status === 'ready')?.key ?? null;

  const runAction = (step: SetupGuideStepDto) => {
    if (step.action === 'templates') return openers.templates({ workspaceId: workspaceId ?? undefined });
    if (step.action === 'invite') return openers.invite();
    if (step.action === 'pipeline') {
      if (!step.targetId) return openers.templates({ workspaceId: workspaceId ?? undefined });
      startRouteProgress();
      router.push(withSetupParam(routes.board(org.slug, step.targetId), step.key));
      return;
    }
    if (workspaceId) requestCreate({ kind: 'dashboard', workspaceId });
  };

  return (
    <CardShell>
      <header className="flex items-center gap-3.5 border-b border-border-subtle px-4 py-3">
        <ProgressRing percent={percent} />
        <div className="min-w-0 flex-1">
          <h2 id="home-setup-guide" className="text-md font-semibold text-fg">
            Getting started
          </h2>
          {allSettled ? (
            <p className="text-xs text-fg-muted" data-testid="setup-guide-wrapped-up">
              Wrapped up: {skippedCount} skipped. Undo a skip below to pick it back up.
            </p>
          ) : (
            <p className="text-xs text-fg-muted">
              {doneCount} of {totalCount} complete
              {remainingMinutes > 0 ? <> · about {remainingMinutes} min left</> : null}
              <span className="hidden sm:inline"> · Steps check themselves off as you work.</span>
            </p>
          )}
        </div>
        {canManage ? (
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <IconButton label="Setup guide options" icon={<EllipsisVertical aria-hidden />} data-testid="setup-guide-menu" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                icon={<X aria-hidden />}
                data-testid="setup-guide-dismiss"
                onSelect={() => action.mutate({ action: 'dismiss' })}
              >
                Dismiss guide
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        ) : null}
      </header>

      <ol className="flex flex-col p-2">
        {steps.map((step, index) => {
          const current = step.key === currentKey;
          return (
            <li key={step.key}>
              <div
                data-testid={`setup-guide-step-${step.key}`}
                data-status={step.status}
                className={cn(
                  'group flex items-center gap-3 rounded-lg px-2.5 py-2.5 transition-colors duration-[var(--duration-fast)]',
                  current ? 'bg-primary-subtle/60' : 'hover:bg-hover',
                )}
              >
                <StepStatusChip step={step} index={index} current={current} />
                <div className="min-w-0 flex-1">
                  <p
                    className={cn(
                      'truncate text-sm font-medium',
                      // Contract vocabulary: done = muted, NO strikethrough;
                      // strikethrough is reserved for skipped rows.
                      step.status === 'done' && 'text-fg-muted',
                      step.status === 'skipped' && 'text-fg-muted line-through decoration-border-strong',
                      step.status === 'locked' && 'text-fg-muted',
                      step.status === 'ready' && 'text-fg',
                    )}
                  >
                    {step.title}
                    {step.status === 'ready' || step.status === 'locked' ? (
                      <span className="ml-2 text-2xs font-normal text-fg-muted tabular-nums no-underline">
                        ~{step.minutes} min
                      </span>
                    ) : null}
                  </p>
                  {step.status === 'locked' ? (
                    <p className="flex items-center gap-1 truncate text-xs text-fg-muted">
                      <Lock aria-hidden className="size-3 shrink-0" />
                      Unlocks after {step.lockedBy}
                    </p>
                  ) : step.status === 'skipped' ? (
                    <p className="hidden truncate text-xs text-fg-muted md:block">
                      Skipped. You can finish this any time.
                    </p>
                  ) : step.status === 'ready' ? (
                    <p className="hidden truncate text-xs text-fg-muted md:block">{step.description}</p>
                  ) : null}
                </div>
                {step.status === 'done' ? (
                  <span className="shrink-0 text-xs font-medium text-success-text">
                    Done{step.auto ? ' · detected' : ''}
                  </span>
                ) : step.status === 'ready' ? (
                  <>
                    {canManage ? (
                      <Button
                        variant="ghost"
                        size="xs"
                        // Hover-revealed on fine pointers; always visible (reduced
                        // emphasis) on coarse pointers, and whenever focused.
                        className="opacity-70 transition-opacity duration-[var(--duration-fast)] pointer-fine:opacity-0 pointer-fine:group-hover:opacity-100 pointer-fine:group-focus-within:opacity-100 focus-visible:opacity-100"
                        data-testid={`setup-guide-skip-${step.key}`}
                        disabled={action.isPending}
                        onClick={() => action.mutate({ action: 'skip', stepKey: step.key })}
                      >
                        Skip
                      </Button>
                    ) : null}
                    <StepCta step={step} current={current} workspaceId={workspaceId} onRun={runAction} />
                  </>
                ) : step.status === 'skipped' && canManage ? (
                  <Button
                    variant="ghost"
                    size="xs"
                    leadingIcon={<RotateCcw aria-hidden />}
                    data-testid={`setup-guide-unskip-${step.key}`}
                    disabled={action.isPending}
                    onClick={() => action.mutate({ action: 'unskip', stepKey: step.key })}
                  >
                    Undo skip
                  </Button>
                ) : null}
              </div>
            </li>
          );
        })}
      </ol>
    </CardShell>
  );
}
