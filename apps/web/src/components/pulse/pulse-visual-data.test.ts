import { describe, expect, it } from 'vitest';
import * as data from './pulse-visual-data';
import { PULSE_SHOTS, PULSE_SHOT_IDS } from './pulse-shots';

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

  it('counts six jobs that need you, lists the worst three, and has 22 open jobs', () => {
    expect(data.NEEDS_YOU_COUNT).toBe(6);
    expect(data.NEEDS_YOU).toHaveLength(3);
    for (const job of data.NEEDS_YOU) expect(['losing-money', 'at-risk']).toContain(job.status);
    expect(data.STATUS_COUNTS.reduce((sum, item) => sum + item.jobs, 0)).toBe(22);
    expect(new Set(data.OPEN_JOBS.map((job) => job.status)).size).toBe(5);
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

  it('builds the real cost of an hour from its parts', () => {
    expect(data.REAL_HOUR).toBe(21.76);
    expect(data.OVERTIME_HOUR).toBe(30.48);
    expect(data.CREW_DAY_HOURS).toBe(96);
    expect(data.CREW_DAY_COST).toBe(2123.84);
    expect(data.MATERIAL_COST).toBe(1377);
    expect(data.MATERIAL_SCRAP_COST).toBe(27);
  });

  it('keeps the days logged on J-1012 inside its month of money in at $2.75 a unit', () => {
    const monthUnits = data.PROFIT_VIEWS[0]!.rows.find((row) => row.code === 'J-1012')!.moneyIn / 2.75;
    const logged = data.LOG_ROWS.find((row) => row.code === 'J-1012')!.units;
    const imported = Number(data.CSV_PREVIEW.find((row) => row.job === 'J-1012')!.units.replace(',', ''));
    expect(monthUnits).toBe(2400);
    expect(logged + imported).toBeLessThanOrEqual(monthUnits);
  });

  it('lists 17 CSV streams and a check that covers every row of the file', () => {
    expect(data.CSV_STREAMS).toHaveLength(17);
    expect(new Set(data.CSV_STREAMS).size).toBe(17);
    expect(data.CSV_ROWS).toBe(214);
  });

  it('uses no em dash, en dash or double hyphen in any string', () => {
    const banned = new RegExp(`[${String.fromCharCode(0x2014, 0x2013)}]|-{2}`);
    const text = JSON.stringify({ ...data, PULSE_SHOTS });
    expect(banned.test(text)).toBe(false);
  });
});

describe('pulse screenshot slots', () => {
  it('has one slot per visual, each with a light and a dark file under /pulse/shots/', () => {
    expect(PULSE_SHOT_IDS).toHaveLength(9);
    for (const id of PULSE_SHOT_IDS) {
      const shot = PULSE_SHOTS[id];
      expect(shot.light).toMatch(/^\/pulse\/shots\/[a-z-]+-light\.png$/);
      expect(shot.dark).toMatch(/^\/pulse\/shots\/[a-z-]+-dark\.png$/);
      expect(shot.alt.length).toBeGreaterThan(20);
      expect(shot.width).toBeGreaterThan(0);
      expect(shot.height).toBeGreaterThan(0);
    }
  });
});
