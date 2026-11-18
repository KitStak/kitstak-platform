import { AppIcon } from '../app-icon';
import mock from '../mock/mock.module.css';
import { PulseShot } from './pulse-shot';
import { CsvCheck } from './pulse-visual-csv';
import {
  COMPANY_PROFIT,
  LOG_DAY,
  LOG_ROWS,
  LOG_SITE,
  LOG_TOTAL,
  MONTH,
  NEEDS_YOU,
  NEEDS_YOU_COUNT,
  OPEN_JOBS,
  OVERTIME_HOUR,
  PERIOD,
  PLAN_HOURS,
  PLAN_LINES,
  PLAN_PROFIT,
  PLAN_PROGRESS,
  RATE,
  RATE_PARTS,
  REAL_HOUR,
  STATUS_COUNTS,
  TARGET_MARGIN,
  WHY_READING,
  WHY_STEPS,
  count,
  laborHours,
  money,
  moneyCents,
  paceOf,
  percent,
  signedMoney,
  splitOf,
  type OpenJob,
  type PlanLine,
} from './pulse-visual-data';
import { JobName, PulseWordmark, SplitBar, StatusPill } from './pulse-visual-parts';
import { ProfitExplorer } from './pulse-visual-profit';
import styles from './pulse-visuals.module.css';

/*
 * Eight of the nine screenshot slots of the Pulse page (the ninth is in pulse-section-math.tsx). Each one is a PulseShot: it shows the real product
 * screenshot when the slot is marked ready in pulse-shots.ts. The coded visual inside it, a small
 * drawing of the same screen with sample data, shows only when a slot is switched back to not ready.
 */

/* ===== Hero: Home ===== */

const MONTH_SPLIT = splitOf(MONTH.moneyIn, MONTH.moneyOut);

const HOME_TILES = [
  { label: 'Revenue', value: money(MONTH.moneyIn) },
  { label: 'Cost', value: money(MONTH.moneyOut) },
  { label: 'Profit on jobs', value: money(MONTH.profit) },
  { label: 'Company profit', value: money(COMPANY_PROFIT) },
] as const;

/** Home: the answer in words, the month in four numbers and the jobs that need you. */
export function PulseHeroVisual() {
  return (
    <PulseShot slot="hero" onBrand>
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <PulseWordmark height={36} />
          <div className={mock.sub}>{PERIOD} · sample data</div>
        </div>

        <p className={styles.answer}>
          Your jobs made <strong>{money(MONTH.profit)}</strong> this month at a{' '}
          <strong>{percent(MONTH.margin, 0)} margin</strong>. After time not on a job and overhead, the
          company made <strong>{money(COMPANY_PROFIT)}</strong>. {NEEDS_YOU_COUNT} jobs need you.
        </p>

        <dl className={styles.tiles}>
          {HOME_TILES.map((tile) => (
            <div key={tile.label}>
              <dt>{tile.label}</dt>
              <dd className="numeral">{tile.value}</dd>
            </div>
          ))}
        </dl>

        <SplitBar out={MONTH_SPLIT.out} profit={MONTH_SPLIT.profit} what="profit on jobs" />

        <div className={styles.groupLabel} aria-hidden>
          Jobs that need you · worst {NEEDS_YOU.length} of {NEEDS_YOU_COUNT}
        </div>
        <ul
          className={styles.jobList}
          aria-label={`Jobs that need you, the worst ${NEEDS_YOU.length} of ${NEEDS_YOU_COUNT}`}
        >
          {NEEDS_YOU.map((job) => (
            <li key={job.code}>
              <div className={styles.jobLine}>
                <JobName code={job.code} name={job.name} />
                <StatusPill status={job.status} />
              </div>
              <p className={styles.reason}>{job.reason}</p>
            </li>
          ))}
        </ul>
      </div>
    </PulseShot>
  );
}

/* ===== Profit by job, type, client, service ===== */

export function ProfitByJobVisual() {
  return (
    <PulseShot slot="profit">
      <ProfitExplorer />
    </PulseShot>
  );
}

