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
  splitOf,
  totalOf,
  type ProfitViewId,
} from './pulse-visual-data';
import { JobName, SplitBar } from './pulse-visual-parts';
import styles from './pulse-visuals.module.css';

/**
 * The Profit page: the same month on four of its eight tabs, Jobs, Clients, Job types and Extra services.
 * Every tab adds up to the same total. The Company row under the table opens the walk from profit on jobs
 * to company profit (SPEC 6, /profit). The product also has tabs for sites, months, weeks and days.
 */
const MONTH_SPLIT = splitOf(MONTH.moneyIn, MONTH.moneyOut);

export function ProfitExplorer() {
  const [tab, setTab] = useState<ProfitViewId>('job');
  const [hasSwitched, setHasSwitched] = useState(false);
  const [isBridgeOpen, setIsBridgeOpen] = useState(false);
  const panelId = useId();
  const bridgeId = useId();

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

      <SplitBar out={MONTH_SPLIT.out} profit={MONTH_SPLIT.profit} what="profit on jobs" />

      <div className={`${mock.tabs} ${styles.profitTabs}`} role="group" aria-label="Show profit by">
        {PROFIT_VIEWS.map((item) => (
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
            {item.tab}
          </button>
        ))}
      </div>

      <div id={panelId} className={hasSwitched ? styles.profitPanel : undefined} key={tab}>
        <ProfitTable viewId={tab} />
      </div>
      <p className={styles.rankKey}>
        <span data-part="profit">Bar length is profit, against the best row</span>
        <span data-part="loss">A striped red bar is a loss</span>
      </p>

      <div className={styles.companyRow}>
        <button
          type="button"
          className={styles.companyToggle}
          aria-expanded={isBridgeOpen}
          aria-controls={bridgeId}
          onClick={() => setIsBridgeOpen((open) => !open)}
        >
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden>
            <path d="M4 2l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.6" />
          </svg>
          Company
        </button>
        <span className={styles.strong}>{money(COMPANY_PROFIT)}</span>
      </div>
      <div id={bridgeId} className={styles.profitPanel} hidden={!isBridgeOpen}>
        <CompanyBridge />
      </div>

      <p className={mock.caption}>
        {isBridgeOpen
          ? 'Job profit and company profit are two numbers. Pulse shows each step from one to the other.'
          : 'Every tab adds up to the same total. Open the Company row to see what the company made.'}
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
            Revenue
          </th>
          <th scope="col" className={styles.wideOnly}>
            Cost
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
