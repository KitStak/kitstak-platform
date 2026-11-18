'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PRICING, formatUsd, isBundle, percentLabel, quote } from '@/lib/pricing';
import type { Billing } from '@/lib/pricing';
import { wizardHref } from '@/lib/stak';
import { FULL_STACK, PRODUCT_IDS, ROUTES, toggleProduct } from '../site-links';
import type { ProductId, Stack } from '../site-links';
import { BillingToggle, QuoteSummary, StakVisual, Stepper } from './stak-parts';
import styles from './bundle-calculator.module.css';

const BLURB: Readonly<Record<ProductId, string>> = {
  crm: 'Pipelines, boards and automations',
  wms: 'Receiving, inventory and shipping',
  projects: 'Tasks, timelines and workload',
  pulse: 'Profit by job, client and service',
};

/** How each per-user product reads in a sentence. The WMS is priced per warehouse. */
const PER_USER_NAME: Readonly<Record<Exclude<ProductId, 'wms'>, string>> = {
  crm: 'the CRM',
  projects: 'Projects',
  pulse: 'Pulse',
};

function joinNames(names: readonly string[]): string {
  return names.length <= 2 ? names.join(' and ') : `${names.slice(0, -1).join(', ')} and ${names.at(-1)}`;
}

/** Price a stack: switch products on, set the size, and carry the result into the wizard. */
export function BundleCalculator() {
  const [stack, setStack] = useState<Stack>(FULL_STACK);
  const [seats, setSeats] = useState(10);
  const [warehouses, setWarehouses] = useState(1);
  const [billing, setBilling] = useState<Billing>('annual');

  const toggle = (product: ProductId) => {
    const next = toggleProduct(stack, product);
    // At least one product stays on.
    if (next.length > 0) setStack(next);
  };

  const result = quote({ stack, seats, warehouses, billing });
  const bundled = isBundle(stack);
  const perUser = stack.filter((id) => id !== 'wms').map((id) => PER_USER_NAME[id]);

  return (
    <div className={styles.calc}>
      <div className={styles.controls}>
        <fieldset className={styles.field}>
          <legend>1. Choose your products</legend>
          <div className={styles.switches}>
            {PRODUCT_IDS.map((id) => {
              const price = PRICING[id];
              const isOn = stack.includes(id);
              return (
                <button
                  key={id}
                  type="button"
                  role="switch"
                  aria-checked={isOn}
                  aria-disabled={(isOn && stack.length === 1) || undefined}
                  className={styles.switch}
                  data-product={id}
                  onClick={() => toggle(id)}
                >
                  <span className={styles.slab} aria-hidden />
                  <span>
                    <span className={styles.switchName}>{price.name}</span>
                    <span className={styles.switchBlurb}>{BLURB[id]}</span>
                  </span>
                  <span className={styles.switchPrice}>
                    {formatUsd(price.monthlyCents)}
                    <span>per {price.unit}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className={styles.hint} data-on={bundled || undefined}>
            {bundled
              ? `Bundle applied: ${percentLabel(PRICING.bundleDiscount)} off all ${stack.length} products.`
              : `Switch on a second product to take ${percentLabel(PRICING.bundleDiscount)} off each. One product always stays on.`}
          </p>
        </fieldset>

        <fieldset className={styles.field}>
          <legend>2. Size it</legend>
          <div className={styles.sizes}>
            <div className={styles.size} data-off={perUser.length === 0 || undefined} inert={perUser.length === 0}>
              <span>
                <span className={styles.sizeName}>Users</span>
                <span className={styles.sizeNote}>
                  {perUser.length > 0 ? `People who sign in to ${joinNames(perUser)}` : 'For the CRM, Projects and Pulse'}
                </span>
              </span>
              <Stepper label="Users" value={seats} max={PRICING.crm.max} onChange={setSeats} />
            </div>
            <div className={styles.size} data-off={!stack.includes('wms') || undefined} inert={!stack.includes('wms')}>
              <span>
                <span className={styles.sizeName}>Warehouses</span>
                <span className={styles.sizeNote}>Buildings you run stock in</span>
              </span>
              <Stepper label="Warehouses" value={warehouses} max={PRICING.wms.max} onChange={setWarehouses} />
            </div>
          </div>
        </fieldset>

        <fieldset className={styles.field}>
          <legend>3. Pick how to pay</legend>
          <BillingToggle value={billing} onChange={setBilling} />
        </fieldset>
      </div>

      <div className={styles.result}>
        <StakVisual stack={stack} />
        <div className={styles.quote}>
          <QuoteSummary quote={result} billing={billing} />
        </div>
        <Link href={wizardHref({ stack, seats, warehouses, billing })} className="btn btn-primary btn-lg btn-block">
          Set up this Stak <span className="btn-arrow" aria-hidden>→</span>
        </Link>
        <Link href={ROUTES.founder} className={styles.talk}>
          More than a few warehouses? Talk to the founder
        </Link>
      </div>
    </div>
  );
}
