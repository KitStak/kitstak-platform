'use client';
/**
 * The 60 second welcome wizard: the apps in your trial, three tile questions, then a short plan of
 * next steps. No free text, every screen can be skipped, arrow keys work. Answers are saved to
 * core.onboarding_progress ('profile' step) and shape the launcher's setup guide.
 *
 * Answers from the marketing site arrive already filled in. When all three are there the wizard
 * opens on its last screen, the plan, with one button: "Looks good".
 */
import { useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  ArrowLeft,
  ArrowRight,
  Boxes,
  Check,
  FlaskConical,
  Rocket,
  ShoppingBag,
  Sparkles,
  Truck,
  Upload,
} from 'lucide-react';
import { AppIcon } from '@kitstak/ui/app-icon';
import { CATALOG } from '@kitstak/billing/catalog';
import { Button, cn } from '@/components/ui';
import {
  SETUP_PRODUCTS,
  buildSetupSteps,
  focusFromProducts,
  pickWelcomeSteps,
  summarizeSetup,
  type BusinessType,
  type SetupBillingSignal,
  type SetupProduct,
  type SetupProfile,
  type StartMode,
  type TeamSize,
} from '@/lib/setup-model';
import { saveSetupProfile, skipWelcome } from '@/server/onboarding-actions';
import { PillGroup, TileGroup } from './option-tile';

type WizardStep = 'apps' | 'about' | 'start' | 'plan';
const STEP_ORDER: readonly WizardStep[] = ['apps', 'about', 'start', 'plan'];

const NO_NETWORK = 'We could not reach KitStak. Check your connection and try again.';

export interface WelcomePrefill {
  readonly businessType?: BusinessType;
  readonly teamSize?: TeamSize;
  readonly startMode?: StartMode;
}

export interface WelcomeWizardProps {
  readonly firstName: string;
  readonly orgName: string;
  /** The apps in the trial or plan. Empty when the team has none yet. */
  readonly products: readonly SetupProduct[];
  /** Facts for the "Pick your plan" step. null when the team never sees it. */
  readonly billing: SetupBillingSignal | null;
  /** "Dec 7, 2026" while a free trial is running. */
  readonly trialEndsOn: string | null;
  /** Answers already given on the marketing site. */
  readonly prefill: WelcomePrefill;
}

function AppsStep({
  products,
  trialEndsOn,
}: {
  readonly products: readonly SetupProduct[];
  readonly trialEndsOn: string | null;
}) {
  const chosen = new Set(products);
  return (
    <div className="flex flex-col gap-4">
      <ul className="grid gap-3 sm:grid-cols-2" aria-label="Your apps">
        {/* The apps the team has come first. */}
        {[...SETUP_PRODUCTS.filter((product) => chosen.has(product)), ...SETUP_PRODUCTS.filter((product) => !chosen.has(product))].map((product) => {
          const on = chosen.has(product);
          const pricing = CATALOG.products[product];
          return (
            <li
              key={product}
              className={cn(
                'flex items-start gap-3 rounded-xl border p-4',
                on ? 'border-border-default bg-panel shadow-xs' : 'border-dashed border-border-default bg-transparent',
              )}
            >
              <span
                className={cn(
                  'flex size-10 shrink-0 items-center justify-center rounded-lg border border-border-subtle bg-panel',
                  !on && 'opacity-60 grayscale',
                )}
              >
                <AppIcon app={product} size={28} />
              </span>
              <div className="min-w-0 flex-1">
                <p className={cn('text-sm font-semibold', on ? 'text-fg' : 'text-fg-muted')}>{pricing.name}</p>
                <p className="mt-0.5 text-xs leading-4 text-fg-muted">{pricing.tagline}</p>
                <p
                  className={cn(
                    'mt-2 inline-flex items-center gap-1 text-xs font-medium',
                    on ? 'text-success-text' : 'text-fg-muted',
                  )}
                >
                  {on ? <Check aria-hidden className="size-3.5" strokeWidth={3} /> : null}
                  {on ? (trialEndsOn ? 'In your free trial' : 'Ready to use') : 'Not added yet'}
                </p>
              </div>
            </li>
          );
        })}
      </ul>
      <p className="text-sm text-fg-secondary">
        {products.length === 0 ? 'You have no apps yet. ' : 'Want a different mix? '}
        <Link
          href="/billing/plan"
          className="rounded-sm font-semibold text-fg-link hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus"
        >
          {products.length === 0 ? 'Pick your apps' : 'Change your apps'}
        </Link>
        {products.length > 0 && trialEndsOn ? '. Apps you add are free until the same day.' : '.'}
      </p>
    </div>
  );
}

