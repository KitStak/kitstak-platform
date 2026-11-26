import { describe, expect, it } from 'vitest';
import type { ProgramDaysDTO, ProgramDayRowDTO, ProgramFiguresDTO, ProgramHeaderDTO, ProgramMonthDTO, ProgramMonthMetaDTO, ProgramVariantRowDTO, ProgramVariantsDTO } from '@/lib/program-types';
import type { ReportCell } from '@/lib/types';
import { FINAL_MONTH_NOTE, OPEN_MONTH_NOTE, buildProgramReport, programReportFileName, type ProgramReportDTO, type ProgramReportInput, type ProgramReportTable } from './program-report';
import { programReportToCsv, programReportToHtml } from './program-report-format';
import { programReportToPdf, textWidth, winAnsiCodes } from './program-report-pdf';

const header: ProgramHeaderDTO = {
  programId: 'p1',
  key: 'GLOVE',
  name: 'Glove kitting',
  status: 'active',
  statusLabel: 'Running',
  deleted: false,
  readOnly: false,
  customerName: 'Gripwell Safety Supply',
  unit: { singular: 'kit', plural: 'kits' },
  timezone: 'America/Chicago',
  client: { id: 'c1', name: 'Gripwell Safety Supply' },
  job: { id: 'j1', number: 'J-1040', name: 'Gripwell glove kitting program', path: '/jobs/J-1040?view=job' },
  cardVersion: 2,
  projectsPath: '/programs/GLOVE',
  path: '/programs/GLOVE',
};

const meta: ProgramMonthMetaDTO = { month: '2026-11', asOf: '2026-11-26', closed: false, when: 'current' };

const figures: ProgramFiguresDTO = {
  units: '1500.000',
  scrap: '5.000',
  hours: '32.00',
  unitsPerHour: '46.875',
  revenueCents: 400000,
  workRevenueCents: 350000,
  feeCents: 50000,
  laborCents: 96000,
  materialCents: 15000,
  otherCents: 1500,
  sharedCents: 3000,
  costCents: 115500,
  profitCents: 284500,
  marginBp: 7113,
  revenuePerUnitCents: 267,
  costPerUnitCents: 77,
  profitPerUnitCents: 190,
  daysWithUnits: 2,
};

function variant(row: Partial<ProgramVariantRowDTO> & Pick<ProgramVariantRowDTO, 'name'>): ProgramVariantRowDTO {
  return { variantId: row.name, key: null, sku: null, color: null, retired: false, plannedUnits: null, units: '0.000', scrap: '0.000', hours: '0.00', revenueCents: 0, laborCents: 0, materialCents: 0, otherCents: 0, sharedCents: 0, costCents: 0, profitCents: 0, marginBp: null, profitPerUnitCents: null, revenueShareBp: null, ...row };
}

const variants: ProgramVariantsDTO = {
  header,
  month: meta,
  variants: [
    variant({ name: 'XL Brown', sku: 'GLOVE-XL-BRN', plannedUnits: '1200.000', units: '1000.000', scrap: '5.000', hours: '20.00', revenueCents: 250000, laborCents: 60000, materialCents: 10000, sharedCents: 2000, costCents: 72000, profitCents: 178000, marginBp: 7120, profitPerUnitCents: 178, revenueShareBp: 6250 }),
    variant({ name: 'Small Yellow', sku: 'GLOVE-S-YLW', plannedUnits: '600.000', units: '500.000', hours: '10.00', revenueCents: 100000, laborCents: 30000, materialCents: 5000, otherCents: 1000, sharedCents: 1000, costCents: 37000, profitCents: 63000, marginBp: 6300, profitPerUnitCents: 126, revenueShareBp: 2500 }),
  ],
  fees: { totalCents: 50000, byKind: [{ kind: 'fee', cents: 50000 }] },
  notTiedToVariant: variant({ variantId: null, name: 'Not tied to a variant', hours: '2.00', laborCents: 6000, otherCents: 500, costCents: 6500, profitCents: -6500, revenueShareBp: 0 }),
  total: figures,
  moneyHidden: false,
};

