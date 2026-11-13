'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { observeVisibility, prefersReducedMotion } from '../use-reveal';
import { AISLES, BINS, BIN_H, BIN_W, DOCK, PICK_LISTS, RACK_X, RACK_Y0, ROW_PITCH, VIEW_H, VIEW_W, pickPath } from './rack-model';
import type { Bin } from './rack-model';
import styles from './rack-map.module.css';

const CYCLE_MS = 7000;
const WALK_MS = 2800;

export function RackMap() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [listIndex, setListIndex] = useState(0);
  const [hovered, setHovered] = useState<Bin | null>(null);
  const [isVisible, setIsVisible] = useState(false);

  const { d, stops } = useMemo(() => pickPath(PICK_LISTS[listIndex]!), [listIndex]);
  const stopOrder = useMemo(() => new Map(stops.map((b, i) => [b.id, i])), [stops]);

  useEffect(() => {
    if (!rootRef.current) return;
    return observeVisibility(rootRef.current, setIsVisible);
  }, []);

  useEffect(() => {
    if (!isVisible || hovered || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => setListIndex((i) => (i + 1) % PICK_LISTS.length), CYCLE_MS);
    return () => window.clearTimeout(timer);
  }, [isVisible, hovered, listIndex]);

  const next = () => setListIndex((i) => (i + 1) % PICK_LISTS.length);

  return (
    <div ref={rootRef} className={styles.wrap} data-visible={isVisible || undefined}>
      <div className={styles.toolbar}>
        <div>
          <div className={styles.title}>Pick list {`PL-${7041 + listIndex}`}</div>
          <div className={styles.sub}>{stops.length} locations · shortest walk</div>
        </div>
        <button type="button" className={styles.next} onClick={next}>
          Next pick list <span aria-hidden>→</span>
        </button>
      </div>

      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className={styles.svg}
        role="img"
        aria-label={`Warehouse map with a pick path through ${stops.map((s) => s.id).join(', ')}`}
      >
        {AISLES.map((aisle, row) => (
          <text key={aisle} x={RACK_X - 40} y={RACK_Y0 + row * ROW_PITCH + BIN_H / 2 + 5} className={styles.aisle}>
            {aisle}
          </text>
        ))}

        <rect x={DOCK.x} y={DOCK.y} width={DOCK.w} height={DOCK.h} rx={4} className={styles.dock} />
        <text x={DOCK.x + DOCK.w / 2} y={DOCK.y + DOCK.h / 2 + 4} textAnchor="middle" className={styles.dockLabel}>
          Dock
        </text>

        {BINS.map((bin) => {
          const order = stopOrder.get(bin.id);
          const isStop = order !== undefined;
          return (
            <g
              key={bin.id}
              className={styles.bin}
              data-stop={isStop || undefined}
              style={{ '--order': order ?? 0 } as React.CSSProperties}
              onPointerEnter={() => setHovered(bin)}
              onPointerLeave={() => setHovered(null)}
            >
              <rect x={bin.x} y={bin.y} width={BIN_W} height={BIN_H} rx={3} />
              {isStop ? (
                <text x={bin.x + BIN_W / 2} y={bin.y + BIN_H / 2 + 5} textAnchor="middle">
                  {order + 1}
                </text>
              ) : null}
            </g>
          );
        })}

        <path
          key={listIndex}
          d={d}
          pathLength={1}
          className={styles.path}
          style={{ '--walk': `${WALK_MS}ms` } as React.CSSProperties}
        />
      </svg>

      <div className={styles.readout} aria-live="polite">
        {hovered ? (
          <>
            <span className={styles.loc}>{hovered.id}</span>
            <span>{hovered.sku}</span>
            <span className={`numeral ${styles.qty}`}>{hovered.qty}</span>
            <span className={styles.unit}>on hand</span>
          </>
        ) : (
          <span className={styles.hint}>Hover a location to see what is in it.</span>
        )}
      </div>
    </div>
  );
}
