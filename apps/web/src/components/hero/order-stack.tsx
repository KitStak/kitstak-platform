'use client';

import { useEffect, useRef, useState } from 'react';
import { observeVisibility, prefersReducedMotion } from '../use-reveal';
import { SAMPLE_ORDERS } from './order-data';
import styles from './order-stack.module.css';

const STEP_MS = 1300;
const HOLD_MS = 2600;
const MAX_TILT_DEG = 5;

/**
 * Order events land one on top of another, building a stack: CRM events and warehouse events
 * on the same record. Tilts slightly toward the pointer; pauses on hover and when off screen.
 */
export function OrderStack() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [orderIndex, setOrderIndex] = useState(0);
  const [stepCount, setStepCount] = useState(1);
  const [isPaused, setIsPaused] = useState(false);
  const [isVisible, setIsVisible] = useState(true);

  const order = SAMPLE_ORDERS[orderIndex]!;
  const total = order.steps.length;
  const isComplete = stepCount >= total;

  useEffect(() => {
    if (!rootRef.current) return;
    return observeVisibility(rootRef.current, setIsVisible);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion()) {
      setStepCount(total);
      return;
    }
    if (isPaused || !isVisible) return;
    const timer = window.setTimeout(
      () => {
        if (isComplete) {
          setOrderIndex((i) => (i + 1) % SAMPLE_ORDERS.length);
          setStepCount(1);
        } else {
          setStepCount((n) => n + 1);
        }
      },
      isComplete ? HOLD_MS : STEP_MS,
    );
    return () => window.clearTimeout(timer);
  }, [stepCount, isComplete, isPaused, isVisible, total]);

  const onPointerMove = (event: React.PointerEvent<HTMLDivElement>) => {
    const el = rootRef.current;
    if (!el || event.pointerType !== 'mouse') return;
    const rect = el.getBoundingClientRect();
    const x = (event.clientX - rect.left) / rect.width - 0.5;
    const y = (event.clientY - rect.top) / rect.height - 0.5;
    el.style.setProperty('--tilt-x', `${(-y * MAX_TILT_DEG).toFixed(2)}deg`);
    el.style.setProperty('--tilt-y', `${(x * MAX_TILT_DEG).toFixed(2)}deg`);
  };

  const resetTilt = () => {
    rootRef.current?.style.setProperty('--tilt-x', '0deg');
    rootRef.current?.style.setProperty('--tilt-y', '0deg');
    setIsPaused(false);
  };

  // Newest event on top, like a stack.
  const visible = order.steps.slice(0, stepCount).map((step, i) => ({ step, i })).reverse();

  return (
    <div
      ref={rootRef}
      className={styles.stage}
      onPointerMove={onPointerMove}
      onPointerEnter={() => setIsPaused(true)}
      onPointerLeave={resetTilt}
      aria-label={`${order.customer}, ${order.number}: ${order.steps[stepCount - 1]?.label}`}
      role="img"
    >
      <div className={styles.panel}>
        <div className={styles.head}>
          <div>
            <div className={styles.customer} key={order.customer}>
              {order.customer}
            </div>
            <div className={styles.number}>{order.number}</div>
          </div>
          <div className={styles.progress} aria-hidden>
            <span className={`numeral ${styles.count}`}>{stepCount}</span>
            <span className={styles.of}>/ {total}</span>
          </div>
        </div>

        <ol className={styles.stack} key={orderIndex}>
          {visible.map(({ step, i }) => {
            const isCurrent = i === stepCount - 1;
            return (
              <li
                key={i}
                className={styles.row}
                data-current={isCurrent || undefined}
                data-source={step.source}
                style={{ '--depth': stepCount - 1 - i } as React.CSSProperties}
              >
                <span className={styles.bar} aria-hidden />
                <span className={styles.source}>{step.source}</span>
                <span className={styles.label}>{step.label}</span>
                <span className={styles.detail}>{step.detail}</span>
              </li>
            );
          })}
        </ol>

        <div className={styles.pager} aria-hidden>
          {SAMPLE_ORDERS.map((o, i) => (
            <span key={o.number} data-active={i === orderIndex || undefined} />
          ))}
        </div>
      </div>
    </div>
  );
}
