import { describe, expect, it } from 'vitest';
import type { BridgeProgram } from '@kitstak/pm-bridge/programs';
import { programsHealthSummary, sumCents, sumQty } from './programs-health';
import { dealLine, money } from './programs-tab';

const GLOVE: BridgeProgram = {
  id: 'p1',
  key: 'GLOVE',
  name: 'Glove kitting',
  status: 'active',
  statusLabel: 'Running',
  color: 'blue',
  icon: 'repeat',
  unit: { singular: 'kit', plural: 'kits' },
  customerName: 'Gripwell Safety Supply',
  moneyHidden: false,
  month: { month: '2026-11', units: '14172.000', revenueCents: '2997040', forecastCents: '3370840', forecastMethod: 'planned', targetBp: 10534, targetCents: '3200000' },
  today: { date: '2026-11-25', builds: 8, done: 5 },
  cardSummary: '$1.95 per kit · $1,500 monthly · $30,000 minimum',
  deal: { valueCents: '38640000', termMonths: 12, onTrackForCents: '39024400' },
  url: 'http://localhost:3400/programs/GLOVE',
  linkVia: 'record_link',
};

const base = { available: true, moneyHidden: false, deal: null, createProgramUrl: 'http://localhost:3400/programs/new' } as const;

describe('programs health line', () => {
  it('says how many programs and this month’s revenue', () => {
    expect(programsHealthSummary({ ...base, programs: [GLOVE] })).toBe('1 program · $29,970 this month');
  });
  it('shows units when money is hidden', () => {
    const hidden = { ...GLOVE, moneyHidden: true, month: { ...GLOVE.month, revenueCents: null, forecastCents: null, targetBp: null, targetCents: null } };
    expect(programsHealthSummary({ ...base, moneyHidden: true, programs: [hidden] })).toBe('1 program · 14,172 kits this month');
  });
  it('nudges a won deal with no program, and says nothing otherwise', () => {
    expect(programsHealthSummary({ ...base, programs: [], deal: { valueCents: '4200000', currency: 'USD', won: true, accountName: null, termMonths: null } })).toBe('Won · no program yet');
    expect(programsHealthSummary({ ...base, programs: [] })).toBeNull();
    expect(programsHealthSummary({ ...base, available: false, programs: [GLOVE] })).toBeNull();
  });
  it('adds money and units exactly', () => {
    expect(sumCents(['2997040', '420000'])).toBe(BigInt(3417040));
    expect(sumCents(['1', null])).toBeNull();
    expect(sumQty(['14172.000', '0.5', '12'])).toBe('14184.500');
  });
});

describe('program card words', () => {
  it('writes money the way Projects does', () => {
    expect(money('2997040')).toBe('$29,970.40');
    expect(money('38640000')).toBe('$386,400');
    expect(money(null)).toBe('Hidden');
  });
  it('writes the deal line', () => {
    expect(dealLine(GLOVE.deal!)).toBe('Deal $386,400 over 12 months · program on track for $390,244');
    expect(dealLine({ valueCents: '14800000', termMonths: null, onTrackForCents: null })).toBe('Deal $148,000');
    expect(dealLine({ valueCents: '38000000', termMonths: 12, termIsDefault: true, onTrackForCents: null })).toBe(
      'Deal $380,000 over 12 months (no term set, so we use 12)',
    );
  });
});
