'use client';

import { useId, useState } from 'react';
import mock from '../mock/mock.module.css';
import {
  BRIDGE_STEPS,
  COMPANY_PROFIT,
  MONTH,
  PERIOD,
  PROFIT_VIEWS,
  marginOf,
  money,
  percent,
  totalOf,
  type ProfitViewId,
} from './pulse-visual-data';
import { JobName } from './pulse-visual-parts';
import styles from './pulse-visuals.module.css';

type TabId = ProfitViewId | 'company';

const TABS: readonly { readonly id: TabId; readonly label: string }[] = [
  ...PROFIT_VIEWS.map((view) => ({ id: view.id, label: view.tab })),
  { id: 'company', label: 'Company' },
];

/**
 * The Profit page: the same month cut by job, client, job type and extra service, then the walk from
 * profit on jobs to company profit. Every tab adds up to the same total.
 */
export function ProfitExplorer() {
  const [tab, setTab] = useState<TabId>('job');
  const [hasSwitched, setHasSwitched] = useState(false);
  const panelId = useId();
  const view = PROFIT_VIEWS.find((candidate) => candidate.id === tab);

  return (
    <div className={`${mock.panel} ${styles.frame}`} data-lifted>
      <div className={`${mock.head} ${styles.head}`}>
        <div>
          <div className={mock.title}>Profit</div>
          <div className={mock.sub}>{PERIOD} · sample data</div>
        </div>
        <div className={styles.headFigure}>
          <span className={mock.sub}>Profit on jobs</span>
          <span className={`numeral ${styles.headValue}`}>{money(MONTH.profit)}</span>
        </div>
      </div>

      <div className={`${mock.tabs} ${styles.profitTabs}`} role="group" aria-label="Show profit by">
        {TABS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={mock.tab}
            aria-pressed={item.id === tab}
            aria-controls={panelId}
            onClick={() => {
              setTab(item.id);
              setHasSwitched(true);
            }}
          >
            {item.label}
          </button>
        ))}
      </div>

      <div id={panelId} className={hasSwitched ? styles.profitPanel : undefined} key={tab}>
        {view ? <ProfitTable viewId={view.id} /> : <CompanyBridge />}
      </div>
      <p className={mock.caption}>
        {view
          ? 'Every tab adds up to the same total.'
          : 'Job profit and company profit are two numbers. Pulse shows the walk from one to the other.'}
      </p>
    </div>
  );
}

function ProfitTable({ viewId }: { readonly viewId: ProfitViewId }) {
  const view = PROFIT_VIEWS.find((candidate) => candidate.id === viewId)!;
  const total = totalOf(view.rows);
  const largest = Math.max(...view.rows.filter((row) => !row.isRest).map((row) => Math.abs(row.profit)));

  return (
    <table className={styles.table}>
      <caption className="visually-hidden">
        Profit by {view.heading.toLowerCase()} for {PERIOD}, best first. Sample data.
      </caption>
      <thead>
        <tr>
          <th scope="col">{view.heading}</th>
          <th scope="col" className={styles.wideOnly}>
            Money in
          </th>
          <th scope="col" className={styles.wideOnly}>
            Money out
          </th>
          <th scope="col">Profit</th>
          <th scope="col">Margin</th>
        </tr>
      </thead>
      <tbody>
        {view.rows.map((row) => (
          <tr key={row.name} data-rest={row.isRest} data-loss={row.profit < 0 || undefined}>
            <th scope="row">
              <JobName code={row.code} name={row.name} />
              {row.isRest ? null : (
                <span className={styles.rankTrack} aria-hidden>
                  <span style={{ '--share': Math.abs(row.profit) / largest } as React.CSSProperties} />
                </span>
              )}
            </th>
            <td className={styles.wideOnly}>{money(row.moneyIn)}</td>
            <td className={styles.wideOnly}>{money(row.moneyIn - row.profit)}</td>
            <td className={styles.strong}>
              {money(row.profit)}
              {row.profit < 0 ? <span className="visually-hidden"> (a loss)</span> : null}
            </td>
            <td>{percent(marginOf(row.profit, row.moneyIn))}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Total</th>
          <td className={styles.wideOnly}>{money(total.moneyIn)}</td>
          <td className={styles.wideOnly}>{money(total.moneyOut)}</td>
          <td className={styles.strong}>{money(total.profit)}</td>
          <td>{percent(total.margin)}</td>
        </tr>
      </tfoot>
    </table>
  );
}

function CompanyBridge() {
  return (
    <table className={`${styles.table} ${styles.bridge}`}>
      <caption className="visually-hidden">
        From profit on jobs to company profit for {PERIOD}. Sample data.
      </caption>
      <thead className="visually-hidden">
        <tr>
          <th scope="col">Line</th>
          <th scope="col">Amount</th>
        </tr>
      </thead>
      <tbody>
        <tr>
          <th scope="row">Profit on jobs</th>
          <td className={styles.strong}>{money(MONTH.profit)}</td>
        </tr>
        {BRIDGE_STEPS.map((step) => (
          <tr key={step.label}>
            <th scope="row" className={styles.bridgeStep}>
              {step.label}
            </th>
            <td>{money(step.amount)}</td>
          </tr>
        ))}
      </tbody>
      <tfoot>
        <tr>
          <th scope="row">Company profit</th>
          <td className={styles.strong}>{money(COMPANY_PROFIT)}</td>
        </tr>
      </tfoot>
    </table>
  );
}
