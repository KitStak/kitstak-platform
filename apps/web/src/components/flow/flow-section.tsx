'use client';

import { useState } from 'react';
import { SAMPLE_RECORDS } from './record-data';
import styles from './flow-section.module.css';

export function FlowSection() {
  const [active, setActive] = useState(0);
  const record = SAMPLE_RECORDS[active]!;

  return (
    <section id="flow" className="section" aria-labelledby="flow-heading">
      <div className="container">
        <div className={styles.intro}>
          <h2 id="flow-heading" className="h2" data-reveal>
            One record. Both sides.
          </h2>
          <p className="lead" data-reveal style={{ '--reveal-delay': 120 } as React.CSSProperties}>
            Customers, items and addresses live once, in a shared core. Sales sees the relationship, the warehouse sees
            the inventory, and nobody re-keys an order.
          </p>
        </div>

        <div className={styles.tabs} role="tablist" aria-label="Sample customers" data-reveal>
          {SAMPLE_RECORDS.map((r, i) => (
            <button
              key={r.name}
              role="tab"
              aria-selected={i === active}
              className={styles.tab}
              onClick={() => setActive(i)}
            >
              {r.name}
            </button>
          ))}
        </div>

        <div className={styles.board} role="tabpanel" aria-label={record.name} data-reveal>
          <div className={styles.colHead}>KitStak CRM</div>
          <div className={styles.colHeadCore}>Shared core</div>
          <div className={`${styles.colHead} ${styles.colHeadEnd}`}>KitStak WMS</div>

          {record.fields.map((field, i) => {
            const isShared = Boolean(field.crm && field.wms);
            return (
              <div
                key={`${active}-${field.label}`}
                className={styles.row}
                data-shared={isShared || undefined}
                style={{ '--i': i } as React.CSSProperties}
              >
                <Cell label={field.label} value={field.crm} side="crm" />
                <div className={styles.link} aria-hidden>
                  {isShared ? (
                    <>
                      <span className={styles.wire} />
                      <span className={styles.core}>{field.label}</span>
                      <span className={styles.wire} />
                    </>
                  ) : null}
                </div>
                <Cell label={field.label} value={field.wms} side="wms" />
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}

interface CellProps {
  readonly label: string;
  readonly value?: string;
  readonly side: 'crm' | 'wms';
}

function Cell({ label, value, side }: CellProps) {
  if (!value) return <div className={styles.empty} data-side={side} aria-hidden />;
  return (
    <div className={styles.cell} data-side={side}>
      <span className={styles.cellLabel}>{label}</span>
      <span className={styles.cellValue}>{value}</span>
    </div>
  );
}
