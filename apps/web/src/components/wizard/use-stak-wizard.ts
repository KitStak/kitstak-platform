'use client';

import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { ROUTES } from '@/components/site-links';
import {
  DEFAULT_ANSWERS,
  STEP_IDS,
  applyPrefill,
  asksOnlyForUnopenedProducts,
  canLeaveStep,
  parseAnswers,
} from '@/lib/stak';
import type { StakAnswers, StepId } from '@/lib/stak';

const STORAGE_KEY = 'kitstak.stak.v1';

function readStored(): StakAnswers {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? parseAnswers(JSON.parse(raw)) : DEFAULT_ANSWERS;
  } catch {
    // Storage blocked or the saved value is not JSON: start from defaults.
    return DEFAULT_ANSWERS;
  }
}

function writeStored(answers: StakAnswers): void {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(answers));
  } catch {
    // Storage unavailable (private mode, quota). The wizard still works for this page view.
  }
}

/** First step whose required answers are missing, or null when every step can be left. */
function firstBlockedStep(answers: StakAnswers): StepId | null {
  return STEP_IDS.find((step) => !canLeaveStep(step, answers)) ?? null;
}

function isStepId(value: string | null): value is StepId {
  return STEP_IDS.includes(value as StepId);
}

export interface StakWizard {
  readonly isReady: boolean;
  readonly answers: StakAnswers;
  readonly view: StepId;
  readonly stepIndex: number;
  /** Index of the furthest step the visitor may open. */
  readonly reachableIndex: number;
  readonly update: (patch: Partial<StakAnswers>) => void;
  readonly goTo: (view: StepId) => void;
  readonly next: () => void;
  readonly back: () => void;
}

/**
 * Wizard state. Answers live in sessionStorage (so a refresh keeps them, and closing the tab
 * clears them); the current step lives in the URL (`?step=`), so the browser's back button
 * walks back through the steps. The last step hands off to portal sign-up (see `handoffUrl`).
 */
export function useStakWizard(): StakWizard {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [answers, setAnswers] = useState<StakAnswers>(DEFAULT_ANSWERS);
  const [isReady, setIsReady] = useState(false);

  // Saved answers first, then anything a deep link carries (?stack=, ?seats=, ...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // An old or typed link for a product whose app is not open goes to the walkthrough form.
    if (asksOnlyForUnopenedProducts(params)) {
      router.replace(ROUTES.demo);
      return;
    }
    setAnswers(applyPrefill(readStored(), params));
    setIsReady(true);
    // Runs once on mount: later URL changes are step changes, not new prefills.
  }, []);

  useEffect(() => {
    if (isReady) writeStored(answers);
  }, [answers, isReady]);

  const blocked = firstBlockedStep(answers);
  const reachableIndex = blocked ? STEP_IDS.indexOf(blocked) : STEP_IDS.length - 1;

  const requested = searchParams.get('step');
  const view: StepId = useMemo(() => {
    // Older links ended on a `ready` screen. That screen is gone: the account step is the last one.
    const wanted = requested === 'ready' ? 'account' : requested;
    if (!isStepId(wanted)) return STEP_IDS[0];
    // Never show a step whose earlier required answers are missing.
    return STEP_IDS[Math.min(STEP_IDS.indexOf(wanted), reachableIndex)]!;
  }, [requested, reachableIndex]);

  const goTo = useCallback(
    (target: StepId) => {
      const params = new URLSearchParams();
      params.set('step', target);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      window.scrollTo({ top: 0 });
    },
    [router, pathname],
  );

  const stepIndex = STEP_IDS.indexOf(view);

  const next = useCallback(() => {
    if (!canLeaveStep(view, answers)) return;
    const following = STEP_IDS[STEP_IDS.indexOf(view) + 1];
    if (following) goTo(following);
  }, [view, answers, goTo]);

  const back = useCallback(() => {
    const previous = STEP_IDS[stepIndex - 1];
    if (previous) goTo(previous);
  }, [stepIndex, goTo]);

  const update = useCallback((patch: Partial<StakAnswers>) => {
    setAnswers((current) => ({ ...current, ...patch }));
  }, []);

  return { isReady, answers, view, stepIndex, reachableIndex, update, goTo, next, back };
}
