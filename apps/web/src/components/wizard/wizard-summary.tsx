'use client';

import type { Quote } from '@/lib/pricing';
import { formatUsd } from '@/lib/pricing';
import { BUSINESS_TYPES, START_MODES, TEAM_SIZES } from '@/lib/stak';
import type { StakAnswers } from '@/lib/stak';
import { QuoteSummary, StakVisual } from '../stak/stak-parts';
import styles from './wizard.module.css';

interface WizardSummaryProps {
  readonly answers: StakAnswers;
  readonly estimate: Quote | null;
}

const SHORT_NAME = { crm: 'CRM', wms: 'WMS', projects: 'Projects', pulse: 'Pulse' } as const;

function stackName(products: StakAnswers['products']): string {
  if (products.length === 0) return 'Nothing yet';
  if (products.length === 1) return `KitStak ${SHORT_NAME[products[0]!]}`;
  const names = products.map((p) => SHORT_NAME[p]);
  return `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

function labelOf<T extends string>(options: readonly { value: T; label: string }[], value: T | null): string | null {
  return options.find((option) => option.value === value)?.label ?? null;
}

/** The answers so far, as a short list of facts. */
export function summaryFacts(answers: StakAnswers): readonly { readonly label: string; readonly value: string }[] {
  const business = labelOf(BUSINESS_TYPES, answers.businessType);
  return [
    ...(business ? [{ label: 'Business', value: business }] : []),
    ...(answers.businessType ? [{ label: 'Team', value: labelOf(TEAM_SIZES, answers.teamSize) ?? '' }] : []),
    ...(answers.products.length > 0 ? [{ label: 'Start', value: labelOf(START_MODES, answers.startMode) ?? '' }] : []),
  ];
}

function SummaryBody({ answers, estimate }: WizardSummaryProps) {
  const facts = summaryFacts(answers);
  return (
    <>
      <StakVisual stack={answers.products} extras={answers.guided ? ['Guided setup'] : []} />
      {facts.length > 0 ? (
        <dl className={styles.facts}>
          {facts.map((fact) => (
            <div key={fact.label}>
              <dt>{fact.label}</dt>
              <dd>{fact.value}</dd>
            </div>
          ))}
        </dl>
      ) : null}
      {estimate ? (
        <div className={styles.estimate}>
          <QuoteSummary quote={estimate} billing={answers.billing} seats={answers.seats} />
        </div>
      ) : (
        <p className={styles.empty}>Choose a product and your stack builds here.</p>
      )}
    </>
  );
}

/** "Your Stak": a sticky panel on wide screens, a collapsible strip on small ones. */
export function WizardSummary({ answers, estimate }: WizardSummaryProps) {
  const headline = stackName(answers.products);
  return (
    <>
      <aside className={styles.summary} aria-label="Your Stak">
        <p className={styles.summaryTitle}>Your Stak</p>
        <SummaryBody answers={answers} estimate={estimate} />
      </aside>

      <details className={styles.strip}>
        <summary>
          <span>
            <span className={styles.stripLabel}>Your Stak</span>
            <span className={styles.stripStack}>{headline}</span>
          </span>
          <span className={styles.stripPrice}>
            {estimate ? `${formatUsd(estimate.monthlyCents)}/mo` : ''}
            <svg viewBox="0 0 10 6" width="10" height="6" aria-hidden>
              <path d="M1 1l4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.6" />
            </svg>
          </span>
        </summary>
        <div className={styles.stripBody}>
          <SummaryBody answers={answers} estimate={estimate} />
        </div>
      </details>
    </>
  );
}
