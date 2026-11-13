'use client';

import Link from 'next/link';
import { useState } from 'react';
import { PRICING, formatUsd, percentLabel, quote } from '@/lib/pricing';
import type { Billing, ProductId } from '@/lib/pricing';
import { wizardHref } from '@/lib/stak';
import { ROUTES } from '../site-links';
import type { StackChoice } from '../site-links';
import { BillingToggle, QuoteSummary, StakVisual, Stepper } from './stak-parts';
import styles from './bundle-calculator.module.css';

const PRODUCTS: readonly { readonly id: ProductId; readonly blurb: string }[] = [
  { id: 'crm', blurb: 'Pipelines, boards and automations' },
  { id: 'wms', blurb: 'Receiving, inventory and shipping' },
];

/** Price a stack: switch products on, set the size, and carry the result into the wizard. */
export function BundleCalculator() {
  const [enabled, setEnabled] = useState<Readonly<Record<ProductId, boolean>>>({ crm: true, wms: true });
  const [seats, setSeats] = useState(10);
  const [warehouses, setWarehouses] = useState(1);
  const [billing, setBilling] = useState<Billing>('annual');

  const toggle = (product: ProductId) => {
    const other: ProductId = product === 'crm' ? 'wms' : 'crm';
    // At least one product stays on.
    if (enabled[product] && !enabled[other]) return;
    setEnabled({ ...enabled, [product]: !enabled[product] });
  };

  const stack: StackChoice = enabled.crm && enabled.wms ? 'both' : enabled.crm ? 'crm' : 'wms';
  const result = quote({ stack, seats, warehouses, billing });

  return (
    <div className={styles.calc}>
      <div className={styles.controls}>
        <fieldset className={styles.field}>
          <legend>1. Choose your products</legend>
          <div className={styles.switches}>
            {PRODUCTS.map((product) => {
              const price = PRICING[product.id];
              return (
                <button
                  key={product.id}
                  type="button"
                  role="switch"
                  aria-checked={enabled[product.id]}
                  aria-disabled={(enabled[product.id] && stack !== 'both') || undefined}
                  className={styles.switch}
                  data-product={product.id}
                  onClick={() => toggle(product.id)}
                >
                  <span className={styles.slab} aria-hidden />
                  <span>
                    <span className={styles.switchName}>{price.name}</span>
                    <span className={styles.switchBlurb}>{product.blurb}</span>
                  </span>
                  <span className={styles.switchPrice}>
                    {formatUsd(price.monthlyCents)}
                    <span>per {price.unit}</span>
                  </span>
                </button>
              );
            })}
          </div>
          <p className={styles.hint} data-on={stack === 'both' || undefined}>
            {stack === 'both'
              ? `Bundle applied: ${percentLabel(PRICING.bundleDiscount)} off both products.`
              : `Switch both on to take ${percentLabel(PRICING.bundleDiscount)} off each. One product always stays on.`}
          </p>
        </fieldset>

        <fieldset className={styles.field}>
          <legend>2. Size it</legend>
          <div className={styles.sizes}>
            <div className={styles.size} data-off={!enabled.crm || undefined} inert={!enabled.crm}>
              <span>
                <span className={styles.sizeName}>CRM users</span>
                <span className={styles.sizeNote}>People who sign in to the CRM</span>
              </span>
              <Stepper label="CRM users" value={seats} max={PRICING.crm.max} onChange={setSeats} />
            </div>
            <div className={styles.size} data-off={!enabled.wms || undefined} inert={!enabled.wms}>
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
          <QuoteSummary quote={result} billing={billing} isBundle={stack === 'both'} />
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
