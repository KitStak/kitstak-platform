'use client';
/**
 * In-context arrival bridge (cross-app onboarding contract): guide CTAs append
 * `?setup=<step_key>` when they navigate, and the shell shows this slim dismissible
 * callout on arrival — "Setup step: <title>" plus one helper sentence — so the user
 * is never dropped on a screen with no bridge back to the guide. Dismissing clears
 * the param (other params survive). Unknown keys render nothing.
 */
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { Rocket, X } from 'lucide-react';
import { IconButton } from '@/components/ui';
import { isSetupStepKey, SETUP_GUIDE_STEPS } from '@/server/services/setup-guide-model';

export function SetupCallout() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const key = searchParams.get('setup');
  if (!key || !isSetupStepKey(key)) return null;
  const step = SETUP_GUIDE_STEPS.find((definition) => definition.key === key);
  if (!step) return null;

  const dismiss = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('setup');
    const query = next.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  };

  return (
    <div
      data-testid="setup-callout"
      className="flex items-center gap-2.5 border-b border-border-subtle bg-primary-subtle/60 px-4 py-1.5"
    >
      <Rocket aria-hidden className="size-3.5 shrink-0 text-primary-text" />
      <p className="min-w-0 flex-1 truncate text-xs text-fg">
        <span className="font-semibold">Setup step: {step.title}</span>
        <span className="text-fg-muted"> — {step.description}</span>
      </p>
      <IconButton
        size="xs"
        label="Dismiss setup callout"
        icon={<X aria-hidden />}
        data-testid="setup-callout-dismiss"
        onClick={dismiss}
      />
    </div>
  );
}
