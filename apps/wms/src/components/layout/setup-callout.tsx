'use client';

/**
 * In-context setup callout (contract: docs/integration/ONBOARDING.md §In-context arrival).
 * Setup-guide CTAs deep-link with `?setup=<step_key>`; when the shell lands on a page
 * carrying a known step key, this slim banner names the step so the user is never dropped
 * on a screen with no bridge back to the guide. The X clears the param (and the banner).
 */
import * as React from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { ListChecks, X } from 'lucide-react';
import { SETUP_STEPS } from '@/lib/setup-guide-model';

function SetupCalloutInner() {
  const searchParams = useSearchParams();
  const pathname = usePathname();
  const router = useRouter();
  const key = searchParams.get('setup');
  const step = key ? SETUP_STEPS.find((candidate) => candidate.key === key) : undefined;
  if (!step) return null;

  const clear = () => {
    const next = new URLSearchParams(searchParams);
    next.delete('setup');
    const qs = next.toString();
    router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
  };

  return (
    <div
      role="status"
      data-testid="setup-callout"
      className="flex items-center gap-2 border-b border-border-subtle bg-primary-soft px-4 py-1.5 text-xs text-foreground"
    >
      <ListChecks className="h-3.5 w-3.5 shrink-0 text-primary" aria-hidden />
      <p className="min-w-0 flex-1 truncate">
        <span className="font-semibold">Setup step: {step.title}.</span>{' '}
        <span className="text-secondary">{step.description}</span>
      </p>
      <button
        type="button"
        onClick={clear}
        aria-label="Dismiss setup step callout"
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-fg-muted hover:bg-hover hover:text-fg focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-focus"
      >
        <X className="h-3.5 w-3.5" aria-hidden />
      </button>
    </div>
  );
}

/** useSearchParams needs a Suspense boundary; the callout renders nothing while unknown. */
export function SetupCallout() {
  return (
    <React.Suspense fallback={null}>
      <SetupCalloutInner />
    </React.Suspense>
  );
}
