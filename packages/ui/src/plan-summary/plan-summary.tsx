/**
 * The "Plan and payment" row for an app's settings page (docs/billing/SPEC.md section 9.5): the
 * plan badge, the next charge line, seats or warehouses in use, and one link to billing in the
 * Portal. The words come from `planSummaryFor` (./model), so every app says the same thing.
 *
 * No hooks and no browser APIs, so it works as a server component. Styling uses tokens.css custom
 * properties only (see plan-summary.css).
 */
import * as React from 'react';
import { APP_SWITCHER_BADGE_LABELS } from '../app-switcher/labels';
import type { PlanSummaryView } from './model';
import './plan-summary.css';

export interface PlanSummaryCardProps {
  readonly summary: PlanSummaryView;
  /** Heading. Default "Plan and payment". The WMS calls this area "Plan". */
  readonly title?: string;
  /** Heading level for the title. Default 2. */
  readonly headingLevel?: 2 | 3;
  readonly className?: string;
}

function ArrowIcon() {
  return (
    <svg aria-hidden width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 3.5h6.5V10M12.5 3.5 4 12" />
    </svg>
  );
}

export function PlanSummaryCard({ summary, title = 'Plan and payment', headingLevel = 2, className }: PlanSummaryCardProps): React.JSX.Element {
  const Heading = headingLevel === 3 ? 'h3' : 'h2';
  return (
    <section data-testid="plan-summary" className={className ? `ks-plansummary ${className}` : 'ks-plansummary'}>
      <div className="ks-plansummary-main">
        <div className="ks-plansummary-head">
          <Heading className="ks-plansummary-title">{title}</Heading>
          <span className="ks-plansummary-badge" data-badge={summary.badge} data-testid="plan-summary-badge">
            {APP_SWITCHER_BADGE_LABELS[summary.badge]}
          </span>
        </div>
        <p className="ks-plansummary-line" data-testid="plan-summary-line">
          {summary.line}
        </p>
        {summary.facts.length > 0 ? (
          <ul className="ks-plansummary-facts">
            {summary.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        ) : null}
      </div>
      {summary.action || summary.extra ? (
        <div className="ks-plansummary-actions">
          {summary.action ? (
            <a href={summary.action.href} data-testid="plan-summary-action" className="ks-plansummary-button">
              {summary.action.label}
              <ArrowIcon />
            </a>
          ) : null}
          {summary.extra ? (
            <a href={summary.extra.href} data-testid="plan-summary-extra" className="ks-plansummary-link">
              {summary.extra.label}
            </a>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
