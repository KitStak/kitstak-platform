import { describe, expect, it } from 'vitest';
import { projectJob, type ProjectionInput } from '@/lib/profit';
import { projectWhatIf, rowPace, shiftDate, singularUnit } from './job-math';
import { previewJob, readCents, readDecimal, type WizardNumbers } from './new-job-math';

const B = (value: number) => BigInt(value);

const wizard: WizardNumbers = {
  pricingModel: 'per_unit',
  units: '5,000',
  unitPrice: '2.00',
  fixedPrice: '',
  billRate: '',
  laborMode: 'hours',
  laborHours: '120',
  pace: '',
  setupHours: '2',
  rate: '25',
  laborClassId: null,
  materialPerUnit: '0.5',
  partsOwner: 'us',
  otherCosts: [{ label: 'Freight', amount: '400' }],
  services: [],
  targetMarginBp: 3000,
  sharedRule: 'none',
  sharedPctBp: 0,
  shared90Cents: null,
  labor90Cents: null,
};

describe('new job preview', () => {
  it('reads typed numbers', () => {
    expect(readDecimal(' $1,234.50 ', 2)).toBe('1234.50');
    expect(readDecimal('abc', 2)).toBeNull();
    expect(readDecimal('1.23456', 4)).toBeNull();
    expect(readCents('12.34')).toBe(1234);
  });

  it('adds up revenue, cost, profit and margin', () => {
    const preview = previewJob(wizard);
    expect(preview.figures.revenueCents).toBe(B(1_000_000));
    expect(preview.laborCents).toBe(B(300_000));
    expect(preview.materialCents).toBe(B(250_000));
    expect(preview.otherCents).toBe(B(40_000));
    expect(preview.figures.profitCents).toBe(B(410_000));
    expect(preview.figures.marginBp).toBe(4100);
    expect(preview.breakevenPrice).toBe('1.1800');
    expect(preview.runHours).toBe(118);
  });

  it('builds quote lines that add up to the preview', () => {
    const preview = previewJob({
      ...wizard,
      services: [{ serviceId: null, label: 'Gift wrap', quantity: '1000', price: '0.50', cost: '0.20' }],
    });
    const sum = (category: string) =>
      preview.lines
        .filter((line) => line.category === category)
        .reduce((total, line) => total + line.amountCents, 0);
    expect(B(sum('revenue'))).toBe(preview.figures.revenueCents);
    expect(B(sum('labor') + sum('setup'))).toBe(preview.laborCents);
    expect(B(sum('other'))).toBe(preview.otherCents);
    expect(preview.serviceRevenueCents).toBe(B(50_000));
  });

  it('turns a pace into hours and costs client parts at zero', () => {
    const preview = previewJob({ ...wizard, laborMode: 'pace', pace: '40', partsOwner: 'client' });
    expect(preview.runHours).toBe(125);
    expect(preview.totalHours).toBe(127);
    expect(preview.materialCents).toBe(B(0));
  });

  it('fills time not on a job from the percent rule', () => {
    const preview = previewJob({ ...wizard, sharedRule: 'percent_of_labor', sharedPctBp: 1000 });
    expect(preview.sharedCents).toBe(B(30_000));
    expect(preview.marginBeforeSharedBp).toBe(4100);
  });
});

describe('job helpers', () => {
  it('makes unit words singular and moves dates', () => {
    expect(singularUnit('kits')).toBe('kit');
    expect(singularUnit('boxes')).toBe('box');
    expect(singularUnit(null)).toBe('unit');
    expect(shiftDate('2026-03-01', -1)).toBe('2026-02-28');
  });

  it('leaves rows with no units or unconfirmed hours out of pace', () => {
    expect(rowPace({ unitsGood: '100', hours: '10', setupHours: '2', hoursConfirmed: true })).toBe(12.5);
    expect(rowPace({ unitsGood: '0', hours: '4', setupHours: '0', hoursConfirmed: true })).toBeNull();
    expect(rowPace({ unitsGood: '100', hours: '10', setupHours: '0', hoursConfirmed: false })).toBeNull();
  });

  it('runs the what if through the library projection', () => {
    // 4,000 of 10,000 units done at 32 units an hour and $23.00 an hour.
    const base: ProjectionInput = {
      status: 'active',
      kind: 'one_time',
      pricingModel: 'per_unit',
      plannedUnits: '10000',
      plan: null,
      actual: {
        unitsGood: '4000',
        hours: '125',
        revenueCents: B(700_000),
        laborCents: B(287_500),
        materialCents: B(180_000),
        otherCents: B(0),
        sharedCents: B(0),
      },
      window: { days: 5, unitsGood: 4000, paceHours: 125, hours: 125, laborCostCents: B(287_500) },
      evidenceDays: 5,
      targetPace: '40',
      unitPrice: '1.75',
      today: '2026-11-17',
    };
    const baseline = projectJob(base);
    expect(baseline.hoursLeft).toBe(187.5);
    const same = projectWhatIf(base, {}, baseline);
    expect(same.projectedProfitCents).toBe(baseline.projectedProfitCents);
    const faster = projectWhatIf(base, { pace: 40 }, baseline);
    expect(faster.hoursLeft).toBe(150);
    expect(faster.projectedProfitCents > baseline.projectedProfitCents).toBe(true);
    expect(faster.projectedFinishDate! <= baseline.projectedFinishDate!).toBe(true);
    const pricier = projectWhatIf(base, { unitPrice: '2.0000' }, baseline);
    expect(pricier.projectedProfitCents - baseline.projectedProfitCents).toBe(B(150_000));
    const dearer = projectWhatIf(base, { rateCents: 2500 }, baseline);
    expect(dearer.laborLeftCents).toBe(B(468_750));
  });
});
