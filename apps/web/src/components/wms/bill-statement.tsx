'use client';

import { useState } from 'react';
import mock from '../mock/mock.module.css';
import styles from './wms-visuals.module.css';

interface BillLine {
  readonly charge: string;
  readonly basis: string;
  readonly cents: number;
}

/** Illustrative monthly bill for one 3PL client. */
const LINES: readonly BillLine[] = [
  { charge: 'Storage', basis: '1,860 pallet-days · daily rate', cents: 139500 },
  { charge: 'Receiving', basis: '14 POs · per pallet', cents: 42000 },
  { charge: 'Pick and pack', basis: '2,140 orders · graduated tiers', cents: 481500 },
  { charge: 'Work orders', basis: '120 kits built', cents: 30000 },
  { charge: 'VAS operations', basis: 'Relabeling · 6.5 hours', cents: 29250 },
  { charge: 'Returns', basis: '38 RMAs processed', cents: 13300 },
  { charge: 'Account fee', basis: 'Recurring · monthly minimum met', cents: 25000 },
];
const TOTAL_CENTS = LINES.reduce((sum, line) => sum + line.cents, 0);
const MONEY = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });

/** 3PL billing illustration: a client bill built from the month's activity, waiting on approval. */
export function BillStatement() {
  const [isApproved, setIsApproved] = useState(false);

  return (
    <div className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Harbor &amp; Pine</div>
          <div className={mock.sub}>Billing period Oct 1 to Oct 31 · sample data</div>
        </div>
        <span
          className={mock.pill}
          style={
            {
              '--tone-subtle': isApproved ? 'var(--label-green-subtle)' : 'var(--label-orange-subtle)',
              '--tone-text': isApproved ? 'var(--label-green-text)' : 'var(--label-orange-text)',
            } as React.CSSProperties
          }
          aria-live="polite"
        >
          {isApproved ? 'Approved' : 'Awaiting approval'}
        </span>
      </div>

      <ul className={mock.rows}>
        {LINES.map((line) => (
          <li key={line.charge} className={`${mock.row} ${styles.billRow}`}>
            <span>
              <span className={styles.billCharge}>{line.charge}</span>
              <span className={styles.billBasis}>{line.basis}</span>
            </span>
            <span className={styles.billAmount}>{MONEY.format(line.cents / 100)}</span>
          </li>
        ))}
      </ul>

      <div className={styles.billTotal}>
        <div>
          <div className={mock.sub}>Bill total</div>
          <div className={`numeral ${styles.billSum}`}>{MONEY.format(TOTAL_CENTS / 100)}</div>
        </div>
        <button
          type="button"
          className={mock.smallBtn}
          data-primary={isApproved ? undefined : true}
          onClick={() => setIsApproved((approved) => !approved)}
        >
          {isApproved ? 'Reopen' : 'Approve bill'}
        </button>
      </div>
    </div>
  );
}
