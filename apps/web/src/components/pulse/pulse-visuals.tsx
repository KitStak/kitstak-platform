import { AppIcon } from '../app-icon';
import mock from '../mock/mock.module.css';
import { PulseShot } from './pulse-shot';
import { CsvCheck } from './pulse-visual-csv';
import {
  COMPANY_PROFIT,
  CREW_DAY,
  CREW_DAY_COST,
  CREW_DAY_HOURS,
  LOG_DAY,
  LOG_ROWS,
  LOG_TOTAL,
  MATERIAL,
  MATERIAL_COST,
  MATERIAL_SCRAP_COST,
  MONTH,
  NEEDS_YOU,
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
  WHY_READING,
  WHY_STEPS,
  count,
  laborHours,
  money,
  moneyCents,
  paceOf,
  percent,
  signedMoney,
  type PlanLine,
} from './pulse-visual-data';
import { JobName, PortalIcon, PulseIcon, PulseLoader, PulseWordmark, StatusPill } from './pulse-visual-parts';
import { ProfitExplorer } from './pulse-visual-profit';
import styles from './pulse-visuals.module.css';

/*
 * The nine visuals of the Pulse page. Each one is a small coded piece of the real screen with sample
 * data, wrapped in a PulseShot slot. When a slot is marked ready in pulse-shots.ts the real product
 * screenshot takes its place.
 */

/* ===== Hero: Home ===== */

const OUT_SHARE = Math.round((MONTH.moneyOut / MONTH.moneyIn) * 100);
const PROFIT_SHARE = 100 - OUT_SHARE;

const HOME_TILES = [
  { label: 'Money in', value: money(MONTH.moneyIn) },
  { label: 'Money out', value: money(MONTH.moneyOut) },
  { label: 'Profit on jobs', value: money(MONTH.profit) },
  { label: 'Company profit', value: money(COMPANY_PROFIT) },
] as const;

