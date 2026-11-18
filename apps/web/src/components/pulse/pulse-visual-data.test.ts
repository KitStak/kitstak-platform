import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { COSTS, CSV_STREAMS, IMPORT_COUNTERS, MATH_JOB, PROFIT_TABS, STATUSES } from './pulse-content';
import * as data from './pulse-visual-data';
import { PULSE_SHOTS, PULSE_SHOT_IDS, PULSE_SHOT_THEMES, SIDE_COLUMN_VIEWS, shotFile } from './pulse-shots';

/** The sample data on the Pulse page must add up, the way the product's own numbers do. */
describe('pulse visual data', () => {
  it('matches the month in the spec: $48,210 profit on jobs at a 31% margin', () => {
    expect(data.MONTH).toEqual({ moneyIn: 155516, moneyOut: 107306, profit: 48210, margin: 31 });
  });

  it('adds up to the same total in every profit view', () => {
    for (const view of data.PROFIT_VIEWS) {
      expect(data.totalOf(view.rows), view.id).toEqual(data.MONTH);
    }
  });

  it('keeps a job and its client in step when the client has one job in the month', () => {
    const job = data.PROFIT_VIEWS[0]!.rows.find((row) => row.code === 'J-1012');
    const client = data.PROFIT_VIEWS[1]!.rows.find((row) => row.name === 'Harbor Roast Collective');
    expect(job?.profit).toBe(client?.profit);
    expect(job?.moneyIn).toBe(client?.moneyIn);
  });

  it('walks from profit on jobs to company profit', () => {
    expect(data.COMPANY_PROFIT).toBe(39900);
  });

  it('counts seven jobs that need you, lists the worst three, and has 23 open jobs', () => {
    expect(data.NEEDS_YOU_COUNT).toBe(7);
    expect(data.NEEDS_YOU).toHaveLength(3);
    for (const job of data.NEEDS_YOU) expect(['losing-money', 'at-risk']).toContain(job.status);
    expect(data.STATUS_COUNTS.reduce((sum, item) => sum + item.jobs, 0)).toBe(23);
    expect(new Set(data.OPEN_JOBS.map((job) => job.status)).size).toBe(5);
  });

  it('lists the statuses in the order of the chips on the real Jobs page, with the same words', () => {
    const order = ['losing-money', 'at-risk', 'not-enough-data', 'heads-up', 'on-track'];
    expect(Object.keys(data.STATUS)).toEqual(order);
    expect(data.STATUS_COUNTS.map((item) => item.status)).toEqual(order);
    expect(data.OPEN_JOBS.map((job) => job.status)).toEqual(order);
    expect(Object.values(data.STATUS).map((status) => status.label)).toEqual(STATUSES);
  });

  it('names the profit tabs and plan rows as the real screens do', () => {
    expect(data.PROFIT_VIEWS.map((view) => view.tab)).toEqual(PROFIT_TABS.slice(0, 4));
    expect(data.PLAN_LINES.map((line) => line.label)).toEqual([
      ...COSTS.slice(0, 2),
      COSTS[2],
      COSTS[3],
      'Revenue',
    ]);
    const text = JSON.stringify(data);
    expect(text).not.toMatch(/Money in|Money out/);
  });

  it('keeps the margins on the open jobs list in step with the Profit table and the reasons', () => {
    const jobs = data.PROFIT_VIEWS[0]!.rows;
    for (const code of ['J-1012', 'J-1005']) {
      const row = jobs.find((job) => job.code === code)!;
      const open = data.OPEN_JOBS.find((job) => job.code === code)!;
      expect(open.margin?.soFar, code).toBe(data.marginOf(row.profit, row.moneyIn));
    }
    // J-1012 ends $1,840 in the red on $9,200 at finish, the same margin as so far.
    expect(data.marginOf(-1840, 9200)).toBe(data.OPEN_JOBS[0]!.margin?.projected);
    expect(data.OPEN_JOBS[0]!.impact).toContain('$1,840');
    // J-1023 is heading for 14% on $16,000. A 30% target is $4,800, so it is $2,560 under.
    const atRisk = data.OPEN_JOBS.find((job) => job.status === 'at-risk')!;
    expect(atRisk.margin?.projected).toBe(14);
    expect(data.money(16000 * 0.3 - 16000 * 0.14)).toBe('$2,560');
    expect(atRisk.impact).toContain('$2,560');
    // Every reason that names a target names the one the chart draws.
    expect(data.TARGET_MARGIN).toBe(30);
    for (const job of data.OPEN_JOBS) {
      for (const match of job.reason.matchAll(/(\d+)% target|target is (\d+)%/g)) {
        expect(Number(match[1] ?? match[2]), job.code).toBe(data.TARGET_MARGIN);
      }
    }
    // A job with profit that is not complete shows no margin.
    expect(data.OPEN_JOBS.find((job) => job.status === 'not-enough-data')!.margin).toBeUndefined();
  });

  it('splits every dollar of revenue into cost and profit that add up to 100', () => {
    expect(data.splitOf(data.MONTH.moneyIn, data.MONTH.moneyOut)).toEqual({ out: 69, profit: 31 });
    expect(data.splitOf(700_000, 543_500)).toEqual({ out: 78, profit: 22 });
  });

  it('adds crew lines up to the people on the row', () => {
    for (const row of data.LOG_ROWS) {
      if (row.crew) expect(row.crew.reduce((sum, line) => sum + line.people, 0)).toBe(row.people);
    }
    expect(data.LOG_TOTAL).toEqual({ units: 7184, hours: 184 });
    expect(data.LOG_ROWS.map((row) => data.paceOf(row.units, data.laborHours(row)))).toEqual([
      45, 31, 38, 25,
    ]);
  });

  it('splits the gap between plan and actual exactly', () => {
    expect(data.PLAN_PROFIT).toEqual({ plan: 1800, actual: 1565 });
    const gap = data.WHY_STEPS.reduce((sum, step) => sum + step.amount, 0);
    expect(gap).toBe(data.PLAN_PROFIT.actual - data.PLAN_PROFIT.plan);
  });

  it('explains the 25% in the worked job with a labor hours row, apart from labor dollars', () => {
    expect(data.PLAN_HOURS).toEqual(MATH_JOB.laborHours);
    expect((data.PLAN_HOURS.actual / data.PLAN_HOURS.plan - 1) * 100).toBe(25);
    const labor = data.PLAN_LINES.find((line) => line.label === 'Labor cost')!;
    expect(labor.actual * 100).toBe(MATH_JOB.moneyOut[0].cents);
    // Labor dollars are 31% over, because the hour also cost more: $125 of rate and $550 of hours.
    expect(Math.round((labor.actual / labor.plan - 1) * 100)).toBe(31);
    expect(labor.actual - labor.plan).toBe(125 + 550);
  });

  it('builds the real cost of an hour from its parts, the way the real rate dialog reads', () => {
    // Wage $17.15, 21% on top ($3.60), overhead $5.50: $26.25. An overtime hour: $35.60.
    expect(data.ON_TOP_PERCENT).toBe(21);
    expect(data.RATE_PARTS.map((part) => part.amount)).toEqual([17.15, 3.6, 5.5]);
    expect(data.RATE_PARTS.map((part) => part.label)).toEqual([
      'Wage',
      'Taxes, benefits and other',
      'Overhead',
    ]);
    expect(data.REAL_HOUR).toBe(26.25);
    expect(data.OVERTIME_HOUR).toBe(35.6);
  });

  it('keeps the days logged on J-1012 inside its month of revenue at $2.75 a unit', () => {
    const monthUnits = data.PROFIT_VIEWS[0]!.rows.find((row) => row.code === 'J-1012')!.moneyIn / 2.75;
    const logged = data.LOG_ROWS.find((row) => row.code === 'J-1012')!.units;
    const imported = Number(data.CSV_PREVIEW.find((row) => row.job === 'J-1012')!.units.replace(',', ''));
    expect(monthUnits).toBe(2400);
    expect(logged + imported).toBeLessThanOrEqual(monthUnits);
  });

  it('lists 17 CSV streams and a check that covers every row of the file', () => {
    expect(data.CSV_STREAMS).toHaveLength(17);
    expect(new Set(data.CSV_STREAMS).size).toBe(17);
    expect([...data.CSV_STREAMS].sort()).toEqual([...CSV_STREAMS].sort());
    // The six counters of step 3, as the real screen names them, for the 18 row sample file.
    expect(data.CSV_CHECK.map((item) => item.label)).toEqual(IMPORT_COUNTERS);
    expect(data.CSV_CHECK.map((item) => item.rows)).toEqual([8, 2, 7, 0, 0, 1]);
    expect(data.CSV_ROWS).toBe(18);
    expect(data.CSV_PROBLEM.message).toBe('9x is not a number of hours. Use 7.5 or 7:30.');
  });

  it('uses no em dash, en dash or double hyphen in any string', () => {
    const banned = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]|-{2}`);
    const text = JSON.stringify({ ...data, PULSE_SHOTS });
    expect(banned.test(text)).toBe(false);
  });
});

describe('pulse screenshot slots', () => {
  it('has one slot per visual, each with alt text, a caption label and a desktop view', () => {
    expect(PULSE_SHOT_IDS).toHaveLength(9);
    for (const id of PULSE_SHOT_IDS) {
      const shot = PULSE_SHOTS[id];
      expect(shot.alt.length, id).toBeGreaterThan(20);
      expect(shot.label.length, id).toBeGreaterThan(0);
      expect(shot.views.at(-1)?.upTo, id).toBeUndefined();
      for (const view of shot.views) {
        expect(view.width, id).toBeGreaterThan(0);
        expect(view.height, id).toBeGreaterThan(0);
        // The largest file is sharp on a screen with two device pixels per CSS pixel.
        expect(view.widths.at(-1), id).toBeGreaterThanOrEqual(view.width * 1.6);
      }
    }
  });

  it('has every file of a ready slot on disk, light and dark, and none over 200 KB', () => {
    for (const id of PULSE_SHOT_IDS) {
      const shot = PULSE_SHOTS[id];
      if (!shot.ready) continue;
      // The Jobs slot is also shown in a side column, with a view made for it.
      const views = id === 'risk' ? [...shot.views, ...SIDE_COLUMN_VIEWS] : shot.views;
      for (const view of views) {
        for (const theme of PULSE_SHOT_THEMES) {
          const files = [
            ...view.widths.map((width) => shotFile(shot, view, theme, width, 'avif')),
            shotFile(shot, view, theme, view.widths[0] ?? 0, 'webp'),
          ];
          for (const file of files) {
            expect(file).toMatch(
              /^\/pulse\/shots\/[a-z-]+-(desktop|tablet|phone|close)-(light|dark)-\d+\.(avif|webp)$/,
            );
            const onDisk = path.join(process.cwd(), 'public', file);
            expect(existsSync(onDisk), file).toBe(true);
            expect(statSync(onDisk).size, file).toBeLessThan(200 * 1024);
          }
        }
      }
    }
  });
});
