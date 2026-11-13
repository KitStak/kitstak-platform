'use client';

import { useState } from 'react';
import styles from './licensing-section.module.css';

type Product = 'crm' | 'wms';

interface Plan {
  readonly title: string;
  readonly body: string;
  readonly included: readonly string[];
}

const SHARED = ['One sign-in across apps', 'Shared customers and items', 'One admin portal and billing'];

const PLANS: Readonly<Record<'both' | Product, Plan>> = {
  both: {
    title: 'CRM and WMS',
    body: 'Sales and the warehouse work from the same records. A won deal can become an order without anyone retyping it.',
    included: [...SHARED, 'Deals flow into orders', 'Inventory visible on the account'],
  },
  crm: {
    title: 'CRM on its own',
    body: 'Run accounts, pipelines and follow-ups. Add the warehouse later and your customers are already there.',
    included: [...SHARED, 'Boards, automations, dashboards'],
  },
  wms: {
    title: 'WMS on its own',
    body: 'Run receiving, inventory, orders and shipping. Add the CRM later and your clients carry over.',
    included: [...SHARED, 'Locations, counts, packing, returns'],
  },
};

export function LicensingSection() {
  const [enabled, setEnabled] = useState<Readonly<Record<Product, boolean>>>({ crm: true, wms: true });

  const toggle = (product: Product) => {
    const other: Product = product === 'crm' ? 'wms' : 'crm';
    // At least one product stays on.
    if (enabled[product] && !enabled[other]) return;
    setEnabled({ ...enabled, [product]: !enabled[product] });
  };

  const key = enabled.crm && enabled.wms ? 'both' : enabled.crm ? 'crm' : 'wms';
  const plan = PLANS[key];

  return (
    <section id="licensing" className={`section ${styles.section}`} aria-labelledby="licensing-heading">
      <div className={`container ${styles.grid}`}>
        <div>
          <h2 id="licensing-heading" className="h2" data-reveal>
            Run both. Or one.
          </h2>
          <p className="lead" data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
            Each app is licensed on its own and built to work with the other. Turn them on to see what you get.
          </p>

          <div className={styles.switches} data-reveal>
            {(['crm', 'wms'] as const).map((p) => (
              <button
                key={p}
                type="button"
                role="switch"
                aria-checked={enabled[p]}
                className={styles.switch}
                data-product={p}
                onClick={() => toggle(p)}
              >
                <span className={styles.slab} aria-hidden />
                <span className={styles.switchLabel}>KitStak {p.toUpperCase()}</span>
                <span className={styles.state}>{enabled[p] ? 'On' : 'Off'}</span>
              </button>
            ))}
          </div>
        </div>

        <div className={styles.card} data-reveal aria-live="polite">
          <div className={styles.stack} data-key={key} aria-hidden>
            <span className={styles.stackTop} data-on={enabled.crm || undefined} />
            <span className={styles.stackBottom} data-on={enabled.wms || undefined} />
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
