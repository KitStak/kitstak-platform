import { PulseShot } from './pulse-shot';
import mock from '../mock/mock.module.css';
import { MATH_EXPLAIN, MATH_JOB, usd } from './pulse-content';
import styles from './pulse-section.module.css';
import { splitOf } from './pulse-visual-data';
import { SplitBar } from './pulse-visual-parts';

const AT_RISK_TONE = {
  '--tone-subtle': 'var(--label-orange-subtle)',
  '--tone-text': 'var(--label-orange-text)',
} as React.CSSProperties;

function sum(lines: readonly { readonly cents: number }[]): number {
  return lines.reduce((total, line) => total + line.cents, 0);
}

/**
 * The "show the math" moment: one open job as a sum the reader can check by hand. Revenue, the
 * four costs, profit, then the status that job would get. It is a coded worked example, labeled as
 * one, with the sample numbers from the Pulse spec; the totals are computed here, not typed.
 */
export function JobMathVisual() {
  const totalOut = sum(MATH_JOB.moneyOut);
  const profit = MATH_JOB.moneyIn.cents - totalOut;
  const margin = ((profit / MATH_JOB.moneyIn.cents) * 100).toFixed(1);
  const split = splitOf(MATH_JOB.moneyIn.cents, totalOut);

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
          {MATH_JOB.title}: revenue, cost and profit. A worked example with sample numbers.
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
      <SplitBar out={split.out} profit={split.profit} what="profit so far" />

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
          <strong>{MATH_JOB.reason}</strong> That is labor hours: {MATH_JOB.laborHours.actual} used where the
          plan for these units was {MATH_JOB.laborHours.plan}. At this pace the whole job ends with{' '}
          {usd(MATH_JOB.projectedProfitCents)} of profit. The budget for the whole job was{' '}
          {usd(MATH_JOB.budgetProfitCents)}.
        </p>
      </div>

      <p className={mock.caption}>{MATH_JOB.caption}</p>
    </div>
  );
}

/**
 * "How we got this". The slot shows the real panel from the Profit page: company profit worked out
 * step by step from profit on jobs, with the lines Pulse adds when a number is not complete.
 */
export function ExplainVisual() {
  return (
    <PulseShot slot="proof">
      <ExplainMock />
    </PulseShot>
  );
}

/**
 * The coded stand in, shown only if the slot is switched back to not ready. "How we got this" for the
 * labor cost of the worked job above: the formula in words, the same formula with the figures, and a
 * note that the rows behind it are one step away. Then the lines Pulse adds when a number is not
 * complete. The figures are computed from MATH_JOB, so this panel cannot drift from the worked sum.
 */
function ExplainMock() {
  const { labor } = MATH_EXPLAIN;
  const laborCents = labor.hours * labor.rateCents;

  const items = [
    {
      label: labor.label,
      value: usd(laborCents),
      words: labor.words,
      figures: `${usd(laborCents)} = ${labor.hours.toFixed(1)} labor hours × ${usd(labor.rateCents)} an hour`,
    },
  ];

  return (
    <div className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>{MATH_EXPLAIN.title}</div>
          <div className={mock.sub}>{MATH_EXPLAIN.sub}</div>
        </div>
      </div>

      <ul className={styles.explain}>
        {items.map((item) => (
          <li key={item.label}>
            <div className={styles.explainHead}>
              <span className={styles.lineName}>{item.label}</span>
              <span className={`numeral ${styles.explainValue}`}>{item.value}</span>
            </div>
            <dl className={styles.explainSteps}>
              <div>
                <dt>{MATH_EXPLAIN.wordsLabel}</dt>
                <dd>{item.words}</dd>
              </div>
              <div>
                <dt>{MATH_EXPLAIN.figuresLabel}</dt>
                <dd className={styles.explainFigures}>{item.figures}</dd>
              </div>
            </dl>
            <p className={styles.explainRows}>{MATH_EXPLAIN.rowsLabel}</p>
          </li>
        ))}
      </ul>

      <div className={styles.gaps}>
        <p>{MATH_EXPLAIN.gapsLabel}</p>
        <ul>
          {MATH_EXPLAIN.gaps.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      </div>
    </div>
  );
}
