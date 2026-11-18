import mock from '../mock/mock.module.css';
import { MATH_BRIDGE, MATH_JOB, usd } from './pulse-content';
import styles from './pulse-section.module.css';

const AT_RISK_TONE = {
  '--tone-subtle': 'var(--label-orange-subtle)',
  '--tone-text': 'var(--label-orange-text)',
} as React.CSSProperties;

function sum(lines: readonly { readonly cents: number }[]): number {
  return lines.reduce((total, line) => total + line.cents, 0);
}

/**
 * The "show the math" moment: one open job as a sum the reader can check by hand. Money in, the
 * four money out buckets, profit, then the status that job would get. Sample numbers from the
 * worked example in the Pulse spec; the totals are computed here, not typed.
 */
export function JobMathVisual() {
  const totalOut = sum(MATH_JOB.moneyOut);
  const profit = MATH_JOB.moneyIn.cents - totalOut;
  const margin = ((profit / MATH_JOB.moneyIn.cents) * 100).toFixed(1);

  return (
    <div className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>{MATH_JOB.title}</div>
          <div className={mock.sub}>{MATH_JOB.sub}</div>
        </div>
      </div>

      <table className={styles.ledger}>
        <caption className="visually-hidden">
          {MATH_JOB.title}: money in, money out and profit. Sample numbers.
        </caption>
        <thead className="visually-hidden">
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.lineIn}>
            <th scope="row">
              <span className={styles.lineName}>{MATH_JOB.moneyIn.label}</span>
              <span className={styles.lineDetail}>{MATH_JOB.moneyIn.detail}</span>
            </th>
            <td>{usd(MATH_JOB.moneyIn.cents)}</td>
          </tr>
          {MATH_JOB.moneyOut.map((line) => (
            <tr key={line.label}>
              <th scope="row">
                <span className={styles.lineName}>{line.label}</span>
                <span className={styles.lineDetail}>{line.detail}</span>
              </th>
              <td>{usd(line.cents)}</td>
            </tr>
          ))}
          <tr className={styles.lineSum}>
            <th scope="row">
              <span className={styles.lineName}>{MATH_JOB.totalOutLabel}</span>
              <span className={styles.lineDetail}>The four costs added up</span>
            </th>
            <td>{usd(totalOut)}</td>
          </tr>
        </tbody>
        <tfoot>
          <tr className={styles.lineTotal}>
            <th scope="row">
              <span className={styles.lineName}>{MATH_JOB.profitLabel}</span>
              <span className={styles.lineDetail}>
                {usd(MATH_JOB.moneyIn.cents)} less {usd(totalOut)}. {MATH_JOB.marginLabel} {margin}%
              </span>
            </th>
            <td className="numeral">{usd(profit)}</td>
          </tr>
        </tfoot>
      </table>

      <div className={styles.verdict}>
        <span className={mock.pill} style={AT_RISK_TONE}>
          <svg viewBox="0 0 12 12" width="12" height="12" aria-hidden className={styles.pillIcon}>
            <path
              d="M6 1.2 11 10.5H1Z"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.4"
              strokeLinejoin="round"
            />
            <path d="M6 4.6v2.8M6 8.7v.4" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
          </svg>
          {MATH_JOB.status}
        </span>
        <p>
          <strong>{MATH_JOB.reason}</strong> At this pace the job ends with{' '}
          {usd(MATH_JOB.projectedProfitCents)} of profit. The budget was {usd(MATH_JOB.budgetProfitCents)}.
        </p>
      </div>

      <p className={mock.caption}>{MATH_JOB.caption}</p>
    </div>
  );
}

/** The walk from "Profit on jobs" to company profit, line by line. Sample numbers from the spec. */
export function BridgeMathVisual() {
  const end = MATH_BRIDGE.start.cents + sum(MATH_BRIDGE.steps);

  return (
    <div className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>{MATH_BRIDGE.title}</div>
          <div className={mock.sub}>{MATH_BRIDGE.sub}</div>
        </div>
      </div>

      <table className={styles.ledger}>
        <caption className="visually-hidden">{MATH_BRIDGE.title}. Sample numbers.</caption>
        <thead className="visually-hidden">
          <tr>
            <th scope="col">Line</th>
            <th scope="col">Amount</th>
          </tr>
        </thead>
        <tbody>
          <tr className={styles.lineIn}>
            <th scope="row">
              <span className={styles.lineName}>{MATH_BRIDGE.start.label}</span>
              <span className={styles.lineDetail}>{MATH_BRIDGE.start.detail}</span>
            </th>
            <td>{usd(MATH_BRIDGE.start.cents, false)}</td>
          </tr>
          {MATH_BRIDGE.steps.map((line) => (
            <tr key={line.label}>
              <th scope="row">
                <span className={styles.lineName}>{line.label}</span>
                <span className={styles.lineDetail}>{line.detail}</span>
              </th>
              <td>{usd(line.cents, false)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className={styles.lineTotal}>
            <th scope="row">
              <span className={styles.lineName}>{MATH_BRIDGE.endLabel}</span>
              <span className={styles.lineDetail}>What the company made after all of it</span>
            </th>
            <td className="numeral">{usd(end, false)}</td>
          </tr>
        </tfoot>
      </table>

      <p className={mock.caption}>{MATH_BRIDGE.caption}</p>
    </div>
  );
}
