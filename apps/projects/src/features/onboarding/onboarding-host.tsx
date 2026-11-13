'use client';
/**
 * First-run onboarding, mounted once by the app shell. New people get a short welcome (what
 * Projects does, three ways to start), then an optional 4-step spotlight tour. Both are
 * remembered per person in prefs.onboarding, so they show once; Help → "Take the tour" replays it.
 */
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { CalendarCheck2, Compass, LayoutTemplate, Workflow } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Button, Dialog, DialogContent, toast } from '@/components/ui';
import { useMe } from '@/lib/hooks/use-data';
import { qk } from '@/lib/query-keys';
import { routes } from '@/lib/routes';
import { updateOnboardingAction } from '@/server/actions/onboarding';
import { ProjectsMark } from '@/features/shell/logo';
import { useShell } from '@/features/shell/shell-context';
import { GuidedTour } from './guided-tour';
import { SampleProjectButton } from './sample-project-button';
import { useOnboardingStore } from './store';

interface OnboardingPrefs {
  readonly welcomeSeen?: boolean;
  readonly tourSeen?: boolean;
  readonly tourStep?: number;
  readonly dismissed?: boolean;
}

const HIGHLIGHTS = [
  {
    icon: CalendarCheck2,
    title: 'Plan the work',
    body: 'Boards, lists, timelines and calendars for every project.',
  },
  {
    icon: Workflow,
    title: 'Skip the busywork',
    body: 'Automations remind people and hand work off for you.',
  },
  {
    icon: LayoutTemplate,
    title: 'Start ahead',
    body: 'Templates for launches, go-lives, onboarding and more.',
  },
] as const;

export function OnboardingHost() {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { user, can } = useShell();
  const me = useMe();
  const welcomeOpen = useOnboardingStore((s) => s.welcomeOpen);
  const tourOpen = useOnboardingStore((s) => s.tourOpen);
  const step = useOnboardingStore((s) => s.step);
  const decided = useRef(false);

  const save = useCallback(
    async (patch: OnboardingPrefs) => {
      const result = await updateOnboardingAction(patch);
      if (result.ok) void queryClient.invalidateQueries({ queryKey: qk.me() });
    },
    [queryClient],
  );

  // First visit: show the welcome once the person's preferences have loaded.
  useEffect(() => {
    if (decided.current || !me.data) return;
    decided.current = true;
    const onboarding = (me.data.prefs.onboarding ?? {}) as OnboardingPrefs;
    if (onboarding.dismissed || onboarding.welcomeSeen) return;
    const timer = window.setTimeout(() => useOnboardingStore.getState().openWelcome(), 700);
    return () => window.clearTimeout(timer);
  }, [me.data]);

  const closeWelcome = (startTour: boolean) => {
    useOnboardingStore.getState().closeWelcome();
    void save({ welcomeSeen: true });
    if (startTour) {
      // Wait for the dialog to animate out so the spotlight lands on a still page.
      window.setTimeout(() => useOnboardingStore.getState().startTour(0), 250);
    }
  };

  const firstName = user.name.split(/\s+/)[0] || user.name;

  return (
    <>
      <Dialog open={welcomeOpen} onOpenChange={(open) => (open ? undefined : closeWelcome(false))}>
        <DialogContent
          size="md"
          className="overflow-hidden"
          data-testid="welcome-dialog"
          onOpenAutoFocus={(event) => {
            // Land on the main choice, not the first button.
            event.preventDefault();
            (event.currentTarget as HTMLElement | null)
              ?.querySelector<HTMLElement>('[data-testid="welcome-tour"]')
              ?.focus();
          }}
        >
          <div className="relative bg-[linear-gradient(135deg,var(--primary-subtle),transparent_70%)] px-6 pt-7 pb-5">
            <ProjectsMark size={40} />
            <DialogPrimitive.Title className="mt-4 text-2xl font-semibold tracking-[-0.02em] text-fg">
              Welcome to Projects, {firstName}!
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1.5 text-base text-fg-secondary">
              One place to plan work, see who’s doing what, and hit your dates. It works on its own or
              together with the KitStak CRM and WMS.
            </DialogPrimitive.Description>
          </div>
          <ul className="grid gap-3 px-6 py-4 sm:grid-cols-3">
            {HIGHLIGHTS.map((item) => {
              const Icon = item.icon;
              return (
                <li key={item.title} className="rounded-lg bg-sunken p-3">
                  <Icon aria-hidden className="size-5 text-primary-text" />
                  <p className="mt-2 text-sm font-semibold text-fg">{item.title}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{item.body}</p>
                </li>
              );
            })}
          </ul>
          <div className="flex flex-col gap-2 border-t border-border-subtle px-6 py-4 sm:flex-row sm:items-center">
            <Button
              variant="ghost"
              onClick={() => closeWelcome(false)}
              className="sm:mr-auto"
              data-testid="welcome-skip"
            >
              I’ll look around myself
            </Button>
            {can('project:create') ? (
              <SampleProjectButton
                onCreated={(project) => {
                  closeWelcome(false);
                  router.push(routes.projectTab(project.key, 'board'));
                }}
              >
                Try a sample project
              </SampleProjectButton>
            ) : null}
            <Button
              leadingIcon={<Compass aria-hidden />}
              onClick={() => closeWelcome(true)}
              data-testid="welcome-tour"
            >
              Show me around
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <GuidedTour
        open={tourOpen}
        step={step}
        onStep={(next) => {
          useOnboardingStore.getState().setStep(next);
          void save({ tourStep: next });
        }}
        onClose={(finished) => {
          useOnboardingStore.getState().endTour();
          void save({ tourSeen: true, tourStep: 0 });
          if (finished)
            toast.success('You’re ready to go', 'Replay the tour any time from Help (?) at the top.');
        }}
      />
    </>
  );
}
