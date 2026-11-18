import { describe, expect, it } from 'vitest';
import type { LaborClassDTO, ProfitRowDTO, VasServiceDTO } from '@/lib/types';
import { flagSentence, serviceLine, serviceRateCents, unitWord } from './services-model';

const service = (patch: Partial<VasServiceDTO> = {}): VasServiceDTO => ({ id: 's1', code: 'LABEL', name: 'Labeling', unitLabel: 'labels', billing: 'per_unit', defaultPrice: '0.1200', defaultCostPerUnit: '0.0150', standardUph: '420.000', defaultLaborClassId: null, wmsVasTypeId: null, color: null, active: true, version: 1, moneyHidden: false, ...patch });

const actual = (patch: Partial<ProfitRowDTO>): ProfitRowDTO =>
  ({ key: 's1', label: 'Labeling', sublabel: 'LABEL', revenueCents: 0, baseRevenueCents: 0, vasRevenueCents: 0, otherRevenueCents: 0, laborCents: 0, materialCents: 0, otherCents: 0, sharedCents: 0, costCents: 0, profitCents: 0, marginBp: null, marginBeforeSharedBp: null, laborPctBp: null, billedCents: 0, unitsGood: '0.000', unitsScrap: '0.000', hours: '0.00', uph: null, costPerUnitCents: null, profitPerUnitCents: null, jobCount: 0, prior: null, trend: null, laborMissing: false, riskStatus: null, ...patch }) as ProfitRowDTO;

describe('serviceLine', () => {
  it('works out the standard cost and margin of the worked example', () => {
    const line = serviceLine(service(), undefined, 2700, 3000);
    expect(line.standardLabor).toBe('0.0643');
    expect(line.standardCost).toBe('0.0793');
    expect(line.standardMarginBp).toBe(3393);
    expect(line.flag).toBeNull();
    // 0.0793 / (1 - 0.30) = 0.1133
    expect(line.priceForTarget).toBe('0.1133');
  });

  it('flags a list price under the target margin when there is no volume yet', () => {
    const line = serviceLine(service({ defaultPrice: '0.1000' }), undefined, 2700, 3000);
    expect(line.flag).toBe('standard_under_target');
  });

  it('flags a list price under the standard cost', () => {
    expect(serviceLine(service({ defaultPrice: '0.0700' }), undefined, 2700, 3000).flag).toBe('standard_below_cost');
  });

  it('flags an active service with no price, and leaves one that is turned off alone', () => {
    expect(serviceLine(service({ defaultPrice: null }), undefined, 2700, 3000).flag).toBe('no_price');
    expect(serviceLine(service({ defaultPrice: null, active: false }), undefined, 2700, 3000).flag).toBeNull();
  });

  it('judges by what really happened once there is volume', () => {
    const losing = serviceLine(service(), actual({ unitsGood: '1000.000', revenueCents: 12000, costCents: 13000, profitCents: -1000, marginBp: -833 }), 2700, 3000);
    expect(losing.flag).toBe('below_cost');
    expect(losing.revenuePerUnit).toBe('0.1200');
    expect(losing.costPerUnit).toBe('0.1300');
    // 0.13 / 0.7 = 0.1857
    expect(losing.priceForTarget).toBe('0.1857');
    const thin = serviceLine(service(), actual({ unitsGood: '1000.000', revenueCents: 12000, costCents: 10000, profitCents: 2000, marginBp: 1667 }), 2700, 3000);
    expect(thin.flag).toBe('under_target');
    const fine = serviceLine(service(), actual({ unitsGood: '1000.000', revenueCents: 12000, costCents: 6000, profitCents: 6000, marginBp: 5000 }), 2700, 3000);
    expect(fine.flag).toBeNull();
  });

  it('has no standard cost when nothing is known about it', () => {
    const line = serviceLine(service({ defaultCostPerUnit: null, standardUph: null }), undefined, 2700, 3000);
    expect(line.standardCost).toBeNull();
    expect(line.standardMarginBp).toBeNull();
    expect(line.flag).toBeNull();
  });
});

describe('helpers', () => {
  it('picks the service labor class rate, then the default class', () => {
    const classes = [
      { id: 'a', isDefault: true, currentLoadedRateCents: 2500 },
      { id: 'b', isDefault: false, currentLoadedRateCents: 3100 },
    ] as LaborClassDTO[];
    expect(serviceRateCents({ defaultLaborClassId: 'b' }, classes)).toBe(3100);
    expect(serviceRateCents({ defaultLaborClassId: null }, classes)).toBe(2500);
    expect(serviceRateCents({ defaultLaborClassId: null }, [])).toBeNull();
  });

  it('writes the reason with the price that would fix it', () => {
    const line = serviceLine(service(), actual({ unitsGood: '1000.000', revenueCents: 12000, costCents: 13000, profitCents: -1000, marginBp: -833 }), 2700, 3000);
    expect(flagSentence(line, 3000, (price) => `$${price}`, (bp) => `${(bp ?? 0) / 100}%`)).toBe('Each label cost $0.1300 to do and earned $0.1200. A price of $0.1857 would reach 30%.');
  });

  it('makes one of a unit word', () => {
    expect(unitWord('labels')).toBe('label');
    expect(unitWord('boxes')).toBe('box');
    expect(unitWord('assemblies')).toBe('assembly');
    expect(unitWord('')).toBe('unit');
  });
});