/* ===== Log work ===== */

/** Log work: one row per job for the day. Units, people and hours in, pace against the target out. */
export function DailyEntryVisual() {
  const dayPace = paceOf(LOG_TOTAL.units, LOG_TOTAL.hours);
  return (
    <PulseShot slot="log">
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <div>
            <div className={mock.title}>Log work</div>
            <div className={mock.sub}>
              {LOG_DAY} · {LOG_SITE} · sample data
            </div>
          </div>
          <span className={styles.saved}>
            <Tick /> All rows saved
          </span>
        </div>

        {/* Roles are spelled out because the table restacks into cards on a phone. */}
        <table className={`${styles.table} ${styles.logTable}`} role="table">
          <caption className="visually-hidden">
            Work logged on {LOG_DAY}, one row per job. Sample data.
          </caption>
          <thead role="rowgroup">
            <tr role="row">
              <th role="columnheader" scope="col">
                Job
              </th>
              <th role="columnheader" scope="col">
                Units good
              </th>
              <th role="columnheader" scope="col">
                People
              </th>
              <th role="columnheader" scope="col">
                Hours each
              </th>
              <th role="columnheader" scope="col">
                Labor hours
              </th>
              <th role="columnheader" scope="col">
                Units per person per hour
              </th>
            </tr>
          </thead>
          <tbody role="rowgroup">
            {LOG_ROWS.map((row) => {
              const hours = laborHours(row);
              const pace = paceOf(row.units, hours);
              const isOnPace = pace >= row.targetPace;
              return (
                <tr key={row.code} role="row">
                  <th role="rowheader" scope="row">
                    <JobName code={row.code} name={row.name} />
                    {row.crew ? (
                      <span className={styles.crew}>
                        <span className="visually-hidden">Crew: </span>
                        {row.crew.map((line) => (
                          <span key={line.laborClass}>
                            {line.laborClass}, {line.people}
                          </span>
                        ))}
                      </span>
                    ) : null}
                  </th>
                  <td role="cell" data-label="Units good">
                    {count(row.units)}
                  </td>
                  <td role="cell" data-label="People">
                    {row.people}
                  </td>
                  <td role="cell" data-label="Hours each">
                    {row.hoursEach.toFixed(1)}
                  </td>
                  <td role="cell" data-label="Labor hours">
                    {hours.toFixed(1)}
                  </td>
                  <td role="cell" data-label="Units per person per hour" className={styles.paceCell}>
                    <span className={styles.pace} data-tone={row.note ? 'early' : isOnPace ? 'good' : 'low'}>
                      <strong>{pace}</strong>
                      <span>
                        {row.note
                          ? `${row.note}. Target ${row.targetPace}`
                          : `of ${row.targetPace} an hour · ${isOnPace ? 'On pace' : 'Too slow'}`}
                      </span>
                    </span>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <dl className={styles.dayTotals}>
          <div>
            <dt>Units today</dt>
            <dd className="numeral">{count(LOG_TOTAL.units)}</dd>
          </div>
          <div>
            <dt>Labor hours</dt>
            <dd className="numeral">{count(LOG_TOTAL.hours)}</dd>
          </div>
          <div>
            <dt>Units per person per hour</dt>
            <dd className="numeral">{dayPace}</dd>
          </div>
        </dl>
      </div>
    </PulseShot>
  );
}

/* ===== Plan vs actual ===== */

function differenceOf(line: PlanLine): { readonly text: string; readonly tone: 'good' | 'bad' | 'flat' } {
  const gap = line.actual - line.plan;
  if (gap === 0) return { text: 'Same', tone: 'flat' };
  const isGood = line.kind === 'in' ? gap > 0 : gap < 0;
  return { text: `${money(Math.abs(gap))} ${gap > 0 ? 'over' : 'under'}`, tone: isGood ? 'good' : 'bad' };
}

/** Each step of "Why profit changed" starts where the last one ended, on an axis that starts at zero. */
function waterfall() {
  const scale = Math.max(PLAN_PROFIT.plan, PLAN_PROFIT.actual);
  let running = PLAN_PROFIT.plan;
  return WHY_STEPS.map((step) => {
    const from = Math.min(running, running + step.amount);
    running += step.amount;
    return { ...step, from: from / scale, size: Math.abs(step.amount) / scale };
  });
}

/** Plan vs actual for the work done so far, and the gap in profit split by cause. */
export function PlanVsActualVisual() {
  const scale = Math.max(PLAN_PROFIT.plan, PLAN_PROFIT.actual);
  const profitGap = PLAN_PROFIT.actual - PLAN_PROFIT.plan;

  return (
    <PulseShot slot="plan">
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <div>
            <div className={mock.title}>Quote vs actual</div>
            <div className={mock.sub}>
              For the work done so far · {count(PLAN_PROGRESS.done)} of {count(PLAN_PROGRESS.planned)} units ·
              sample data
            </div>
          </div>
          <StatusPill status="at-risk" />
        </div>

        <table className={`${styles.table} ${styles.planTable}`}>
          <caption className="visually-hidden">
            The quote for the work done so far against what happened. Sample data.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Line</span>
              </th>
              <th scope="col">Quote, for the work done</th>
              <th scope="col">Actual</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <th scope="row">Labor hours</th>
              <td>{count(PLAN_HOURS.plan)}</td>
              <td>{count(PLAN_HOURS.actual)}</td>
              <td data-tone="bad">{count(PLAN_HOURS.actual - PLAN_HOURS.plan)} over</td>
            </tr>
            {PLAN_LINES.map((line) => {
              const difference = differenceOf(line);
              return (
                <tr key={line.label}>
                  <th scope="row">{line.label}</th>
                  <td>{money(line.plan)}</td>
                  <td>{money(line.actual)}</td>
                  <td data-tone={difference.tone}>{difference.text}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <th scope="row">Profit</th>
              <td className={styles.strong}>{money(PLAN_PROFIT.plan)}</td>
              <td className={styles.strong}>{money(PLAN_PROFIT.actual)}</td>
              <td data-tone="bad">{money(Math.abs(profitGap))} lower</td>
            </tr>
          </tfoot>
        </table>
        <p className={styles.tableNote}>
          Other cost is planned in full from the start, so it is not scaled to the units done.
        </p>

        <div className={styles.groupLabel} aria-hidden>
          Why profit changed
        </div>
        <ol className={styles.why} aria-label="Why profit changed">
          <li data-kind="total">
            <span className={styles.whyLabel}>Plan so far</span>
            <span className={styles.whyTrack} aria-hidden>
              <span style={{ '--from': 0, '--size': PLAN_PROFIT.plan / scale } as React.CSSProperties} />
            </span>
            <span className={styles.whyValue}>{money(PLAN_PROFIT.plan)}</span>
          </li>
          {waterfall().map((step) => (
            <li key={step.label} data-kind={step.amount > 0 ? 'up' : step.amount < 0 ? 'down' : 'flat'}>
              <span className={styles.whyLabel}>{step.label}</span>
              <span className={styles.whyTrack} aria-hidden>
                <span style={{ '--from': step.from, '--size': step.size } as React.CSSProperties} />
              </span>
              <span className={styles.whyValue}>{signedMoney(step.amount)}</span>
            </li>
          ))}
          <li data-kind="total">
            <span className={styles.whyLabel}>Actual</span>
            <span className={styles.whyTrack} aria-hidden>
              <span style={{ '--from': 0, '--size': PLAN_PROFIT.actual / scale } as React.CSSProperties} />
            </span>
            <span className={styles.whyValue}>{money(PLAN_PROFIT.actual)}</span>
          </li>
        </ol>
        <p className={styles.reading}>{WHY_READING}</p>
      </div>
    </PulseShot>
  );
}

/* ===== Real cost of an hour ===== */

const RATE_TOKENS = ['--chart-1', '--chart-2', '--chart-3'] as const;

/** The rate builder for one labor class: the wage and what rides on top of it. */
export function CostRatesVisual() {
  return (
    <PulseShot slot="rates">
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <div>
            <div className={mock.title}>New rate for {RATE.laborClass}</div>
            <div className={mock.sub}>Sample data</div>
          </div>
        </div>

        <div className={styles.rateLayout}>
          <div className={styles.rateTotal}>
            <span className={mock.sub}>One hour of a packer really costs</span>
            <span className={`numeral ${styles.rateValue}`}>{moneyCents(REAL_HOUR)}</span>
            <span className={styles.rateAside}>An overtime hour costs {moneyCents(OVERTIME_HOUR)}</span>
          </div>

          <div>
            <div
              className={styles.rateBar}
              role="img"
              aria-label={`The real cost of an hour, ${moneyCents(REAL_HOUR)}, is the wage, plus taxes, benefits and other, plus overhead.`}
            >
              {RATE_PARTS.map((part, i) => (
                <span
                  key={part.label}
                  style={{ flexGrow: part.amount, background: `var(${RATE_TOKENS[i]})` }}
                />
              ))}
            </div>
            <dl className={styles.rateParts}>
              {RATE_PARTS.map((part, i) => (
                <div key={part.label}>
                  <dt>
                    <span
                      className={styles.swatch}
                      style={{ background: `var(${RATE_TOKENS[i]})` }}
                      aria-hidden
                    />
                    <span>
                      {part.label}
                      <span className={styles.partDetail}>{part.detail}</span>
                    </span>
                  </dt>
                  <dd>{moneyCents(part.amount)}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
    </PulseShot>
  );
}

/* ===== Jobs at risk ===== */

/* One scale for every row of the chart, wide enough for a loss and for the best job. */
const MARGIN_AXIS = { min: -25, max: 45 } as const;

function onAxis(margin: number): number {
  return (margin - MARGIN_AXIS.min) / (MARGIN_AXIS.max - MARGIN_AXIS.min);
}

const AXIS_ZERO = onAxis(0);
const AXIS_TARGET = onAxis(TARGET_MARGIN);

interface RiskVisualProps {
  /** Set on the navy band of the Pulse page, so the caption is light. */
  readonly onBrand?: boolean;
  /** Set on the home page, where the picture sits beside the copy. */
  readonly inSideColumn?: boolean;
}

/**
 * The Jobs list, worst first, drawn as one chart: where each open job's margin is heading against
 * the target. Under each bar sit the reason in a sentence and the money at stake.
 */
export function RiskVisual({ onBrand = false, inSideColumn = false }: RiskVisualProps) {
  return (
    <PulseShot slot="risk" onBrand={onBrand} inSideColumn={inSideColumn}>
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <div>
            <div className={mock.title}>Open jobs</div>
            <div className={mock.sub}>One job of each status · sample data</div>
          </div>
        </div>

        <ul className={styles.statusChips} aria-label="Open jobs by status">
          {STATUS_COUNTS.map((item) => (
            <li key={item.status}>
              <StatusPill status={item.status} count={item.jobs} />
            </li>
          ))}
        </ul>

        <p className={styles.marginKey} aria-hidden>
          <span data-part="bar">Projected margin</span>
          <span data-part="dot">Margin now</span>
          <span data-part="target">Your target, {TARGET_MARGIN}%</span>
        </p>

        <ol className={styles.jobList} aria-label="One open job of each status, worst first">
          {OPEN_JOBS.map((job) => (
            <li key={job.code}>
              <div className={styles.jobLine}>
                <JobName code={job.code} name={job.name} />
                <StatusPill status={job.status} />
              </div>
              <MarginTrack job={job} />
              <p className={styles.reason}>{job.reason}</p>
              <JobFacts job={job} />
            </li>
          ))}
        </ol>
      </div>
    </PulseShot>
  );
}

/**
 * One row of the chart: a bar from zero to the projected margin, a dot at the margin so far and a
 * line at the target. A loss is striped as well as red. The figures are in the text under it.
 */
function MarginTrack({ job }: { readonly job: OpenJob }) {
  const axis = { '--zero': AXIS_ZERO, '--target': AXIS_TARGET } as React.CSSProperties;
  if (!job.margin) return <div className={styles.marginTrack} style={axis} data-empty aria-hidden />;

  const { soFar, projected } = job.margin;
  const from = Math.min(AXIS_ZERO, onAxis(projected));
  return (
    <div className={styles.marginTrack} style={axis} aria-hidden>
      <span
        className={styles.marginBar}
        data-loss={projected < 0 || undefined}
        style={{ '--from': from, '--size': Math.abs(onAxis(projected) - AXIS_ZERO) } as React.CSSProperties}
      />
      <span className={styles.marginDot} style={{ '--at': onAxis(soFar) } as React.CSSProperties} />
    </div>
  );
}

/** Margin now, the margin the job is heading for and the money at stake for one open job. */
function JobFacts({ job }: { readonly job: OpenJob }) {
  return (
    <dl className={styles.jobFacts}>
      {job.margin ? (
        <>
          <div>
            <dt>Margin now</dt>
            <dd>{percent(job.margin.soFar)}</dd>
          </div>
          <div>
            <dt>Heading for</dt>
            <dd>{percent(job.margin.projected)}</dd>
          </div>
        </>
      ) : (
        <div>
          <dt>Margin</dt>
          <dd>Not complete yet</dd>
        </div>
      )}
      {job.impact ? (
        <div data-tone="bad">
          <dt>Impact</dt>
          <dd>{job.impact}</dd>
        </div>
      ) : null}
    </dl>
  );
}

/* ===== CSV in and out ===== */

export function CsvVisual() {
  return (
    <PulseShot slot="csv">
      <CsvCheck />
    </PulseShot>
  );
}

/* ===== Connected apps ===== */

const LINKS_BY_APP = [
  {
    id: 'crm',
    name: 'KitStak CRM',
    into: 'A won deal can become a job. Its name, account and value fill in the new job.',
    back: 'A Profit tab on deals and accounts.',
  },
  {
    id: 'wms',
    name: 'KitStak WMS',
    into: 'Kits built on a linked work order come in as units. You add the people and the hours.',
    back: 'A Job profit card on work orders, and a Client profit line on clients.',
  },
  {
    id: 'projects',
    name: 'KitStak Projects',
    into: 'Time logged on a linked project counts as labor hours on the job.',
    back: 'A Job profit strip on the project. Tasks you create from an alert.',
  },
] as const;

/** What comes into Pulse from each KitStak app, and what Pulse shows back inside it. */
export function PulseStackVisual() {
  return (
    <PulseShot slot="stack" onBrand>
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <PulseWordmark height={28} />
        </div>

        <ul className={styles.links}>
          {LINKS_BY_APP.map((link) => (
            <li key={link.id}>
              <div className={styles.linkApp}>
                <AppIcon app={link.id} size={32} />
                <span>{link.name}</span>
              </div>
              <dl className={styles.linkFlow}>
                <div>
                  <dt>
                    <Arrow direction="in" /> Comes into Pulse
                  </dt>
                  <dd>{link.into}</dd>
                </div>
                <div>
                  <dt>
                    <Arrow direction="out" /> Shows in the app
                  </dt>
                  <dd>{link.back}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <p className={mock.caption}>
          One sign-in covers every app. Take any app away and Pulse keeps working.
        </p>
      </div>
    </PulseShot>
  );
}

/* ===== Small glyphs ===== */

function Tick() {
  return (
    <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden>
      <path d="M3 8.5l3 3 7-7" fill="none" stroke="currentColor" strokeWidth="2" />
    </svg>
  );
}

function Arrow({ direction }: { readonly direction: 'in' | 'out' }) {
  return (
    <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden>
      <path
        d={direction === 'in' ? 'M3 8h10M9 4l4 4-4 4' : 'M13 8H3M7 4L3 8l4 4'}
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