export function WelcomeWizard({ firstName, orgName, products, billing, trialEndsOn, prefill }: WelcomeWizardProps) {
  const router = useRouter();
  const prefilled =
    prefill.businessType !== undefined && prefill.teamSize !== undefined && prefill.startMode !== undefined;
  const [stepIndex, setStepIndex] = useState(prefilled ? STEP_ORDER.indexOf('plan') : 0);
  const [businessType, setBusinessType] = useState<BusinessType | null>(prefill.businessType ?? null);
  const [teamSize, setTeamSize] = useState<TeamSize>(prefill.teamSize ?? 'small');
  const [startMode, setStartMode] = useState<StartMode>(prefill.startMode ?? 'fresh');
  const [saving, setSaving] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const working = useRef(false);

  const step = STEP_ORDER[stepIndex] ?? 'apps';
  const canContinue = step !== 'about' || businessType !== null;
  const has = (product: SetupProduct): boolean => products.includes(product);

  const planProfile: SetupProfile | null =
    businessType === null
      ? null
      : { focus: focusFromProducts(products), businessType, teamSize, startMode, products };

  const planSteps = useMemo(() => {
    if (planProfile === null) return [];
    return pickWelcomeSteps(
      buildSetupSteps(
        {
          memberCount: 1,
          pendingInvites: 0,
          crmEntitled: has('crm'),
          wmsEntitled: has('wms'),
          crmBoards: 0,
          crmDeals: 0,
          wmsWarehouses: 0,
          wmsProducts: 0,
          wmsOrders: 0,
          projectsEntitled: has('projects'),
          pmProjects: 0,
          pmAssignedTasks: 0,
          pmLinks: 0,
          pulseEntitled: has('pulse'),
          pulseLaborRates: 0,
          pulseJobs: 0,
          pulseEntries: 0,
          pulseLinks: 0,
          billing,
        },
        planProfile,
        {},
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [businessType, teamSize, startMode, products, billing]);

  const planMinutes = summarizeSetup(planSteps).remainingMinutes;

  const goNext = () => setStepIndex((index) => Math.min(index + 1, STEP_ORDER.length - 1));
  const goBack = () => setStepIndex((index) => Math.max(index - 1, 0));

  const finish = async () => {
    if (planProfile === null || working.current) return;
    working.current = true;
    setSaving(true);
    setError(null);
    try {
      const result = await saveSetupProfile(planProfile);
      if (!result.ok) {
        setError(result.error ?? 'Something went wrong. Try again.');
        working.current = false;
        setSaving(false);
        return;
      }
      router.replace('/');
      router.refresh();
    } catch {
      setError(NO_NETWORK);
      working.current = false;
      setSaving(false);
    }
  };

  const skip = async () => {
    if (working.current) return;
    working.current = true;
    setSkipping(true);
    try {
      await skipWelcome();
    } catch {
      // Skipping must never trap anyone on this screen. The launcher still opens.
    }
    router.replace('/');
    router.refresh();
  };

  const greeting = firstName ? `Good to meet you, ${firstName}.` : 'Good to meet you.';
  const titles: Readonly<Record<WizardStep, { title: string; subtitle?: string }>> = {
    apps: {
      title: products.length > 0 ? 'Your apps are ready' : 'Welcome to KitStak',
      subtitle: trialEndsOn
        ? `${greeting} Your free trial runs until ${trialEndsOn}. No card needed.`
        : `${greeting} Here is what your team has.`,
    },
    about: { title: 'What kind of business are you?', subtitle: 'Nothing here is locked in.' },
    start: { title: 'How do you want to start?' },
    plan: {
      title: 'Here is your setup plan',
      subtitle: prefilled
        ? `${greeting} We built this from the answers you gave us.`
        : 'A few short steps to get your team going.',
    },
  };
  const copy = titles[step];

  return (
    <div className="mx-auto flex w-full max-w-[640px] flex-col gap-8">
      <header className="flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <p className="text-2xs font-semibold tracking-[0.08em] text-fg-muted uppercase">Welcome to KitStak</p>
          <button
            type="button"
            onClick={() => void skip()}
            disabled={saving || skipping}
            className="inline-flex min-h-11 items-center rounded-md px-2 text-sm font-medium text-fg-muted hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-focus sm:min-h-0 sm:py-1"
          >
            Skip for now
          </button>
        </div>
        <div>
          <h1 className="text-xl font-semibold tracking-[-0.02em] text-fg sm:text-2xl">{copy.title}</h1>
          {copy.subtitle ? <p className="mt-2 max-w-lg text-md text-fg-secondary">{copy.subtitle}</p> : null}
        </div>
        <div
          className="flex items-center gap-2"
          role="img"
          aria-label={`Step ${stepIndex + 1} of ${STEP_ORDER.length}`}
        >
          {STEP_ORDER.map((name, index) => (
            <span
              key={name}
              aria-hidden
              className={cn(
                'h-1 flex-1 rounded-full transition-colors duration-[var(--duration-normal)] motion-reduce:transition-none',
                index <= stepIndex ? 'bg-primary' : 'bg-sunken',
              )}
            />
          ))}
        </div>
      </header>

      <div key={step} className="animate-step-in motion-reduce:animate-none">
        {step === 'apps' ? <AppsStep products={products} trialEndsOn={trialEndsOn} /> : null}

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
                  label: 'Brand or online store',
                  caption: 'We sell and ship our own products.',
                  icon: <ShoppingBag aria-hidden />,
                },
                {
                  value: 'distributor',
                  label: 'Distributor or wholesale',
                  caption: 'We move goods in bulk to businesses.',
                  icon: <Truck aria-hidden />,
                },
                {
                  value: 'other',
                  label: 'Something else',
                  caption: 'We will keep the plan general.',
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
                  { value: 'small', label: '2 to 10' },
                  { value: 'medium', label: '11 to 50' },
                  { value: 'large', label: 'More than 50' },
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
                caption: 'Look around a working demo first.',
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
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border-subtle bg-sunken/60 px-5 py-3.5">
              <p className="text-sm font-semibold text-fg">Next steps for {orgName}</p>
              <p className="text-xs text-fg-muted tabular-nums">about {planMinutes} min in all</p>
            </div>
            {planSteps.length > 0 ? (
              <ol className="divide-y divide-border-subtle" data-testid="welcome-steps">
                {planSteps.map((planStep, index) => (
                  <li key={planStep.key} className="flex items-center gap-3 px-5 py-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full border border-border-strong text-xs font-semibold text-fg-muted tabular-nums">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-medium text-fg">{planStep.title}</p>
                      <p className="mt-0.5 text-xs text-fg-muted">{planStep.description}</p>
                    </div>
                    <span className="shrink-0 text-2xs text-fg-muted tabular-nums">{planStep.minutes} min</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="px-5 py-4 text-sm text-fg-secondary">
                Pick your apps first. Your steps will show up on the launcher.
              </p>
            )}
            <div className="flex items-center gap-2 border-t border-border-subtle px-5 py-3">
              <Check aria-hidden className="size-4 shrink-0 text-success-text" />
              <p className="text-xs text-fg-muted">Steps check themselves off as you finish them.</p>
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
          size="lg"
          onClick={goBack}
          disabled={stepIndex === 0 || saving || skipping}
          leadingIcon={<ArrowLeft aria-hidden />}
          className={cn('h-11', stepIndex === 0 && 'invisible')}
        >
          {step === 'plan' && prefilled ? 'Change answers' : 'Back'}
        </Button>
        {step === 'plan' ? (
          <Button
            size="lg"
            className="h-11"
            loading={saving}
            disabled={skipping}
            onClick={() => void finish()}
            trailingIcon={<ArrowRight aria-hidden />}
            data-testid="welcome-finish"
          >
            Looks good
          </Button>
        ) : (
          <Button
            size="lg"
            className="h-11"
            onClick={goNext}
            disabled={!canContinue || skipping}
            trailingIcon={<ArrowRight aria-hidden />}
            data-testid="welcome-continue"
          >
            Continue
          </Button>
        )}
      </footer>
    </div>
  );
}