/** Home: the answer in words, the month in four numbers and the jobs that need you. */
export function PulseHeroVisual() {
  return (
    <PulseShot slot="hero">
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <PulseWordmark height={48} />
          <div className={mock.sub}>{PERIOD} · sample data</div>
        </div>

        <p className={styles.answer}>
          Your jobs made <strong>{money(MONTH.profit)}</strong> this month at a{' '}
          <strong>{percent(MONTH.margin, 0)} margin</strong>. After time not on a job and overhead, the
          company made <strong>{money(COMPANY_PROFIT)}</strong>. {NEEDS_YOU.length} jobs need you.
        </p>

        <dl className={styles.tiles}>
          {HOME_TILES.map((tile) => (
            <div key={tile.label}>
              <dt>{tile.label}</dt>
              <dd className="numeral">{tile.value}</dd>
            </div>
          ))}
        </dl>

        <div
          className={styles.splitBar}
          role="img"
          aria-label={`Of every dollar that came in, ${OUT_SHARE} cents went out and ${PROFIT_SHARE} cents stayed as profit on jobs.`}
        >
          <span style={{ flexGrow: OUT_SHARE }} data-part="out" />
          <span style={{ flexGrow: PROFIT_SHARE }} data-part="profit" />
        </div>
        <div className={styles.splitKey} aria-hidden>
          <span data-part="out">Money out {OUT_SHARE}%</span>
          <span data-part="profit">Profit {PROFIT_SHARE}%</span>
        </div>

        <div className={styles.groupLabel} aria-hidden>
          Jobs that need you
        </div>
        <ul className={styles.jobList} aria-label="Jobs that need you">
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
            <div className={mock.sub}>{LOG_DAY} · Main Fulfillment · sample data</div>
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
                            {line.people} {line.laborClass.toLowerCase()}
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
                          : `${isOnPace ? 'Above' : 'Below'} target ${row.targetPace}`}
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
        <p className={mock.caption}>
          Floor leads see units, hours and pace. Money shows only for people you choose.
        </p>
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
            <div className={mock.title}>Plan vs actual</div>
            <div className={mock.sub}>
              For the work done so far · {count(PLAN_PROGRESS.done)} of {count(PLAN_PROGRESS.planned)} units ·
              sample data
            </div>
          </div>
          <StatusPill status="at-risk" />
        </div>

        <table className={`${styles.table} ${styles.planTable}`}>
          <caption className="visually-hidden">
            The plan for the work done so far against what happened. Labor took {PLAN_HOURS.actual} hours. The
            plan was {PLAN_HOURS.plan}. Sample data.
          </caption>
          <thead>
            <tr>
              <th scope="col">
                <span className="visually-hidden">Line</span>
              </th>
              <th scope="col">Plan</th>
              <th scope="col">Actual</th>
              <th scope="col">Difference</th>
            </tr>
          </thead>
          <tbody>
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

        <div className={styles.groupLabel} aria-hidden>
          Why profit changed
        </div>
        <ol className={styles.why} aria-label="Why profit changed">
          <li data-kind="total">
            <span className={styles.whyLabel}>Planned profit</span>
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
            <span className={styles.whyLabel}>Actual profit</span>
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

/* ===== Real cost of an hour, material cost ===== */

const RATE_TOKENS = ['--chart-1', '--chart-2', '--chart-3', '--chart-4'] as const;

/** The rate builder for one labor class, and material cost by who buys the parts. */
export function CostRatesVisual() {
  const usedUnits = MATERIAL.goodUnits + MATERIAL.scrapUnits;
  return (
    <PulseShot slot="rates">
      <div className={styles.pair}>
        <div className={`${mock.panel} ${styles.frame}`} data-lifted>
          <div className={`${mock.head} ${styles.head}`}>
            <div>
              <div className={mock.title}>Real cost of an hour</div>
              <div className={mock.sub}>{RATE.laborClass} · rate builder · sample data</div>
            </div>
          </div>

          <div className={styles.rateLayout}>
            <div className={styles.rateTotal}>
              <span className={mock.sub}>One hour really costs</span>
              <span className={`numeral ${styles.rateValue}`}>{moneyCents(REAL_HOUR)}</span>
              <span className={styles.rateAside}>Overtime hour {moneyCents(OVERTIME_HOUR)}</span>
            </div>

            <div>
              <div
                className={styles.rateBar}
                role="img"
                aria-label={`The real cost of an hour, ${moneyCents(REAL_HOUR)}, is the wage plus payroll taxes, benefits and overhead.`}
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

          <p className={mock.caption}>
            {CREW_DAY.people} packers for {CREW_DAY.hoursEach} hours each, {CREW_DAY.overtimeHours} of the
            hours overtime: {CREW_DAY_HOURS} labor hours cost {moneyCents(CREW_DAY_COST)}.
          </p>
        </div>

        <div className={`${mock.panel} ${styles.frame} ${styles.pairSecond}`}>
          <div className={styles.cardHead}>
            <span className={mock.title}>Material cost</span>
            <span className={mock.sub}>Who buys the parts · sample data</span>
          </div>
          <table className={`${styles.table} ${styles.materialTable}`}>
            <caption className="visually-hidden">
              Material cost for the same {count(usedUnits)} units, by who buys the parts. Sample data.
            </caption>
            <thead>
              <tr>
                <th scope="col">Who buys the parts</th>
                <th scope="col" className={styles.wideOnly}>
                  Used
                </th>
                <th scope="col">Scrap</th>
                <th scope="col">Cost</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th scope="row">
                  You buy them
                  <span className={styles.partDetail}>{moneyCents(MATERIAL.unitCost)} a unit</span>
                </th>
                <td className={styles.wideOnly}>{count(usedUnits)}</td>
                <td>
                  {MATERIAL.scrapUnits}
                  <span className={styles.partDetail}>{moneyCents(MATERIAL_SCRAP_COST)}</span>
                </td>
                <td className={styles.strong}>{moneyCents(MATERIAL_COST)}</td>
              </tr>
              <tr>
                <th scope="row">
                  The client owns them
                  <span className={styles.partDetail}>Counted in units</span>
                </th>
                <td className={styles.wideOnly}>{count(usedUnits)}</td>
                <td>{MATERIAL.scrapUnits}</td>
                <td className={styles.strong}>{moneyCents(0)}</td>
              </tr>
            </tbody>
          </table>
        </div>
      </div>
    </PulseShot>
  );
}

/* ===== Jobs at risk ===== */

/** The Jobs list, worst first: a status, the reason in a sentence and a next step. */
export function RiskVisual() {
  return (
    <PulseShot slot="risk">
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <div>
            <div className={mock.title}>Open jobs</div>
            <div className={mock.sub}>Worst first · sample data</div>
          </div>
        </div>

        <ul className={styles.statusChips} aria-label="Open jobs by status">
          {STATUS_COUNTS.map((item) => (
            <li key={item.status}>
              <StatusPill status={item.status} count={item.jobs} />
            </li>
          ))}
        </ul>

        <ol className={styles.jobList} aria-label="Open jobs, worst first">
          {OPEN_JOBS.map((job) => (
            <li key={job.code}>
              <div className={styles.jobLine}>
                <JobName code={job.code} name={job.name} />
                <StatusPill status={job.status} />
              </div>
              <p className={styles.reason}>{job.reason}</p>
              {job.nextStep ? (
                <p className={styles.nextStep}>
                  <span>Next step</span> {job.nextStep}
                </p>
              ) : null}
            </li>
          ))}
        </ol>
      </div>
    </PulseShot>
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
    into: 'A won deal becomes a job, with the client, quote and start date filled in.',
    back: 'A Profit tab on deals and accounts.',
  },
  {
    id: 'wms',
    name: 'KitStak WMS',
    into: 'Work orders become jobs. Finished kits and parts used come in. A person adds the hours.',
    back: 'A Job profit card on the work order.',
  },
  {
    id: 'projects',
    name: 'KitStak Projects',
    into: 'Time logged on a linked project counts as labor hours on the job.',
    back: 'A Job profit strip on the project. Tasks you create from an alert.',
  },
  {
    id: 'portal',
    name: 'KitStak Portal',
    into: 'One sign-in and one app switcher for every app.',
    back: 'A Pulse tile with open jobs, jobs at risk and jobs losing money.',
  },
] as const;

/** What comes into Pulse from each KitStak app, and what Pulse shows back inside it. */
export function PulseStackVisual() {
  return (
    <PulseShot slot="stack">
      <div className={`${mock.panel} ${styles.frame}`} data-lifted>
        <div className={`${mock.head} ${styles.head}`}>
          <PulseWordmark height={36} />
          <div className={styles.sync}>
            <PulseLoader size={34} />
            <span>Keeps in step within minutes</span>
          </div>
        </div>

        <ul className={styles.links}>
          {LINKS_BY_APP.map((link) => (
            <li key={link.id}>
              <div className={styles.linkApp}>
                {link.id === 'portal' ? <PortalIcon size={32} /> : <AppIcon app={link.id} size={32} />}
                <span>{link.name}</span>
              </div>
              <dl className={styles.linkFlow}>
                <div>
                  <dt>
                    <Arrow direction="in" /> Into Pulse
                  </dt>
                  <dd>{link.into}</dd>
                </div>
                <div>
                  <dt>
                    <Arrow direction="out" /> Shows up there
                  </dt>
                  <dd>{link.back}</dd>
                </div>
              </dl>
            </li>
          ))}
        </ul>
        <p className={mock.caption}>
          Pulse copies what it needs and never changes your CRM or WMS data. Take any app away and Pulse keeps
          working.
        </p>
      </div>
    </PulseShot>
  );
}

/* ===== On its own or in the bundle ===== */

const ALONE_POINTS = [
  'Type the work in, or import a CSV file',
  'Every screen works with no other app',
  'Export everything any time',
] as const;

const BUNDLE_POINTS = [
  'Jobs start from won deals in the CRM',
  'Units and parts used come from the WMS',
  'Project time counts as labor hours',
  'Job profit shows inside the other apps',
] as const;

/** Two ways to run Pulse: by itself with CSV in and out, or linked to the other KitStak apps. */
export function PulseBundleVisual() {
  return (
    <PulseShot slot="bundle">
      <div className={styles.modes}>
        <div className={`${mock.panel} ${styles.frame}`}>
          <div className={styles.modeHead}>
            <span className={styles.modeIcons}>
              <PulseIcon size={36} />
            </span>
            <span className={mock.title}>Pulse on its own</span>
          </div>
          <ul className={styles.points}>
            {ALONE_POINTS.map((point) => (
              <li key={point}>
                <Tick /> {point}
              </li>
            ))}
          </ul>
        </div>

        <div className={`${mock.panel} ${styles.frame}`} data-lifted>
          <div className={styles.modeHead}>
            <span className={styles.modeIcons}>
              <PulseIcon size={36} />
              <PortalIcon size={36} />
              <AppIcon app="crm" size={36} />
              <AppIcon app="wms" size={36} />
              <AppIcon app="projects" size={36} />
            </span>
            <span className={mock.title}>Pulse in the bundle</span>
          </div>
          <ul className={styles.points}>
            {BUNDLE_POINTS.map((point) => (
              <li key={point}>
                <Tick /> {point}
              </li>
            ))}
          </ul>
        </div>
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
