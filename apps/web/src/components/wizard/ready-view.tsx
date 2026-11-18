'use client';

import Link from 'next/link';
import type { Quote } from '@/lib/pricing';
import { handoffUrl, setupPlan } from '@/lib/stak';
import type { AccountDraft, StakAnswers } from '@/lib/stak';
import { ROUTES } from '../site-links';
import { QuoteSummary, StakVisual } from '../stak/stak-parts';
import styles from './wizard.module.css';

interface ReadyViewProps {
  readonly answers: StakAnswers;
  readonly account: AccountDraft;
  readonly estimate: Quote | null;
  readonly headingRef: React.RefObject<HTMLHeadingElement | null>;
  readonly onEdit: () => void;
}

/** After the last step: the setup plan built from the answers, and the hand-off to sign-up. */
export function ReadyView({ answers, account, estimate, headingRef, onEdit }: ReadyViewProps) {
  const plan = setupPlan(answers);
  const firstName = account.name.trim().split(/\s+/)[0] ?? '';
  const company = account.company.trim();
  const remaining = plan.filter((step) => !step.isDone).length;

  return (
    <div className={styles.ready}>
      <div className={styles.readyMain}>
        <p className={styles.count}>Setup complete</p>
        <h1 ref={headingRef} tabIndex={-1} className={styles.title}>
          {firstName ? `${firstName}, your Stak is ready to build.` : 'Your Stak is ready to build.'}
        </h1>
        <p className={styles.lead}>
          Here is the plan for {company || 'your organization'}: {remaining} steps, in the order that fits your kind of
          business. Create your sign-in to start on it.
        </p>

        <ol className={styles.plan}>
          {plan.map((step, i) => (
            <li key={step.key} data-done={step.isDone || undefined} style={{ '--i': i } as React.CSSProperties}>
              <span className={styles.planMark} aria-hidden>
                {step.isDone ? (
                  <svg viewBox="0 0 16 16" width="14" height="14">
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2.4" />
                  </svg>
                ) : (
                  i + 1
                )}
              </span>
              <span>
                <span className={styles.planTitle}>
                  {step.isDone ? <span className="visually-hidden">Done: </span> : null}
                  {step.title}
                </span>
                <span className={styles.tileNote}>{step.note}</span>
              </span>
              <span className={styles.planApp}>{step.app}</span>
            </li>
          ))}
        </ol>

        <div className={styles.readyActions}>
          <a href={handoffUrl(answers)} className="btn btn-primary btn-lg">
            Create your sign-in <span className="btn-arrow" aria-hidden>→</span>
          </a>
          <Link href={ROUTES.founder} className="btn btn-ghost btn-lg">
            {answers.guided ? 'Book your guided setup' : 'Talk to the founder'}
          </Link>
        </div>
        <p className={styles.notice}>
          Your setup answers are saved in this browser. Your name and email have not been sent anywhere; you will confirm
          them when you create your sign-in.
        </p>
        <button type="button" className={styles.edit} onClick={onEdit}>
          Change my answers
        </button>
      </div>

      <aside className={styles.summary} data-static aria-label="Your Stak">
        <p className={styles.summaryTitle}>Your Stak</p>
        <StakVisual stack={answers.products} extras={answers.guided ? ['Guided setup'] : []} />
        {estimate ? (
          <div className={styles.estimate}>
            <QuoteSummary quote={estimate} billing={answers.billing} seats={answers.seats} />
          </div>
        ) : null}
      </aside>
    </div>
  );
}
