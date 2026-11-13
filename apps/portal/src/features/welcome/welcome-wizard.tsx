'use client';
/**
 * The 60-second welcome wizard: three tile-click questions → a personalized setup plan.
 * No free text, every screen skippable, arrow-key friendly. Answers persist to
 * core.onboarding_progress ('profile' step) and shape the launcher's setup guide.
 */
import { useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  FlaskConical,
  LayoutGrid,
  Package,
  Rocket,
  ShoppingBag,
  Sparkles,
  TrendingUp,
  Truck,
  Upload,
} from 'lucide-react';
import { Button, cn } from '@/components/ui';
import {
  buildSetupSteps,
  summarizeSetup,
  type BusinessType,
  type SetupFocus,
  type SetupProfile,
  type StartMode,
  type TeamSize,
} from '@/lib/setup-model';
import { saveSetupProfile } from '@/server/onboarding-actions';
import { PillGroup, TileGroup } from './option-tile';

type WizardStep = 'focus' | 'about' | 'start' | 'plan';
const STEP_ORDER: readonly WizardStep[] = ['focus', 'about', 'start', 'plan'];

const STEP_COPY: Readonly<Record<WizardStep, { title: string; subtitle: string }>> = {
  focus: {
    title: 'What will your team run on KitStak?',
    subtitle: 'Pick what you need today — you can always turn on more later.',
  },
  about: {
    title: 'What kind of business are you?',
    subtitle: 'This shapes your setup plan. Nothing here is locked in.',
  },
  start: {
    title: 'How do you want to start?',
    subtitle: 'Every option leads to the same place — a working workspace.',
  },
  plan: {
    title: 'Here’s your setup plan',
    subtitle: 'Steps check themselves off as you work. Nothing to tick manually.',
  },
};

export interface WelcomeWizardProps {
  readonly firstName: string;
  readonly orgName: string;
  readonly crmEntitled: boolean;
  readonly wmsEntitled: boolean;
}

