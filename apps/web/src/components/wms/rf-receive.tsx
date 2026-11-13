'use client';

import { useEffect, useRef, useState } from 'react';
import { observeVisibility, prefersReducedMotion } from '../use-reveal';
import styles from './wms-visuals.module.css';

interface ScanStep {
  readonly prompt: string;
  readonly value: string;
  readonly result: string;
}

/** The scan-first receiving flow: PO, item, lot and dates, location. */
const STEPS: readonly ScanStep[] = [
  { prompt: 'Scan purchase order', value: 'PO-2291', result: 'Harbor & Pine · 3 lines open' },
  { prompt: 'Scan item', value: 'KS-2210', result: 'Gift box, large · 40 expected' },
  { prompt: 'Lot and expiry', value: 'L-0412 · 2027-06-30', result: 'Lot tracked · FEFO' },
  { prompt: 'Scan location', value: 'B-06', result: 'Suggested by putaway rules' },
];
const STEP_MS = 1700;
const HOLD_MS = 2600;

export function RfReceive() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [done, setDone] = useState(0);
  const [isVisible, setIsVisible] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isComplete = done >= STEPS.length;

  useEffect(() => {
    if (!rootRef.current) return;
    return observeVisibility(rootRef.current, setIsVisible);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setDone(STEPS.length);
      return;
    }
    if (!isVisible || isPaused) return;
    const timer = window.setTimeout(() => setDone(isComplete ? 0 : done + 1), isComplete ? HOLD_MS : STEP_MS);
    return () => window.clearTimeout(timer);
  }, [done, isComplete, isVisible, isPaused]);

  return (
    <div ref={rootRef} className={styles.rfStage}>
      <div className={styles.handheld}>
        <div className={styles.handheldBar}>
          <span>Receiving</span>
          <span className={styles.handheldStep}>
            {Math.min(done + 1, STEPS.length)} / {STEPS.length}
          </span>
        </div>
        <ol className={styles.scans}>
          {STEPS.map((step, i) => {
            const state = i < done ? 'done' : i === done ? 'current' : 'todo';
            return (
              <li key={step.prompt} className={styles.scan} data-state={state}>
                <span className={styles.scanPrompt}>{step.prompt}</span>
                <span className={styles.scanField}>
                  <span className={styles.scanValue}>{state === 'todo' ? '' : step.value}</span>
                  <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden className={styles.scanTick}>
                    <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
                  </svg>
                </span>
                <span className={styles.scanResult}>{state === 'done' ? step.result : ' '}</span>
              </li>
            );
          })}
        </ol>
        <div className={styles.received} data-on={isComplete || undefined}>
          <span className={`numeral ${styles.receivedQty}`}>40</span>
          <span>
            received to B-06
            <br />
            on hand updated
          </span>
        </div>
      </div>
      <p className={styles.rfNote}>
        Runs in the browser on a handheld scanner. Nothing to install.{' '}
        <button type="button" className={styles.rfPause} aria-pressed={isPaused} onClick={() => setIsPaused((paused) => !paused)}>
          {isPaused ? 'Play the demo' : 'Pause the demo'}
        </button>
      </p>
    </div>
  );
}
