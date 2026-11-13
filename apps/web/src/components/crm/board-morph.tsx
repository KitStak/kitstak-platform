'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { observeVisibility, prefersReducedMotion } from '../use-reveal';
import { COLUMN_WIDTH, ITEMS, STATUSES, STATUS_TOKEN, VIEWS, columnX, layout } from './board-model';
import type { ViewKind } from './board-model';
import styles from './board-morph.module.css';

const AUTO_MS = 4200;
const TIMELINE_WEEKS = ['Nov 3', 'Nov 10', 'Nov 17', 'Nov 24', 'Dec 1'];

export function BoardMorph() {
  const rootRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<ViewKind>('table');
  const [isAuto, setIsAuto] = useState(true);
  const [isVisible, setIsVisible] = useState(false);
  const frames = useMemo(() => layout(view), [view]);

  useEffect(() => {
    if (!rootRef.current) return;
    return observeVisibility(rootRef.current, setIsVisible);
  }, []);

  useEffect(() => {
    if (!isAuto || !isVisible || prefersReducedMotion()) return;
    const timer = window.setTimeout(() => {
      const i = VIEWS.findIndex((v) => v.kind === view);
      setView(VIEWS[(i + 1) % VIEWS.length]!.kind);
    }, AUTO_MS);
    return () => window.clearTimeout(timer);
  }, [view, isAuto, isVisible]);

  const choose = (kind: ViewKind) => {
    setIsAuto(false);
    setView(kind);
  };

  return (
    <div ref={rootRef} className={styles.wrap}>
      <div className={styles.toolbar}>
        <div className={styles.boardName}>Q4 accounts</div>
        <div className={styles.views} role="tablist" aria-label="Board view">
          {VIEWS.map((v) => (
            <button
              key={v.kind}
              role="tab"
              aria-selected={v.kind === view}
              className={styles.viewTab}
              onClick={() => choose(v.kind)}
            >
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.board} data-view={view}>
        <div className={`${styles.tableHead} ${styles.layer}`} data-on={view === 'table' || undefined} aria-hidden>
          <span>Item</span>
          <span>Owner</span>
          <span>Status</span>
          <span className={styles.right}>Value</span>
        </div>

        {STATUSES.map((s, i) => (
          <div
            key={s}
            className={`${styles.colHead} ${styles.layer}`}
            data-on={view === 'kanban' || undefined}
            style={
              {
                left: `${columnX(i)}%`,
                width: `${COLUMN_WIDTH}%`,
                background: `var(--label-${STATUS_TOKEN[s]})`,
                color: `var(--label-${STATUS_TOKEN[s]}-fg)`,
              } as React.CSSProperties
            }
            aria-hidden
          >
            {s}
          </div>
        ))}

        <div className={`${styles.weeks} ${styles.layer}`} data-on={view === 'timeline' || undefined} aria-hidden>
          {TIMELINE_WEEKS.map((w) => (
            <span key={w}>{w}</span>
          ))}
        </div>

        {ITEMS.map((item, i) => {
          const f = frames[i]!;
          const token = STATUS_TOKEN[item.status];
          return (
            <div
              key={item.name}
              className={styles.item}
              style={
                {
                  left: `${f.x}%`,
                  top: `${f.y}%`,
                  width: `${f.w}%`,
                  height: `${f.h}%`,
                  '--i': i,
                  '--tone': `var(--label-${token})`,
                  '--tone-fg': `var(--label-${token}-fg)`,
                  '--tone-subtle': `var(--label-${token}-subtle)`,
                } as React.CSSProperties
              }
            >
              <span className={styles.name}>{item.name}</span>
              <span className={styles.owner}>{item.owner}</span>
              <span className={styles.pill}>{item.status}</span>
              <span className={styles.value}>{item.value}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
