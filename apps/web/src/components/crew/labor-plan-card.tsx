import { LABOR_PLAN_EXAMPLE, LABOR_PLAN_LINES } from './crew-content';
import styles from './labor-plan-card.module.css';

/**
 * The labor plan from docs/crew/REFERENCE.md 5.4, worked for one made-up day. A coded example, not
 * a screenshot, so it can stay when the real Crew screens arrive.
 */
export function LaborPlanCard() {
  const last = LABOR_PLAN_EXAMPLE.length - 1;
  return (
    <figure className={styles.card}>
      <pre className={styles.formula} aria-label="The labor plan formula">
        {LABOR_PLAN_LINES.join('\n')}
      </pre>
      <dl className={styles.rows}>
        {LABOR_PLAN_EXAMPLE.map((row, i) => (
          <div key={row.label} data-gap={i === last || undefined}>
            <dt>{row.label}</dt>
            <dd className="numeral">{row.value}</dd>
          </div>
        ))}
      </dl>
      <figcaption>Tuesday, worked out on Friday. A made-up example.</figcaption>
    </figure>
  );
}
