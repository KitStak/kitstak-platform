'use client';

import { useState } from 'react';
import mock from '../mock/mock.module.css';
import styles from './wms-visuals.module.css';

type ModeId = 'tote' | 'location' | 'order' | 'putwall';
type StrategyId = 'cheapest' | 'fastest' | 'in_time';

const MODES: readonly { readonly id: ModeId; readonly label: string; readonly note: string }[] = [
  { id: 'tote', label: 'Tote', note: 'Scan a tote and pack every order picked into it.' },
  { id: 'location', label: 'Location', note: 'Pack straight from a staging location.' },
  { id: 'order', label: 'Order', note: 'Scan an order and pack it on its own.' },
  { id: 'putwall', label: 'Putwall', note: 'Sort a batch into wall slots, then pack slot by slot.' },
];

const STRATEGIES: readonly { readonly id: StrategyId; readonly label: string }[] = [
  { id: 'cheapest', label: 'Cheapest' },
  { id: 'fastest', label: 'Fastest' },
  { id: 'in_time', label: 'Cheapest in time' },
];

interface Rate {
  readonly service: string;
  readonly days: number;
  readonly cents: number;
}

/** Illustrative rates. The deliver-by date for this sample order allows two days. */
const RATES: readonly Rate[] = [
  { service: 'USPS Ground Advantage', days: 4, cents: 842 },
  { service: 'UPS Ground', days: 3, cents: 913 },
  { service: 'FedEx 2Day', days: 2, cents: 1480 },
  { service: 'UPS Next Day Air', days: 1, cents: 3265 },
];
const DELIVER_WITHIN_DAYS = 2;

function pick(strategy: StrategyId): Rate {
  const byCost = [...RATES].sort((a, b) => a.cents - b.cents);
  if (strategy === 'cheapest') return byCost[0]!;
  if (strategy === 'fastest') return [...RATES].sort((a, b) => a.days - b.days)[0]!;
  return byCost.find((rate) => rate.days <= DELIVER_WITHIN_DAYS) ?? byCost[0]!;
}

const ITEMS = [
  { sku: 'KS-1042', name: 'Trail bottle, 24 oz', qty: 2 },
  { sku: 'KS-3150', name: 'Camp mug, enamel', qty: 1 },
  { sku: 'KS-5120', name: 'Gift box, large', qty: 1 },
] as const;

/** Packing station illustration: choose a packing mode and a rate-shopping rule. */
export function PackStation() {
  const [mode, setMode] = useState<ModeId>('putwall');
  const [strategy, setStrategy] = useState<StrategyId>('in_time');
  const chosen = pick(strategy);
  const modeNote = MODES.find((m) => m.id === mode)!.note;

  return (
    <div className={mock.panel}>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Packing Station 2</div>
          <div className={mock.sub}>SO-10482 · Northwind Supply · deliver in {DELIVER_WITHIN_DAYS} days</div>
        </div>
      </div>

      <div className={styles.packBlock}>
        <div className={styles.packLabel}>Pack by</div>
        <div className={mock.tabs} role="group" aria-label="Packing mode">
          {MODES.map((m) => (
            <button key={m.id} type="button" className={mock.tab} aria-pressed={m.id === mode} onClick={() => setMode(m.id)}>
              {m.label}
            </button>
          ))}
        </div>
        <p className={styles.modeNote} key={mode}>
          {modeNote}
        </p>
      </div>

      <ul className={`${mock.rows} ${styles.packItems}`}>
        {ITEMS.map((item) => (
          <li key={item.sku} className={mock.row}>
            <span className={styles.packItem}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
              </svg>
              <span className={mock.mono}>{item.sku}</span>
              <span className={styles.packName}>{item.name}</span>
            </span>
            <span className={mock.muted}>× {item.qty}</span>
          </li>
        ))}
      </ul>

      <div className={styles.packBlock}>
        <div className={styles.packLabel}>Rate shopping</div>
        <div className={mock.tabs} role="group" aria-label="Rate shopping rule">
          {STRATEGIES.map((s) => (
            <button
              key={s.id}
              type="button"
              className={mock.tab}
              aria-pressed={s.id === strategy}
              onClick={() => setStrategy(s.id)}
            >
              {s.label}
            </button>
          ))}
        </div>
        <p className="visually-hidden" role="status">
          Selected: {chosen.service}, ${(chosen.cents / 100).toFixed(2)}
        </p>
        <ul className={styles.rates}>
          {RATES.map((rate) => (
            <li key={rate.service} className={styles.rate} data-chosen={rate === chosen || undefined}>
              <span className={styles.rateService}>
                {rate.service}
                {rate === chosen ? <span className="visually-hidden"> (selected)</span> : null}
              </span>
              <span className={mock.muted}>{rate.days === 1 ? '1 day' : `${rate.days} days`}</span>
              <span className={styles.ratePrice}>${(rate.cents / 100).toFixed(2)}</span>
            </li>
          ))}
        </ul>
      </div>
      <p className={mock.caption}>Sample rates. Live rates come from your own carrier accounts.</p>
    </div>
  );
}
