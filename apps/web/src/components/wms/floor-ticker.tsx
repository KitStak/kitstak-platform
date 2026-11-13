'use client';

import { useEffect, useRef, useState } from 'react';
import { observeVisibility, prefersReducedMotion } from '../use-reveal';
import mock from '../mock/mock.module.css';
import styles from './floor-ticker.module.css';

interface Stage {
  readonly key: string;
  readonly label: string;
  readonly where: string;
}

const STAGES: readonly Stage[] = [
  { key: 'received', label: 'Received', where: 'Dock 2' },
  { key: 'putaway', label: 'Put away', where: 'Aisles A to D' },
  { key: 'picked', label: 'Picked', where: 'Mobile carts' },
  { key: 'packed', label: 'Packed', where: 'Packing stations' },
  { key: 'shipped', label: 'Shipped', where: 'End of the day' },
];

/** Illustrative unit counts per stage at the start of the loop. */
const START: readonly number[] = [128, 96, 74, 61, 48];
const EVENTS: readonly string[] = [
  'PO-2291 received at Dock 2 · 40 units, lot L-0412',
  'Putaway confirmed · KS-2210 to B-06',
  'Job 318 picked · 12 single-item orders',
  'SO-10482 packed · putwall slot 7, 4 cartons',
  'Label printed · cheapest in time, 2-day',
];
interface FloorState {
  readonly counts: readonly number[];
  readonly active: number;
}

const TICK_MS = 1500;
const BAR_MAX = 200;

/** Hero illustration for the WMS page: units moving through the floor, one stage at a time. */
export function FloorTicker() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [{ counts, active }, setFloor] = useState<FloorState>({ counts: START, active: 0 });
  const [isVisible, setIsVisible] = useState(true);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    if (!rootRef.current) return;
    return observeVisibility(rootRef.current, setIsVisible);
  }, []);

  useEffect(() => {
    if (!isVisible || isPaused || prefersReducedMotion()) return;
    const timer = window.setInterval(() => {
      setFloor((prev) => {
        const next = (prev.active + 1) % STAGES.length;
        // Start the sample day over before the bars run out of room.
        if (prev.counts.some((count) => count >= BAR_MAX)) return { active: next, counts: START };
        return { active: next, counts: prev.counts.map((count, i) => (i === next ? count + 1 + (i % 3) : count)) };
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [isVisible, isPaused]);

  return (
    <div ref={rootRef} className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Today on the floor</div>
          <div className={mock.sub}>Columbus DC · sample data</div>
        </div>
        <button
          type="button"
          className={styles.live}
          aria-pressed={isPaused}
          aria-label="Pause the sample activity"
          data-paused={isPaused || undefined}
          onClick={() => setIsPaused((paused) => !paused)}
        >
          <span aria-hidden />
          {isPaused ? 'Paused' : 'Live'}
        </button>
      </div>

      <ol className={styles.stages}>
        {STAGES.map((stage, i) => (
          <li key={stage.key} className={styles.stage} data-active={i === active || undefined}>
            <span className={styles.step}>{i + 1}</span>
            <span className={styles.names}>
              <span className={styles.label}>{stage.label}</span>
              <span className={styles.where}>{stage.where}</span>
            </span>
            <span className={styles.track} aria-hidden>
              <span style={{ transform: `scaleX(${Math.min(counts[i]! / BAR_MAX, 1)})` }} />
            </span>
            <span className={`numeral ${styles.count}`}>{counts[i]}</span>
          </li>
        ))}
      </ol>

      <p className={styles.event} key={active}>
        {EVENTS[active]}
      </p>
    </div>
  );
}