export function WelcomeWizard({ firstName, orgName, crmEntitled, wmsEntitled }: WelcomeWizardProps) {
  const router = useRouter();
  const initialFocus: SetupFocus =
    crmEntitled && wmsEntitled ? 'both' : crmEntitled ? 'crm' : wmsEntitled ? 'wms' : 'both';
  const [stepIndex, setStepIndex] = useState(0);
  const [focus, setFocus] = useState<SetupFocus>(initialFocus);
  const [businessType, setBusinessType] = useState<BusinessType | null>(null);
  const [teamSize, setTeamSize] = useState<TeamSize>('small');
  const [startMode, setStartMode] = useState<StartMode>('fresh');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = STEP_ORDER[stepIndex];
  const copy = STEP_COPY[step];
  const canContinue = step !== 'about' || businessType !== null;

  const planProfile: SetupProfile | null =
    businessType === null ? null : { focus, businessType, teamSize, startMode };

  const planSteps = useMemo(() => {
    if (planProfile === null) return [];
    return buildSetupSteps(
      {
        memberCount: 1,
        pendingInvites: 0,
        crmEntitled,
        wmsEntitled,
        crmBoards: 0,
        crmDeals: 0,
        wmsWarehouses: 0,
        wmsProducts: 0,
        wmsOrders: 0,
      },
      planProfile,
      {},
    ).filter((planStep) => planStep.key !== 'profile');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focus, businessType, teamSize, startMode, crmEntitled, wmsEntitled]);

  const planMinutes = summarizeSetup(planSteps).remainingMinutes;

  const goNext = () => setStepIndex((index) => Math.min(index + 1, STEP_ORDER.length - 1));
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0));

  const finish = async () => {
    if (planProfile === null) return;
    setSaving(true);
    setError(null);
    try {
      const result = await saveSetupProfile(planProfile);
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong. Try again.');
        setSaving(false);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError('We couldn’t reach KitStak. Check your connection and try again.');
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8">
      <header className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <p className="text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">
            Welcome to KitStak
          </p>
          <Link
            href="/"
            className="text-sm font-medium text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus rounded-md"
          >
            Skip for now
          </Link>
        </div>
        <div>
          <h1 className="text-2xl font-semibold tracking-[-0.02em] text-fg">{copy.title}</h1>
          <p className="mt-2 max-w-lg text-md text-fg-secondary">
            {step === 'focus' ? `Good to meet you, ${firstName}. ${copy.subtitle}` : copy.subtitle}
          </p>
        </div>
        <div className="flex items-center gap-2" aria-label={`Step ${stepIndex + 1} of ${STEP_ORDER.length}`}>
          {STEP_ORDER.map((name, index) => (
            <span
              key={name}
              aria-hidden
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-[var(--duration-normal)]',
                index <= stepIndex ? 'bg-primary' : 'bg-sunken',
              )}
            />
          ))}
        </div>
      </header>

      <div key={step} className="animate-step-in motion-reduce:animate-none">
        {step === 'focus' ? (
          <TileGroup<SetupFocus>
            label="What will your team run on KitStak?"
            value={focus}
            onChange={setFocus}
            options={[
              {
                value: 'wms',
                label: 'Warehouse ops',
                caption: 'Receiving, inventory, picking and shipping.',
                icon: <Package aria-hidden />,
              },
              {
                value: 'crm',
                label: 'Sales CRM',
                caption: 'Pipelines, contacts, deals and follow-ups.',
                icon: <TrendingUp aria-hidden />,
              },
              {
                value: 'both',
                label: 'Both',
                caption: 'The full suite with one login.',
                icon: <LayoutGrid aria-hidden />,
                recommended: true,
              },
            ]}
          />
        ) : null}

        {step === 'about' ? (
          <div className="flex flex-col gap-8">
            <TileGroup<BusinessType>
              label="What kind of business are you?"
              value={businessType}
              onChange={setBusinessType}
              columns={2}
              options={[
                {
                  value: '3pl',
                  label: '3PL warehouse',
                  caption: 'We store and ship for other companies.',
                  icon: <Boxes aria-hidden />,
                },
                {
                  value: 'brand',
                  label: 'Brand / e-commerce',
                  caption: 'We sell and fulfill our own products.',
                  icon: <ShoppingBag aria-hidden />,
                },
                {
                  value: 'distributor',
                  label: 'Distributor / wholesale',
                  caption: 'We move goods in bulk to businesses.',
                  icon: <Truck aria-hidden />,
                },
                {
                  value: 'other',
                  label: 'Something else',
                  caption: 'We’ll keep the plan general.',
                  icon: <Sparkles aria-hidden />,
                },
              ]}
            />
            <div className="flex flex-col gap-3">
              <p className="text-sm font-medium text-fg">How big is your team?</p>
              <PillGroup<TeamSize>
                label="How big is your team?"
                value={teamSize}
                onChange={setTeamSize}
                options={[
                  { value: 'solo', label: 'Just me' },
                  { value: 'small', label: '2–10' },
                  { value: 'medium', label: '11–50' },
                  { value: 'large', label: '50+' },
                ]}
              />
            </div>
          </div>
        ) : null}

        {step === 'start' ? (
          <TileGroup<StartMode>
            label="How do you want to start?"
            value={startMode}
            onChange={setStartMode}
            options={[
              {
                value: 'fresh',
                label: 'Start fresh',
                caption: 'A clean workspace, ready for your real data.',
                icon: <Rocket aria-hidden />,
                recommended: true,
              },
              {
                value: 'sample',
                label: 'Explore sample data',
                caption: 'Poke around a working demo before you commit.',
                icon: <FlaskConical aria-hidden />,
              },
              {
                value: 'import',
                label: 'Import my data',
                caption: 'Bring items and orders in from spreadsheets.',
                icon: <Upload aria-hidden />,
              },
            ]}
          />
        ) : null}

        {step === 'plan' ? (
          <div className="overflow-hidden rounded-2xl border border-border-default bg-panel shadow-xs">
            <div className="flex items-center justify-between gap-3 border-b border-border-subtle bg-sunken/60 px-5 py-3.5">
              <p className="text-sm font-semibold text-fg">Setup plan for {orgName}</p>
              <p className="text-xs text-fg-muted tabular-nums">about {planMinutes} min total</p>
            </div>
            <ol className="divide-y divide-border-subtle">
              {planSteps.map((planStep, index) => (
                <li key={planStep.key} className="flex items-center gap-3 px-5 py-3">
                  <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-xs font-semibold text-fg-muted tabular-nums">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-fg">{planStep.title}</p>
                    <p className="mt-0.5 truncate text-xs text-fg-muted">{planStep.description}</p>
                  </div>
                  <span className="shrink-0 text-2xs text-fg-muted tabular-nums">
                    ~{planStep.minutes} min
                  </span>
                </li>
              ))}
            </ol>
            <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3">
              <Check aria-hidden className="size-4 text-success-text" />
              <p className="text-xs text-fg-muted">
                KitStak detects each step as you finish it — your progress updates by itself.
              </p>
            </div>
          </div>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="rounded-lg border border-danger/45 bg-danger-subtle px-4 py-3 text-sm text-danger-text">
          {error}
        </p>
      ) : null}

      <footer className="flex items-center justify-between">
        <Button
          variant="ghost"
          onClick={goBack}
          disabled={stepIndex === 0 || saving}
          leadingIcon={<ArrowLeft aria-hidden />}
          className={cn(stepIndex === 0 && 'invisible')}
        >
          Back
        </Button>
        {step === 'plan' ? (
          <Button size="lg" loading={saving} onClick={finish} trailingIcon={<ArrowRight aria-hidden />}>
            Open my launcher
          </Button>
        ) : (
          <Button
            size="lg"
            onClick={goNext}
            disabled={!canContinue}
            trailingIcon={<ArrowRight aria-hidden />}
          >
            Continue
          </Button>
        )}
      </footer>
    </div>
  );
}
