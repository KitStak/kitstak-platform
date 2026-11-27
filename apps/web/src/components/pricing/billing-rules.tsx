import { BILLING_RULES } from './pricing-content';
import styles from './pricing.module.css';

/** "How billing works": the trial, the one rule for changes with a worked example, cancel, and your data. */
export function BillingRules() {
  return (
    <section id="how-billing-works" className={`section ${styles.rulesBand}`} aria-labelledby="rules-heading">
      <div className="container">
        <h2 id="rules-heading" className="h2" data-reveal>
          How billing works.
        </h2>
        <p className="lead" data-reveal style={{ '--reveal-delay': 100 } as React.CSSProperties}>
          Four rules. No surprises on your bill.
        </p>
        <ol className={styles.rules}>
          {BILLING_RULES.map((rule, i) => (
            <li key={rule.title} data-reveal style={{ '--reveal-delay': 80 * i } as React.CSSProperties}>
              <span className={`numeral ${styles.ruleIndex}`} aria-hidden>
                {i + 1}
              </span>
              <h3 className={styles.ruleTitle}>{rule.title}</h3>
              {rule.lines.map((line) => (
                <p key={line} className={styles.ruleLine}>
                  {line}
                </p>
              ))}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
