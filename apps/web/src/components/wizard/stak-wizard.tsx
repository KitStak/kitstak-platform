'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { TRIAL_LINE, quote } from '@/lib/pricing';
import { EMPTY_ACCOUNT, STEP_IDS, accountErrors, canLeaveStep, handoffUrl, selectionOf } from '@/lib/stak';
import type { AccountDraft, AccountErrors, StepId } from '@/lib/stak';
import { Logo } from '../logo';
import { ROUTES } from '../site-links';
import { AccountStep } from './account-step';
import { useStakWizard } from './use-stak-wizard';
import { BusinessStep, LaunchStep, ShapeStep, StackStep } from './wizard-steps';
import { WizardSummary } from './wizard-summary';
import styles from './wizard.module.css';

interface StepMeta {
  readonly short: string;
  readonly title: string;
  readonly lead: string;
}

const STEP_META: Readonly<Record<StepId, StepMeta>> = {
  stack: {
    short: 'Stack',
    title: 'What are you stacking?',
    lead: 'Pick the apps your team will run on. This sets up everything that follows.',
  },
  business: {
    short: 'Business',
    title: 'Tell us about your operation.',
    lead: 'Your answers decide what your setup plan starts with.',
  },
  shape: {
    short: 'Shape',
    title: 'Shape it to fit.',
    lead: 'Rough numbers are fine. Everything here can change later.',
  },
  launch: {
    short: 'Launch',
    title: 'Choose how you begin.',
    lead: 'Start empty, look around a working example, or bring your data with you.',
  },
  account: {
    short: 'Account',
    title: 'Create your account.',
    lead: 'Last step. This sets up your organization in KitStak. You own it and can invite your team.',
  },
};

/**
 * The "Set up your Stak" wizard: five steps, a live summary, and a hand-off to portal sign-up. The
 * last step's button opens the portal with the cart and the answers in the link, and the name,
 * email and company after the "#", so sign-up opens already filled in.
 */
export function StakWizard() {
  const [account, setAccount] = useState<AccountDraft>(EMPTY_ACCOUNT);
  const { isReady, answers, view, stepIndex, reachableIndex, update, goTo, next, back } = useStakWizard();
  const [errors, setErrors] = useState<AccountErrors>({});
  // True from the click on "Create my account" until the portal page takes over.
  const [isLeaving, setIsLeaving] = useState(false);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const hasSettled = useRef(false);

  // Move focus to the new step's heading so keyboard and screen-reader users land on it. The
  // first step shown after the saved answers load is where the visitor arrived, so it is skipped.
  useEffect(() => {
    if (!isReady) return;
    if (!hasSettled.current) {
      hasSettled.current = true;
      return;
    }
    headingRef.current?.focus({ preventScroll: true });
  }, [view, isReady]);

  // Coming back with the browser's back button shows this page from memory: make the button work again.
  useEffect(() => {
    const onShow = () => setIsLeaving(false);
    window.addEventListener('pageshow', onShow);
    return () => window.removeEventListener('pageshow', onShow);
  }, []);

  const estimate = answers.products.length > 0 ? quote(selectionOf(answers)) : null;

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    if (isLeaving || !canLeaveStep(view, answers)) return;
    if (view !== 'account') {
      next();
      return;
    }
    const found = accountErrors(account);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      const first = (['name', 'email', 'company'] as const).find((field) => found[field]);
      // After the error text has rendered, so the field is announced with its message.
      window.requestAnimationFrame(() => document.getElementById(`account-${first}`)?.focus());
      return;
    }
    setIsLeaving(true);
    window.location.assign(handoffUrl(answers, account));
  };

  const canContinue = canLeaveStep(view, answers);
  const meta = STEP_META[view];

  return (
    <div className={styles.page}>
      <header className={styles.top}>
        <div className={`container ${styles.topInner}`}>
          <Link href={ROUTES.home} aria-label="KitStak home" className={styles.topLogo}>
            <Logo height={18} />
          </Link>
          <ol className={styles.progress} aria-label="Setup steps">
            {STEP_IDS.map((step, i) => {
              const state = i < stepIndex ? 'done' : i === stepIndex ? 'current' : 'todo';
              const isOpenable = i <= reachableIndex && i !== stepIndex;
              return (
                <li key={step} data-state={state}>
                  <button
                    type="button"
                    onClick={() => goTo(step)}
                    disabled={!isOpenable}
                    aria-current={state === 'current' ? 'step' : undefined}
                  >
                    <span className={styles.progressBar} aria-hidden />
                    <span className={styles.progressLabel}>
                      <span className={styles.progressIndex}>{i + 1}</span>
                      {STEP_META[step].short}
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className={styles.topLinks}>
            <Link href={ROUTES.founder} className={styles.help}>
              Talk to the founder
            </Link>
            <Link href={ROUTES.products} className={styles.exit} aria-label="Exit setup">
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M3 3l10 10M13 3L3 13" fill="none" stroke="currentColor" strokeWidth="1.8" />
              </svg>
            </Link>
          </div>
        </div>
      </header>

      <main id="main" className={`container ${styles.layout}`} data-ready={isReady || undefined}>
        {!isReady ? null : (
          <>
            <form className={styles.main} onSubmit={submit} noValidate>
              <div className={styles.step} key={view}>
                <p className={styles.count}>
                  Step {stepIndex + 1} of {STEP_IDS.length}
                </p>
                <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
                  {meta.title}
                </h1>
                <p className={styles.lead}>{meta.lead}</p>

                <div className={styles.body}>
                  {view === 'stack' ? <StackStep answers={answers} update={update} /> : null}
                  {view === 'business' ? <BusinessStep answers={answers} update={update} /> : null}
                  {view === 'shape' ? <ShapeStep answers={answers} update={update} /> : null}
                  {view === 'launch' ? <LaunchStep answers={answers} update={update} /> : null}
                  {view === 'account' ? (
                    <AccountStep
                      account={account}
                      errors={errors}
                      onChange={(patch) => {
                        setAccount((current) => ({ ...current, ...patch }));
                        setErrors((current) =>
                          Object.fromEntries(Object.entries(current).filter(([field]) => !(field in patch))),
                        );
                      }}
                    />
                  ) : null}
                </div>
              </div>

              <div className={styles.nav}>
                {stepIndex > 0 ? (
                  <button type="button" className="btn btn-ghost" onClick={back}>
                    <span aria-hidden>←</span> Back
                  </button>
                ) : (
                  <Link href={ROUTES.products} className="btn btn-ghost">
                    Compare products
                  </Link>
                )}
                <button
                  type="submit"
                  className="btn btn-primary btn-lg"
                  aria-disabled={!canContinue || isLeaving || undefined}
                  aria-describedby="wizard-blocked"
                  data-testid="wizard-submit"
                >
                  {view !== 'account' ? 'Continue' : isLeaving ? 'Opening sign-up…' : 'Create my account'}{' '}
                  {isLeaving ? null : (
                    <span className="btn-arrow" aria-hidden>
                      →
                    </span>
                  )}
                </button>
              </div>
              <p id="wizard-blocked" className={styles.blocked} role="status">
                {canContinue
                  ? view === 'account'
                    ? TRIAL_LINE
                    : ''
                  : view === 'stack'
                    ? 'Pick at least one app to continue.'
                    : 'Choose your kind of business to continue.'}
              </p>
            </form>

            <WizardSummary answers={answers} estimate={estimate} />
          </>
        )}
      </main>
    </div>
  );
}
