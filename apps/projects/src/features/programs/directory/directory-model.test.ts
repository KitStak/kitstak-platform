import { describe, expect, it } from 'vitest';
import type { ProgramListItemDTO } from '@/lib/program-types';
import {
  DEFAULT_FILTERS,
  activeFilterCount,
  directorySubtitle,
  directoryTotals,
  filterPrograms,
  minimumRiskText,
  programsCsv,
  readFilters,
  readPrefs,
  sortPrograms,
  unitsByLabelText,
} from './directory-model';

function program(over: Partial<ProgramListItemDTO> & { key: string }): ProgramListItemDTO {
  const { month, today, ...rest } = over;
  return {
    id: over.key.toLowerCase(),
    name: over.key,
    color: null,
    icon: null,
    status: 'active',
    health: 'on_track',
    healthBasis: 'money_target',
    healthAuto: true,
    customer: null,
    owner: { id: 'u1', name: 'Maya Chen' },
    unit: { singular: 'kit', plural: 'kits' },
    variantsCount: 8,
    schedulesActive: 1,
    scheduleText: 'Every weekday',
    today: { date: '2026-11-25', builds: 8, done: 5, plannedUnits: '800.000', builtUnits: '560.000', ...today },
    month: { month: '2026-11', units: '14172.000', revenueCents: '2997040', forecastCents: '3370840', targetCents: '3200000', targetBp: 10533, minimumGapSoFarCents: '0', projectedGapCents: '0', linkedJobsCents: null, ...month },
    sparkline: [],
    pulseJob: null,
    starred: false,
    archivedAt: null,
    updatedAt: '2026-11-25T10:00:00.000Z',
    moneyHidden: false,
    ...rest,
    key: over.key,
  };
}

const GLOVE = program({ key: 'GLOVE', name: 'Glove kitting', customer: { kind: 'crm_account', id: 'c1', name: 'Gripwell Safety Supply' } });
const ECOMM = program({ key: 'ECOMM', name: 'Ecommerce orders', unit: { singular: 'order', plural: 'orders' }, month: { month: '2026-11', units: '3120.000', revenueCents: '1000000', forecastCents: '1200000', targetCents: null, targetBp: null, minimumGapSoFarCents: '0', projectedGapCents: '124000', linkedJobsCents: null } });
const MAHCO = program({ key: 'MAHCO', name: 'Mahco packs', status: 'on_hold', health: 'at_risk', month: { month: '2026-11', units: '500.000', revenueCents: '50000', forecastCents: '60000', targetCents: '100000', targetBp: 6000, minimumGapSoFarCents: '20000', projectedGapCents: '0', linkedJobsCents: null } });
const OLD = program({ key: 'OLD', status: 'completed' });

describe('filterPrograms', () => {
  it('shows running, paused and setting up by default', () => {
    expect(filterPrograms([GLOVE, ECOMM, MAHCO, OLD], DEFAULT_FILTERS).map((p) => p.key)).toEqual(['GLOVE', 'ECOMM', 'MAHCO']);
  });
  it('searches name, key and customer', () => {
    expect(filterPrograms([GLOVE, ECOMM], { ...DEFAULT_FILTERS, q: 'gripwell' }).map((p) => p.key)).toEqual(['GLOVE']);
    expect(filterPrograms([GLOVE, ECOMM], { ...DEFAULT_FILTERS, q: 'ecomm' }).map((p) => p.key)).toEqual(['ECOMM']);
  });
  it('filters by health and archived status', () => {
    expect(filterPrograms([GLOVE, MAHCO], { ...DEFAULT_FILTERS, health: ['at_risk'] }).map((p) => p.key)).toEqual(['MAHCO']);
    const archived = program({ key: 'ARC', archivedAt: '2026-11-01T00:00:00Z' });
    expect(filterPrograms([GLOVE, archived], DEFAULT_FILTERS).map((p) => p.key)).toEqual(['GLOVE']);
    expect(filterPrograms([GLOVE, archived], { ...DEFAULT_FILTERS, statuses: ['archived'] }).map((p) => p.key)).toEqual(['ARC']);
  });
  it('counts active filters against the defaults', () => {
    expect(activeFilterCount(DEFAULT_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...DEFAULT_FILTERS, starred: true, health: ['on_track'] })).toBe(2);
  });
});

describe('sortPrograms', () => {
  it('sorts revenue in cents and puts programs without a target last', () => {
    expect(sortPrograms([MAHCO, GLOVE, ECOMM], 'revenue', 'desc').map((p) => p.key)).toEqual(['GLOVE', 'ECOMM', 'MAHCO']);
    expect(sortPrograms([ECOMM, MAHCO, GLOVE], 'target', 'desc').map((p) => p.key)).toEqual(['GLOVE', 'MAHCO', 'ECOMM']);
    expect(sortPrograms([ECOMM, MAHCO, GLOVE], 'target', 'asc').map((p) => p.key)).toEqual(['MAHCO', 'GLOVE', 'ECOMM']);
  });
});

describe('totals and text', () => {
  it('sums money and keeps units per label', () => {
    const totals = directoryTotals([GLOVE, ECOMM, MAHCO]);
    expect(totals.revenueCents).toBe('4047040');
    expect(unitsByLabelText(totals.units)).toBe('14,672 kits · 3,120 orders');
    expect(totals.todayBuilds).toBe(24);
  });
  it('drops money when any program hides it', () => {
    const hidden = program({ key: 'HID', moneyHidden: true, month: { month: '2026-11', units: '1.000', revenueCents: null, forecastCents: null, targetCents: null, targetBp: null, minimumGapSoFarCents: null, projectedGapCents: null, linkedJobsCents: null } });
    expect(directoryTotals([GLOVE, hidden]).revenueCents).toBeNull();
    expect(directorySubtitle([GLOVE, hidden])).toBe('2 running');
  });
  it('writes the subtitle with counts, money and programs below target', () => {
    expect(directorySubtitle([GLOVE, ECOMM, MAHCO])).toBe('2 running · 1 paused · $40,470 this month · 1 below target');
  });
  it('says when the minimum may be missed', () => {
    expect(minimumRiskText(ECOMM)).toBe('May miss minimum by $1,240');
    expect(minimumRiskText(GLOVE)).toBeNull();
  });
  it('exports CSV with money as dollars and quotes commas', () => {
    const csv = programsCsv([GLOVE]).split('\n');
    expect(csv[0]).toContain('Revenue this month');
    expect(csv[1]).toContain('29970.40');
    expect(csv[1]).toContain('105%');
  });
});

describe('stored prefs', () => {
  it('ignores unknown values', () => {
    expect(readPrefs({ layout: 'grid', sort: 'revenue', dir: 'desc', hidden: ['nope', 'owner'] })).toMatchObject({ layout: 'cards', sort: 'revenue', dir: 'desc', hidden: ['owner'] });
    expect(readFilters({ statuses: ['active', 'gone'], q: 5, starred: true })).toMatchObject({ statuses: ['active'], q: '', starred: true });
  });
});
