'use client';
import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CheckCircle2, Circle, Crown, FileSpreadsheet, KeyRound, Sparkles, UserPlus } from 'lucide-react';
import { Panel } from '@/components/layout/page';
import { Badge, Button, toast } from '@/components/ui';
import { useShell } from '@/features/shell/shell-context';
import { CREW_ROLE_LABELS, type CrewRole } from '@/lib/permissions';
import { arrivesIn } from '@/lib/pages';
import type { SetupStepState } from '@/lib/setup-steps';
import type { RunCrewState } from '@/server/domain/roles';
import { claimCrewAction } from '@/server/actions/welcome';

function browserTimezone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

function ClaimStep({ orgName, role, state }: { readonly orgName: string; readonly role: CrewRole; readonly state: RunCrewState }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const claim = async () => {
    setPending(true);
    const result = await claimCrewAction({ timezone: browserTimezone() });
    setPending(false);
    if (!result.ok) {
      toast.error('Could not set you up as the owner', result.error.message);
      return;
    }
    toast.success('You run Crew for this workspace', 'Your first site uses the time zone of this browser. You can change it in Settings.');
    router.refresh();
  };
  if (state.hasOwner) {
    return (
      <Panel title="Who runs Crew">
        <p className="text-base text-fg-secondary" data-testid="welcome-owner">
          {state.ownerNames.length > 0 ? `${state.ownerNames.join(', ')} ${state.ownerNames.length === 1 ? 'runs' : 'run'} Crew for ${orgName}.` : `Crew has an owner for ${orgName}.`} Your Crew role is {CREW_ROLE_LABELS[role]}.
        </p>
      </Panel>
    );
  }
  return (
    <Panel title="Who runs Crew">
      <div className="flex flex-col gap-3" data-testid="welcome-claim">
        <p className="text-base text-fg-secondary">
          Nobody runs Crew for {orgName} yet. The owner sets it up, picks who can see pay and gives everyone else a role.
        </p>
        {state.canClaim ? (
          <div>
            <Button onClick={() => void claim()} loading={pending} leadingIcon={<Crown aria-hidden />} data-testid="welcome-claim-button">
              Run Crew for this workspace
            </Button>
          </div>
        ) : (
          <p className="text-sm text-fg-muted">Ask an admin of your workspace to open Crew and take this step.</p>
        )}
      </div>
    </Panel>
  );
}

function StepRow({ step, pulseUrl }: { readonly step: SetupStepState; readonly pulseUrl: string }) {
  const href = step.href.startsWith('pulse:') ? `${pulseUrl}${step.href.slice('pulse:'.length)}` : step.href;
  const Icon = step.done ? CheckCircle2 : Circle;
  return (
    <li className="flex items-start gap-3 py-3 first:pt-0 last:pb-0" data-testid={`setup-step-${step.key}`}>
      <Icon aria-hidden className={step.done ? 'mt-0.5 size-5 shrink-0 text-success' : 'mt-0.5 size-5 shrink-0 text-icon'} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-fg">
          {step.title}
          <span className="sr-only">{step.done ? ', done' : ', not done yet'}</span>
        </p>
        <p className="mt-0.5 text-sm text-fg-muted">{step.waiting && !step.done ? `${step.detail} Do the step above first.` : step.detail}</p>
      </div>
      {step.done ? (
        <Badge tone="success">Done</Badge>
      ) : step.href.startsWith('pulse:') ? (
        <a href={href} className="shrink-0 text-sm font-medium text-fg-link hover:underline">
          Open Pulse
        </a>
      ) : (
        <Link href={href} className="shrink-0 text-sm font-medium text-fg-link hover:underline">
          Open
        </Link>
      )}
    </li>
  );
}

export function WelcomeView({ orgName, role, state, canSetUp, steps }: { readonly orgName: string; readonly role: CrewRole; readonly state: RunCrewState; readonly canSetUp: boolean; readonly steps: readonly SetupStepState[] }) {
  const { appUrls } = useShell();
  const starts = [
    { icon: Sparkles, title: 'Try it with sample data', detail: 'One site, 10 people and 2 weeks, removed in one click.' },
    { icon: FileSpreadsheet, title: 'Import your people', detail: 'From your agency or payroll, with a template for the columns.' },
    { icon: UserPlus, title: 'Type the first people', detail: 'A short form per person. Crew makes numbers for temps.' },
  ];
  return (
    <div className="flex flex-col gap-4">
      <ClaimStep orgName={orgName} role={role} state={state} />
      {canSetUp ? (
        <>
          <Panel title="Who can see pay?">
            <div className="flex items-start gap-3">
              <KeyRound aria-hidden className="mt-0.5 size-5 shrink-0 text-icon" />
              <p className="text-base text-fg-secondary">
                Owners, admins and people with the Payroll role see pay types, wages and payroll files. Supervisors and leads never do: the server leaves those fields out. You give someone the Payroll role under Settings, People and roles. {arrivesIn(1)}.
              </p>
            </div>
          </Panel>
          <Panel title="How do you want to start?">
            <ul className="grid gap-3 sm:grid-cols-3">
              {starts.map((start) => (
                <li key={start.title} className="flex flex-col gap-1.5 rounded-lg border border-border-subtle bg-sunken p-3">
                  <start.icon aria-hidden className="size-5 text-icon" />
                  <span className="text-sm font-medium text-fg">{start.title}</span>
                  <span className="text-sm text-fg-muted">{start.detail}</span>
                  <span className="text-xs text-fg-muted">{arrivesIn(1)}</span>
                </li>
              ))}
            </ul>
          </Panel>
        </>
      ) : null}
      <Panel title="Setup checklist">
        <ol className="flex flex-col divide-y divide-border-subtle" data-testid="setup-checklist">
          {steps.map((step) => (
            <StepRow key={step.key} step={step} pulseUrl={appUrls.pulse} />
          ))}
        </ol>
      </Panel>
    </div>
  );
}
