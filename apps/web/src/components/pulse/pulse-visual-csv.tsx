'use client';

import { useEffect, useRef, useState } from 'react';
import mock from '../mock/mock.module.css';
import { CSV_CHECK, CSV_FILE, CSV_PREVIEW, CSV_PROBLEM, CSV_ROWS, count } from './pulse-visual-data';
import { PulseLoader } from './pulse-visual-parts';
import styles from './pulse-visuals.module.css';

const STEPS = ['Upload', 'Match columns', 'Check', 'Done'] as const;
const CURRENT_STEP = 2;
const CHECK_MS = 1600;

/**
 * Step 3 of a CSV import: Pulse checks the file and shows what it would do before anything is saved.
 * "Check again" replays the check with the official Pulse loader.
 */
export function CsvCheck() {
  const [isChecking, setIsChecking] = useState(false);
  const timer = useRef<number | undefined>(undefined);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  function checkAgain() {
    window.clearTimeout(timer.current);
    setIsChecking(true);
    timer.current = window.setTimeout(() => setIsChecking(false), CHECK_MS);
  }

  return (
    <div className={`${mock.panel} ${styles.frame}`} data-lifted>
      <div className={`${mock.head} ${styles.head}`}>
        <div>
          <div className={mock.title}>Import production</div>
          <div className={mock.sub}>
            <span className={mock.mono}>{CSV_FILE}</span> · sample data
          </div>
        </div>
        <button type="button" className={mock.smallBtn} onClick={checkAgain} disabled={isChecking}>
          Check again
        </button>
      </div>

      <ol className={styles.steps} aria-label="Import steps">
        {STEPS.map((step, i) => (
          <li
            key={step}
            data-state={i < CURRENT_STEP ? 'done' : i === CURRENT_STEP ? 'current' : 'todo'}
            aria-current={i === CURRENT_STEP ? 'step' : undefined}
          >
            <span className={styles.stepIndex} aria-hidden>
              {i + 1}
            </span>
            {step}
            {i < CURRENT_STEP ? <span className="visually-hidden"> (done)</span> : null}
          </li>
        ))}
      </ol>

      <div className={styles.checkStage} role="status" aria-live="polite">
        {isChecking ? (
          <div className={styles.checking}>
            <PulseLoader size={72} />
            <span>Checking {count(CSV_ROWS)} rows. Nothing is saved yet.</span>
          </div>
        ) : (
          <>
            <dl className={styles.counts}>
              {CSV_CHECK.map((item) => (
                <div key={item.label} data-problem={item.isProblem}>
                  <dt>{item.label}</dt>
                  <dd className="numeral">{count(item.rows)}</dd>
                </div>
              ))}
            </dl>

            <table className={`${styles.table} ${styles.preview}`}>
              <caption className="visually-hidden">
                Preview of rows 13 to 15 of the file. Row {CSV_PROBLEM.row} has a problem in{' '}
                {CSV_PROBLEM.column}.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Row</th>
                  <th scope="col" className={styles.wideOnly}>
                    work_date
                  </th>
                  <th scope="col">job_number</th>
                  <th scope="col" className={styles.wideOnly}>
                    units_good
                  </th>
                  <th scope="col">labor_hours</th>
                </tr>
              </thead>
              <tbody>
                {CSV_PREVIEW.map((line) => (
                  <tr key={line.row}>
                    <th scope="row">{line.row}</th>
                    <td className={styles.wideOnly}>{line.workDate}</td>
                    <td>{line.job}</td>
                    <td className={styles.wideOnly}>{line.units}</td>
                    <td>
                      {line.row === CSV_PROBLEM.row ? (
                        <span className={styles.badCell}>
                          {line.hours}
                          <span className="visually-hidden"> (problem)</span>
                        </span>
                      ) : (
                        line.hours
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>

            <p className={styles.problem}>
              <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
                <path
                  d="M8 2.2l6.2 11H1.8zM8 6.6v3M8 11.6v.4"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
              <span>
                Row {CSV_PROBLEM.row}, {CSV_PROBLEM.column}: {CSV_PROBLEM.message}
              </span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}
