import mock from '../mock/mock.module.css';
import styles from './crm-visuals.module.css';

/* ------------------------------------------------------------------ Column types */

/** The 27 column types in the CRM. `calc` marks the ones the board fills in for you. */
export const COLUMN_TYPES: readonly { readonly name: string; readonly calc?: true }[] = [
  { name: 'Name' },
  { name: 'Text' },
  { name: 'Long text' },
  { name: 'Status' },
  { name: 'People' },
  { name: 'Date' },
  { name: 'Timeline' },
  { name: 'Numbers' },
  { name: 'Currency' },
  { name: 'Email' },
  { name: 'Phone' },
  { name: 'Link' },
  { name: 'Dropdown' },
  { name: 'Tags' },
  { name: 'Checkbox' },
  { name: 'Rating' },
  { name: 'Files' },
  { name: 'Location' },
  { name: 'Country' },
  { name: 'Connect boards' },
  { name: 'Progress', calc: true },
  { name: 'Mirror', calc: true },
  { name: 'Formula', calc: true },
  { name: 'Last updated', calc: true },
  { name: 'Creation log', calc: true },
  { name: 'Item ID', calc: true },
  { name: 'Button', calc: true },
];

export function ColumnWall() {
  return (
    <div>
      <ul className={styles.columnList}>
        {COLUMN_TYPES.map((column, i) => (
          <li key={column.name} data-calc={column.calc} data-reveal style={{ '--reveal-delay': 18 * i } as React.CSSProperties}>
            {column.name}
          </li>
        ))}
      </ul>
      <p className={styles.columnKey}>
        <span aria-hidden /> Filled in by the board: rollups, formulas, mirrors and logs.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ Pipeline */

const STAGES = [
  { name: 'Lead', deals: 18, value: '$412k', share: 1, token: 'sky' },
  { name: 'Qualified', deals: 11, value: '$286k', share: 0.74, token: 'indigo' },
  { name: 'Proposal', deals: 7, value: '$198k', share: 0.52, token: 'orange' },
  { name: 'Negotiation', deals: 4, value: '$121k', share: 0.33, token: 'purple' },
  { name: 'Won', deals: 3, value: '$92k', share: 0.2, token: 'green' },
] as const;

/** The Pipeline page: funnel by stage with a weighted forecast. */
export function PipelineView() {
  return (
    <div className={mock.panel}>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Pipeline</div>
          <div className={mock.sub}>This quarter · sample data</div>
        </div>
        <div className={styles.forecast}>
          <span className={mock.sub}>Forecast</span>
          <span className={`numeral ${styles.forecastValue}`}>$318k</span>
        </div>
      </div>
      <ol className={styles.funnel}>
        {STAGES.map((stage, i) => (
          <li key={stage.name} data-reveal style={{ '--reveal-delay': 80 * i } as React.CSSProperties}>
            <span className={styles.stageName}>{stage.name}</span>
            <span className={styles.stageTrack} aria-hidden>
              <span
                className={styles.stageBar}
                style={{ '--share': stage.share, background: `var(--label-${stage.token})` } as React.CSSProperties}
              />
            </span>
            <span className={styles.stageDeals}>{stage.deals} deals</span>
            <span className={styles.stageValue}>{stage.value}</span>
          </li>
        ))}
      </ol>
    </div>
  );
}

/* ------------------------------------------------------------------ Dashboard */

const LEADERS = [
  { name: 'Dana R.', value: '$134k', share: 1 },
  { name: 'Marcus T.', value: '$98k', share: 0.73 },
  { name: 'Priya S.', value: '$61k', share: 0.46 },
] as const;

const WORKLOAD = [
  { name: 'Dana R.', open: 9, cap: 12 },
  { name: 'Marcus T.', open: 12, cap: 12 },
  { name: 'Ari K.', open: 5, cap: 12 },
] as const;

/** A dashboard built from four of the widget types: Numbers, Battery, Leaderboard and Workload. */
export function DashboardMock() {
  return (
    <div className={mock.panel} data-lifted>
      <div className={mock.head}>
        <div>
          <div className={mock.title}>Sales this quarter</div>
          <div className={mock.sub}>Updates live · sample data</div>
        </div>
      </div>
      <div className={styles.widgets}>
        <div className={styles.widget}>
          <span className={styles.widgetName}>Won this quarter</span>
          <span className={`numeral ${styles.kpi}`}>$293k</span>
          <span className={styles.delta}>24 deals</span>
        </div>
        <div className={styles.widget}>
          <span className={styles.widgetName}>Open pipeline</span>
          <span className={`numeral ${styles.kpi}`}>$1.1m</span>
          <span className={styles.delta}>43 deals</span>
        </div>
        <div className={`${styles.widget} ${styles.wide}`}>
          <span className={styles.widgetName}>Deals by status</span>
          <div className={styles.battery} role="img" aria-label="Deals by status: 46% won, 31% in progress, 23% stuck">
            <span style={{ flexGrow: 46, background: 'var(--label-green)' }} />
            <span style={{ flexGrow: 31, background: 'var(--label-orange)' }} />
            <span style={{ flexGrow: 23, background: 'var(--label-red)' }} />
          </div>
          <div className={styles.batteryKey}>
            <span>Won 46%</span>
            <span>In progress 31%</span>
            <span>Stuck 23%</span>
          </div>
        </div>
        <div className={styles.widget}>
          <span className={styles.widgetName}>Leaderboard</span>
          <ul className={styles.bars}>
            {LEADERS.map((leader) => (
              <li key={leader.name}>
                <span>{leader.name}</span>
                <span className={styles.barTrack} aria-hidden>
                  <span style={{ transform: `scaleX(${leader.share})` }} />
                </span>
                <span className={styles.barValue}>{leader.value}</span>
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.widget}>
          <span className={styles.widgetName}>Workload</span>
          <ul className={styles.bars}>
            {WORKLOAD.map((person) => (
              <li key={person.name} data-full={person.open >= person.cap || undefined}>
                <span>{person.name}</span>
                <span className={styles.barTrack} aria-hidden>
                  <span style={{ transform: `scaleX(${person.open / person.cap})` }} />
                </span>
                <span className={styles.barValue}>{person.open}</span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ Updates and inbox */

const INBOX = [
  { who: 'Marcus T.', what: 'mentioned you on', item: 'Harbor & Pine kits', when: '2m', isUnread: true },
  { who: 'Automation', what: 'assigned you', item: 'Lakeside Pantry', when: '18m', isUnread: true },
  { who: 'Priya S.', what: 'replied on', item: 'Ridgeline returns', when: '1h', isUnread: false },
] as const;

/** An item update with a mention, reactions and "seen by", over the Inbox it lands in. */
export function UpdateThread() {
  return (
    <div className={styles.thread}>
      <div className={mock.panel} data-lifted>
        <div className={styles.update}>
          <span className={styles.avatar} aria-hidden>
            MT
          </span>
          <div>
            <div className={styles.updateHead}>
              <strong>Marcus T.</strong> <span className={mock.muted}>on Harbor &amp; Pine kits · 2m</span>
            </div>
            <p className={styles.updateBody}>
              <span className={styles.mention}>@Dana R.</span> they signed the quarterly program. Can you confirm the first
              build date before I send the kickoff?
            </p>
            <div className={styles.reactions}>
              <span>👍 2</span>
              <span>🎉 1</span>
              <span className={styles.seen}>Seen by 4</span>
            </div>
            <div className={styles.reply}>
              <span className={styles.avatar} data-small aria-hidden>
                DR
              </span>
              <span>
                <strong>Dana R.</strong> First build is the 14th. Go ahead.
              </span>
            </div>
          </div>
        </div>
      </div>

      <div className={`${mock.panel} ${styles.inbox}`}>
        <div className={styles.inboxHead}>
          <span className={mock.title}>Inbox</span>
          <span className={styles.badge}>2 new</span>
        </div>
        <ul className={mock.rows}>
          {INBOX.map((note) => (
            <li key={note.item} className={`${mock.row} ${styles.note}`} data-unread={note.isUnread || undefined}>
              <span>
                <strong>{note.who}</strong> {note.what} <strong>{note.item}</strong>
              </span>
              <span className={mock.muted}>{note.when}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
