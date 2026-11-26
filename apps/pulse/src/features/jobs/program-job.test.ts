/** The words and the card price of a program job (PULSE_PROGRAMS_SPEC 5.3, 5.4). */
import { describe, expect, it } from 'vitest';
import type { CardLine, CardVersion } from '@kitstak/programs-engine/types';
import { programJobBanner, programJobPrice, programJobRedirect, programJobTabs, programPlanLines, programPriceLine, trackedProgramsLine } from './program-job';

const line = (variantId: string | null, unitPrice: string): CardLine => ({ id: `l-${variantId ?? 'card'}-${unitPrice}`, kind: 'per_unit', variantId, ruleId: null, unitPrice, rateCents: null, amountCents: null, prorate: false, chargeWhilePaused: false, label: null });
const version = (number: number, effectiveFrom: string, lines: CardLine[]): CardVersion => ({ id: `v${number}`, number, effectiveFrom, lines, rules: [] });
const GLOVE = { programId: 'p1', key: 'GLOVE', name: 'Glove kitting', cardVersion: 2, deleted: false, path: '/programs/GLOVE', projectsPath: '/programs/GLOVE' };

describe('program job words', () => {
  it('counts the tracked programs under the Jobs list, singular and plural', () => {
    expect(trackedProgramsLine(3)).toBe('3 programs are tracked under Programs.');
    expect(trackedProgramsLine(1)).toBe('1 program is tracked under Programs.');
    expect(trackedProgramsLine(0)).toBeNull();
  });

  it('says what the job holds, where plans come from, and which card prices it', () => {
    expect(programJobBanner('GLOVE')).toBe('This job holds the labor and costs of the GLOVE program. See the program for its plan and profit.');
    expect(programPlanLines('GLOVE', { quote: false, budget: false })).toEqual(['Plans come from the GLOVE program in Projects.']);
    expect(programPlanLines('GLOVE', { quote: true, budget: false })).toEqual(['Plans come from the GLOVE program in Projects.', 'The quote typed on this job is kept but not used.']);
    expect(programPlanLines('GLOVE', { quote: true, budget: true })[1]).toBe('The quote and budget typed on this job are kept but not used.');
    expect(programPlanLines('GLOVE', { quote: false, budget: true })[1]).toBe('The budget typed on this job is kept but not used.');
    expect(programPriceLine('GLOVE', 2)).toBe('Prices come from GLOVE price card v2 in Projects.');
    expect(programPriceLine('GLOVE', null)).toBe('Prices come from the GLOVE price card in Projects.');
  });

  it('drops the Plan vs actual tab of a program job only', () => {
    const tabs = ['overview', 'plan', 'work'] as const;
    expect(programJobTabs(tabs, true)).toEqual(['overview', 'work']);
    expect(programJobTabs(tabs, false)).toEqual(['overview', 'plan', 'work']);
  });

  it('moves only the front page of a program job, never with ?view=job', () => {
    expect(programJobRedirect({ tab: 'overview', view: undefined, program: GLOVE })).toBe('/programs/GLOVE');
    expect(programJobRedirect({ tab: 'overview', view: 'job', program: GLOVE })).toBeNull();
    expect(programJobRedirect({ tab: 'work', view: undefined, program: GLOVE })).toBeNull();
    expect(programJobRedirect({ tab: 'overview', view: undefined, program: null })).toBeNull();
  });
});

describe('programJobPrice', () => {
  it('reads "Varies by variant" when variants pay different prices on the card in force', () => {
    const versions = [version(1, '2026-01-01', [line(null, '1.9500')]), version(2, '2026-07-01', [line(null, '1.9500'), line('xl', '2.2000')])];
    expect(programJobPrice(versions, ['small', 'xl'], '2026-11-25')).toEqual({ kind: 'varies' });
  });

  it('gives the one card price when every variant pays the same', () => {
    const versions = [version(1, '2026-01-01', [line(null, '1.9500')]), version(2, '2026-07-01', [line(null, '1.9500'), line('xl', '2.2000')])];
    // Before v2, every variant paid the card price.
    expect(programJobPrice(versions, ['small', 'xl'], '2026-06-30')).toEqual({ kind: 'single', unitPrice: '1.9500' });
    expect(programJobPrice(versions, ['small'], '2026-11-25')).toEqual({ kind: 'single', unitPrice: '1.9500' });
    expect(programJobPrice(versions, [], '2026-11-25')).toEqual({ kind: 'single', unitPrice: '1.9500' });
  });

  it('has no price when no card is in force', () => {
    expect(programJobPrice([], ['small'], '2026-11-25')).toEqual({ kind: 'none' });
    expect(programJobPrice([version(1, '2027-01-01', [line(null, '1.0000')])], ['small'], '2026-11-25')).toEqual({ kind: 'none' });
  });
});
