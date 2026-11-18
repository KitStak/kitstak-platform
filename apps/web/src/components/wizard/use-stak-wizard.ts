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
/** The screen after the last step. Not a step in the progress bar. */
export type WizardView = StepId | 'ready';

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
  readonly view: WizardView;
  readonly stepIndex: number;
  /** Index of the furthest step the visitor may open. */
  readonly reachableIndex: number;
  readonly update: (patch: Partial<StakAnswers>) => void;
  readonly goTo: (view: WizardView) => void;
  readonly next: () => void;
  readonly back: () => void;
}

/**
 * Wizard state. Answers live in sessionStorage (so a refresh keeps them, and closing the tab
 * clears them); the current step lives in the URL (`?step=`), so the browser's back button
 * walks back through the steps. `canFinish` says whether the account details (held by the caller)
 * are valid; the final screen never shows without it.
 */
export function useStakWizard(canFinish: boolean): StakWizard {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [answers, setAnswers] = useState<StakAnswers>(DEFAULT_ANSWERS);
  const [isReady, setIsReady] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);

  // Saved answers first, then anything a deep link carries (?stack=, ?seats=, ...).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    // An old or typed link for a product that is coming soon goes to the walkthrough form.
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
  const view: WizardView = useMemo(() => {
    if (requested === 'ready' && isSubmitted && canFinish && !blocked) return 'ready';
    // A reload on the last screen lands on the account step (the draft is not kept).
    const wanted = requested === 'ready' ? 'account' : requested;
    if (!isStepId(wanted)) return STEP_IDS[0];
    // Never show a step whose earlier required answers are missing.
    return STEP_IDS[Math.min(STEP_IDS.indexOf(wanted), reachableIndex)]!;
  }, [requested, isSubmitted, canFinish, blocked, reachableIndex]);

  const goTo = useCallback(
    (target: WizardView) => {
      if (target === 'ready') setIsSubmitted(true);
      const params = new URLSearchParams();
      params.set('step', target);
      router.push(`${pathname}?${params.toString()}`, { scroll: false });
      window.scrollTo({ top: 0 });
    },
    [router, pathname],
  );

  const stepIndex = view === 'ready' ? STEP_IDS.length : STEP_IDS.indexOf(view);

  const next = useCallback(() => {
    if (view === 'ready' || !canLeaveStep(view, answers)) return;
    const following = STEP_IDS[STEP_IDS.indexOf(view) + 1];
    goTo(following ?? 'ready');
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
