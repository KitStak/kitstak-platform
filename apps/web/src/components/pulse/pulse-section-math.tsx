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
 * The "show the math" moment: one open job as a sum the reader can check by hand. Money in, the
 * four money out buckets, profit, then the status that job would get. Sample numbers from the
 * worked example in the Pulse spec; the totals are computed here, not typed.
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
          <strong>{MATH_JOB.reason}</strong> At this pace the whole job ends with{' '}
          {usd(MATH_JOB.projectedProfitCents)} of profit. The budget for the whole job was{' '}
          {usd(MATH_JOB.budgetProfitCents)}.
        </p>
      </div>

      <p className={mock.caption}>{MATH_JOB.caption}</p>
    </div>
  );
}

/**
 * "How we got this" for two figures of the worked job above: the formula in words, the same formula
 * with the figures, and the way to the rows behind it. Then the lines Pulse adds when a number is not
 * complete. The figures are computed from MATH_JOB, so this panel cannot drift from the worked sum.
 */
export function ExplainVisual() {
  const totalOut = sum(MATH_JOB.moneyOut);
  const profit = MATH_JOB.moneyIn.cents - totalOut;
  const margin = `${((profit / MATH_JOB.moneyIn.cents) * 100).toFixed(1)}%`;
  const { labor } = MATH_EXPLAIN;
  const laborCents = labor.hours * labor.rateCents;

  const items = [
    {
      label: labor.label,
      value: usd(laborCents),
      words: labor.words,
      figures: `${usd(laborCents)} = ${labor.hours.toFixed(1)} labor hours x ${usd(labor.rateCents)} an hour`,
    },
    {
      label: MATH_EXPLAIN.margin.label,
      value: margin,
      words: MATH_EXPLAIN.margin.words,
      figures: `${margin} = ${usd(profit)} profit ÷ ${usd(MATH_JOB.moneyIn.cents)} money in`,
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
            <p className={styles.explainRows}>
              {MATH_EXPLAIN.rowsLabel}
              <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
                <path
                  d="M3 8h10M9 4l4 4-4 4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </p>
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
