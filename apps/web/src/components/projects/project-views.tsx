'use client';

import { useState } from 'react';
import mock from '../mock/mock.module.css';
import styles from './projects-visuals.module.css';

type ViewId = 'board' | 'timeline' | 'workload';
type StatusId = 'todo' | 'doing' | 'done';

const VIEWS: readonly { readonly id: ViewId; readonly label: string }[] = [
  { id: 'board', label: 'Board' },
  { id: 'timeline', label: 'Timeline' },
  { id: 'workload', label: 'Workload' },
];

const STATUSES: readonly { readonly id: StatusId; readonly label: string; readonly token: string }[] = [
  { id: 'todo', label: 'To do', token: 'gray' },
  { id: 'doing', label: 'In progress', token: 'orange' },
  { id: 'done', label: 'Done', token: 'green' },
];

interface Task {
  readonly key: string;
  readonly title: string;
  readonly owner: string;
  readonly status: StatusId;
  /** Timeline start and length as a share (0 to 1) of the four visible weeks. */
  readonly start: number;
  readonly span: number;
  readonly isMilestone?: true;
}

/** Illustrative tasks from a warehouse go-live project. */
const TASKS: readonly Task[] = [
  { key: 'OPS-38', title: 'Generate rack locations', owner: 'Dana R.', status: 'done', start: 0, span: 0.22 },
  { key: 'OPS-39', title: 'Print and hang bin labels', owner: 'Ari K.', status: 'done', start: 0.2, span: 0.2 },
  { key: 'OPS-41', title: 'Import product catalog', owner: 'Priya S.', status: 'doing', start: 0.34, span: 0.26 },
  { key: 'OPS-42', title: 'Train the receiving team', owner: 'Dana R.', status: 'doing', start: 0.5, span: 0.24 },
  { key: 'OPS-44', title: 'First live cycle count', owner: 'Marcus T.', status: 'todo', start: 0.7, span: 0.18 },
  { key: 'OPS-45', title: 'Go live', owner: 'Dana R.', status: 'todo', start: 0.92, span: 0.04, isMilestone: true },
];
const WEEKS = ['Nov 3', 'Nov 10', 'Nov 17', 'Nov 24'];
const CAPACITY = 3;

function tone(status: StatusId): React.CSSProperties {
  const token = STATUSES.find((s) => s.id === status)!.token;
  return {
    '--tone': `var(--label-${token})`,
    '--tone-subtle': `var(--label-${token}-subtle)`,
    '--tone-text': `var(--label-${token}-text)`,
  } as React.CSSProperties;
}

/** Hero illustration for /projects: one set of tasks seen as a board, a timeline and a workload. */
export function ProjectViews() {
  const [view, setView] = useState<ViewId>('timeline');
  const owners = [...new Set(TASKS.map((task) => task.owner))];

  return (
    <div className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Warehouse go-live</div>
          <div className={mock.sub}>OPS · on track · sample data</div>
        </div>
        <div className={mock.tabs} role="group" aria-label="Project view">
          {VIEWS.map((v) => (
            <button key={v.id} type="button" className={mock.tab} aria-pressed={v.id === view} onClick={() => setView(v.id)}>
              {v.label}
            </button>
          ))}
        </div>
      </div>

      <div className={styles.viewBody} key={view}>
        {view === 'board' ? (
          <div className={styles.board}>
            {STATUSES.map((status) => (
              <div key={status.id} className={styles.column}>
                <div className={styles.columnHead} style={tone(status.id)}>
                  {status.label}
                </div>
                {TASKS.filter((task) => task.status === status.id).map((task) => (
                  <div key={task.key} className={styles.card}>
                    <span className={mock.mono}>{task.key}</span>
                    <span className={styles.cardTitle}>{task.title}</span>
                    <span className={styles.cardOwner}>{task.owner}</span>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ) : null}

        {view === 'timeline' ? (
          <div className={styles.timeline}>
            <div className={styles.weeks} aria-hidden>
              {WEEKS.map((week) => (
                <span key={week}>{week}</span>
              ))}
            </div>
            <ul className={styles.bars}>
              {TASKS.map((task, i) => (
                <li key={task.key} style={{ '--i': i } as React.CSSProperties}>
                  <span
                    className={styles.bar}
                    data-milestone={task.isMilestone}
                    style={{ ...tone(task.status), left: `${task.start * 100}%`, width: `${task.span * 100}%` }}
                  >
                    {task.isMilestone ? null : task.title}
                  </span>
                  {task.isMilestone ? (
                    <span className={styles.milestoneLabel} style={{ right: `${(1 - task.start) * 100 + 2}%` }}>
                      {task.title}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {view === 'workload' ? (
          <ul className={styles.workload}>
            {owners.map((owner) => {
              const open = TASKS.filter((task) => task.owner === owner && task.status !== 'done').length;
              return (
                <li key={owner} data-over={open >= CAPACITY || undefined}>
                  <span className={styles.person}>{owner}</span>
                  <span className={styles.loadTrack} aria-hidden>
                    <span style={{ transform: `scaleX(${Math.min(open / CAPACITY, 1)})` }} />
                  </span>
                  <span className={styles.loadValue}>
                    {open} of {CAPACITY} open
                  </span>
                </li>
              );
            })}
          </ul>
        ) : null}
      </div>
      <p className={mock.caption}>The same tasks in three of the six views.</p>
    </div>
  );
}