function day(row: Partial<ProgramDayRowDTO> & Pick<ProgramDayRowDTO, 'date'>): ProgramDayRowDTO {
  return { workDay: true, plannedUnits: '0.000', units: '0.000', scrap: '0.000', hours: '0.00', unitsPerHour: null, revenueCents: 0, costCents: 0, profitCents: 0, missingHours: false, addHoursPath: `/log?date=${row.date}&job=J-1040`, ...row };
}

const days: ProgramDaysDTO = {
  header,
  month: meta,
  days: [
    day({ date: '2026-11-01', workDay: false, revenueCents: 50000, profitCents: 50000 }),
    day({ date: '2026-11-02', plannedUnits: '900.000', units: '900.000', scrap: '5.000', hours: '18.00', revenueCents: 200000, costCents: 60000, profitCents: 140000 }),
    day({ date: '2026-11-03', plannedUnits: '900.000', units: '600.000', hours: '14.00', revenueCents: 150000, costCents: 55500, profitCents: 94500 }),
  ],
  moneyHidden: false,
};

const month: ProgramMonthDTO = {
  header,
  month: meta,
  figures,
  plan: { asOf: '2026-11-26', builtUnits: '1500.000', plannedUnits: '1800.000', forecastCents: 480000, forecastMethod: 'planned', targetCents: 450000, minimumCents: 300000, projectedGapCents: 0, actualCents: 400000 },
  costForecast: null,
  target: { targetMarginBp: 3000, source: 'client', clientId: 'c1', clientPath: '/clients/c1' },
  parity: { status: 'matches', visible: true, diffCents: 0, projectsCents: 400000, pulseCents: 400000, pendingSince: null, lastSyncAt: null, canSync: true },
  alerts: [{ rule: 'P1', sentence: 'GLOVE is heading for a 18% margin this month. The target is 30%.', action: 'see_variants', actionLabel: 'See by variant', variantId: null }],
  health: 'at_risk',
  chart: [],
  moneyHidden: false,
};

const input: ProgramReportInput = { month, variants, days };
const AT = '2026-11-26T15:04:00.000Z';

const table = (report: ProgramReportDTO, id: ProgramReportTable['id']): ProgramReportTable => {
  const found = report.tables.find((item) => item.id === id);
  if (!found) throw new Error(`no ${id} table`);
  return found;
};

/** Exact sum of one money column over the rows of a table. */
const sumColumn = (rows: ProgramReportTable['rows'], key: string): number => rows.reduce((sum, row) => sum + Number((row.cells[key] as ReportCell) ?? 0), 0);

/** The words of the HTML page a person reads: no style sheet, no tags. */
const pageText = (html: string): string => html.replace(/<style>[\s\S]*?<\/style>/, '').replace(/<[^>]+>/g, ' ');

/** The text drawn on the PDF pages, from its `(...) Tj` strings. */
const pdfText = (bytes: Uint8Array): string =>
  [...new TextDecoder('latin1').decode(bytes).matchAll(/\(((?:[^()\\]|\\.)*)\) Tj/g)].map((match) => match[1]!.replace(/\\([()\\])/g, '$1').replace(/\\(\d{3})/g, (_, code: string) => String.fromCharCode(Number.parseInt(code, 8)))).join('\n');

