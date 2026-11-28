'use client';

import { useState } from 'react';
import { FULL_STACK, PRODUCT_IDS, availabilityLabel, toggleProduct } from '../site-links';
import type { ProductId, SiteProductId, Stack } from '../site-links';
import { planFor } from './licensing-plans';
import styles from './licensing-section.module.css';

const NAME: Readonly<Record<SiteProductId, string>> = {
  crm: 'KitStak CRM',
  wms: 'KitStak WMS',
  projects: 'KitStak Projects',
  pulse: 'KitStak Pulse',
  crew: 'KitStak Crew',
  ledger: 'KitStak Ledger',
};

export function LicensingSection() {
  const [stack, setStack] = useState<Stack>(FULL_STACK);

  const toggle = (product: ProductId) => {
    const next = toggleProduct(stack, product);
    // At least one product stays on.
    if (next.length > 0) setStack(next);
  };

  const key = stack.join('-');
  const plan = planFor(stack);

  return (
    <section id="licensing" className={`section ${styles.section}`} aria-labelledby="licensing-heading">
      <div className={`container ${styles.grid}`}>
        <div>
          <h2 id="licensing-heading" className="h2" data-reveal>
            Run all four. Or one.
          </h2>
          <p className="lead" data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
            Each app is licensed on its own and built to work with the others. Turn them on to see what you get.
          </p>

          <div className={styles.switches} data-reveal>
            {PRODUCT_IDS.map((p) => (
              <button
                key={p}
                type="button"
                role="switch"
                aria-checked={stack.includes(p)}
                className={styles.switch}
                data-product={p}
                onClick={() => toggle(p)}
              >
                <span className={styles.slab} aria-hidden />
                <span className={styles.switchLabel}>
                  {NAME[p]}
                  {availabilityLabel(p) ? <span className={styles.soon}>{availabilityLabel(p)}</span> : null}
                </span>
                <span className={styles.state}>{stack.includes(p) ? 'On' : 'Off'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.card} data-reveal aria-live="polite">
          <div className={styles.stack} data-key={key} aria-hidden>
            {PRODUCT_IDS.map((p) => (
              <span key={p} data-product={p} data-on={stack.includes(p) || undefined} />
            ))}
          </div>
          <h3 className={styles.planTitle} key={`t-${key}`}>
            {plan.title}
          </h3>
          <p className={styles.planBody} key={`b-${key}`}>
            {plan.body}
          </p>
          <ul className={styles.included} key={`l-${key}`}>
            {plan.included.map((item, i) => (
              <li key={item} style={{ '--i': i } as React.CSSProperties}>
                <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                  <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
                </svg>
                {item}
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