describe('monthly program report', () => {
  it('internal totals equal the program page to the cent', () => {
    const report = buildProgramReport(input, 'internal', { generatedAt: AT });
    const summary = Object.fromEntries(report.summary.map((item) => [item.key, item.value]));
    expect(summary).toMatchObject({ built: 1500, planned: 1800, revenue: figures.revenueCents, labor: figures.laborCents, material: figures.materialCents, other: 4500, profit: figures.profitCents, margin: figures.marginBp });

    const byVariant = table(report, 'variants');
    expect(byVariant.rows.map((row) => row.cells.name)).toEqual(['XL Brown (GLOVE-XL-BRN)', 'Small Yellow (GLOVE-S-YLW)', 'Program fees', 'Not tied to a variant']);
    expect(byVariant.total).toMatchObject({ revenue: figures.revenueCents, labor: figures.laborCents, material: figures.materialCents, other: 4500, profit: figures.profitCents, margin: figures.marginBp, built: 1500, scrap: 5 });
    // Rows, fees and the not tied row add up to the total, which is the Overview.
    for (const key of ['revenue', 'labor', 'material', 'other', 'profit']) expect(sumColumn(byVariant.rows, key)).toBe(byVariant.total?.[key]);

    const byDay = table(report, 'days');
    expect(byDay.total).toMatchObject({ revenue: figures.revenueCents, cost: figures.costCents, profit: figures.profitCents, built: 1500, hours: 32 });
    for (const key of ['revenue', 'cost', 'profit', 'built']) expect(sumColumn(byDay.rows, key)).toBe(byDay.total?.[key]);
    expect(byDay.rows[0]?.cells.day).toBe('Sun, Nov 1 (day off)');
  });

  it('internal notes carry the minimum and the alerts that fired', () => {
    const report = buildProgramReport(input, 'internal', { generatedAt: AT });
    expect(report.notes).toEqual(['The monthly minimum is $3,000.00. The month is on pace to meet it.', 'Alert: GLOVE is heading for a 18% margin this month. The target is 30%.']);
    const quiet = buildProgramReport({ ...input, month: { ...month, alerts: [], plan: { ...month.plan!, projectedGapCents: 124000 } } }, 'internal', { generatedAt: AT });
    expect(quiet.notes).toEqual(['May miss the $3,000.00 minimum by $1,240.00.', 'No alerts fired this month.']);
  });

  it('the customer version never holds cost, labor, profit or margin', () => {
    const report = buildProgramReport(input, 'customer', { generatedAt: AT });
    const forbidden = /cost|labor|labour|profit|margin/i;
    const json = JSON.stringify(report);
    expect(json).not.toMatch(forbidden);
    const csv = programReportToCsv(report, { orgName: 'Northwind Robotics' });
    expect(csv).not.toMatch(forbidden);
    expect(pageText(programReportToHtml(report, { orgName: 'Northwind Robotics' }))).not.toMatch(forbidden);
    expect(pdfText(programReportToPdf(report, { orgName: 'Northwind Robotics' }))).not.toMatch(forbidden);
    // Not as numbers either: no cost, labor or profit amount appears anywhere.
    for (const cents of [figures.costCents, figures.laborCents, figures.profitCents, figures.materialCents, 72000, 37000, 178000, 63000, 6500, 60000, 55500, 140000, 94500]) {
      const plain = (cents! / 100).toFixed(2);
      const money = `$${(cents! / 100).toLocaleString('en-US', { minimumFractionDigits: 2 })}`;
      expect(csv).not.toContain(`,${plain}`);
      expect(json).not.toContain(`:${cents}`);
      expect(pageText(programReportToHtml(report, { orgName: 'Northwind Robotics' }))).not.toContain(money);
    }
    // And no alert, since alert sentences talk about margin.
    expect(report.notes.some((note) => note.startsWith('Alert'))).toBe(false);
  });

  it('the customer version keeps kits against planned, revenue by variant, fees and the minimum', () => {
    const report = buildProgramReport(input, 'customer', { generatedAt: AT });
    expect(report.summary.map((item) => item.label)).toEqual(['Kits built', 'Planned', 'Revenue', 'Program fees', 'Monthly minimum']);
    const byVariant = table(report, 'variants');
    expect(byVariant.columns.map((column) => column.label)).toEqual(['Variant', 'Planned', 'Built', 'Scrap', 'Revenue', 'Share of revenue']);
    expect(byVariant.total).toMatchObject({ revenue: figures.revenueCents, built: 1500, planned: 1800 });
    expect(sumColumn(byVariant.rows, 'revenue')).toBe(figures.revenueCents);
    const byDay = table(report, 'days');
    expect(byDay.columns.map((column) => column.label)).toEqual(['Day', 'Planned', 'Built', 'Scrap']);
    // The fee only day is in the fees, not in the days.
    expect(byDay.rows.map((row) => row.id)).toEqual(['2026-11-02', '2026-11-03']);
    expect(table(report, 'fees').total).toMatchObject({ amount: 50000 });
  });

  it('prints an open month as open and a closed month as final', () => {
    expect(buildProgramReport(input, 'internal').statusNote).toBe(OPEN_MONTH_NOTE);
    const closed = buildProgramReport({ ...input, month: { ...month, month: { ...meta, closed: true, when: 'past' } } }, 'customer');
    expect(closed.final).toBe(true);
    expect(closed.statusNote).toBe(FINAL_MONTH_NOTE);
    expect(pageText(programReportToHtml(closed, { orgName: 'Northwind' }))).toContain(FINAL_MONTH_NOTE);
  });

  it('leaves money out for a reader who cannot see it', () => {
    const hidden = <T extends { moneyHidden: boolean }>(value: T): T => ({ ...value, moneyHidden: true });
    const blank: ProgramFiguresDTO = { ...figures, revenueCents: null, workRevenueCents: null, feeCents: null, laborCents: null, materialCents: null, otherCents: null, sharedCents: null, costCents: null, profitCents: null, marginBp: null, revenuePerUnitCents: null, costPerUnitCents: null, profitPerUnitCents: null };
    const report = buildProgramReport({ month: { ...hidden(month), figures: blank, target: { ...month.target, targetMarginBp: null }, alerts: [] }, variants: { ...hidden(variants), total: blank }, days: hidden(days) }, 'internal', { generatedAt: AT });
    expect(report.moneyHidden).toBe(true);
    expect(report.tables.flatMap((item) => item.columns).some((column) => column.money)).toBe(false);
    expect(report.notes).toContain('Money is left out of this copy.');
  });

  it('writes a CSV with each section and plain numbers', () => {
    const csv = programReportToCsv(buildProgramReport(input, 'internal', { generatedAt: AT }), { orgName: 'Northwind Robotics' });
    expect(csv).toContain('GLOVE monthly report');
    expect(csv).toContain('By variant');
    expect(csv).toContain('Total,1800,1500,5,4000.00,960.00,150.00,45.00,2845.00,71.13');
    expect(csv).not.toMatch(/[–—]|--/);
  });

  it('writes a real PDF that every PDF reader can open', () => {
    const bytes = programReportToPdf(buildProgramReport(input, 'internal', { generatedAt: AT }), { orgName: 'Northwind Robotics' });
    const text = new TextDecoder('latin1').decode(bytes);
    expect(text.startsWith('%PDF-1.4')).toBe(true);
    expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    // The cross reference table points at each object.
    const start = Number(/startxref\n(\d+)/.exec(text)?.[1]);
    expect(text.slice(start, start + 4)).toBe('xref');
    const offsets = [...text.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((match) => Number(match[1]));
    offsets.forEach((offset, index) => expect(text.slice(offset).startsWith(`${index + 1} 0 obj`)).toBe(true));
    const drawn = pdfText(bytes);
    expect(drawn).toContain('$4,000.00');
    expect(drawn).toContain('Month still open. Numbers can change.');
    expect(drawn).toContain('Page 1 of 1');
  });

  it('measures and encodes text for the standard fonts', () => {
    expect(textWidth('Total', 'F1', 10)).toBeCloseTo(22.23, 2);
    expect(winAnsiCodes('Müller’s · €5')).toEqual([77, 252, 108, 108, 101, 114, 146, 115, 32, 183, 32, 128, 53]);
    expect(programReportFileName({ key: 'GLOVE', month: '2026-11', version: 'customer' }, 'pdf')).toBe('glove-2026-11-customer.pdf');
  });
});
