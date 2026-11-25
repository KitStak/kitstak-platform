import { describe, expect, it } from 'vitest';
import { countOf, getClosedMonths, getJobFacts, getJobPriceRows, getJobsSummary, getProgramPulse, marginBpOf, searchProgramJobs } from './programs';
import type { BridgeExecutor } from './executor';

/** An executor whose every statement fails, like a database without Pulse. */
const broken: BridgeExecutor = {
  execute: async () => {
    throw new Error('relation "pulse.jobs" does not exist');
  },
  transaction: async () => {
    throw new Error('no transaction');
  },
} as unknown as BridgeExecutor;

const who = { orgId: '00000000-0000-4000-8000-000000000001', userId: '00000000-0000-4000-8000-000000000002' };

describe('pulse-bridge programs reads never throw', () => {
  it('reports not installed when every read fails', async () => {
    await expect(getClosedMonths(broken, who.orgId)).resolves.toEqual({ available: false, reason: 'not_installed' });
    await expect(getJobFacts(broken, who, who.orgId)).resolves.toEqual({ available: false, reason: 'not_installed' });
    await expect(getJobPriceRows(broken, who.orgId, who.orgId)).resolves.toEqual([]);
    await expect(getJobsSummary(broken, who, { jobIds: [who.orgId], month: '2026-11' })).resolves.toEqual({ available: false, reason: 'not_installed' });
    await expect(searchProgramJobs(broken, who, { q: 'glove', purpose: 'bills_to' })).resolves.toEqual({ available: false, reason: 'not_installed' });
    await expect(getProgramPulse(broken, who, { programId: who.orgId, month: '2026-11' })).resolves.toEqual({ available: false, reason: 'not_installed' });
  });

  it('refuses ids that are not uuids without touching the database', async () => {
    await expect(getClosedMonths(broken, 'nope')).resolves.toEqual({ available: false, reason: 'no_access' });
    await expect(getJobPriceRows(broken, 'nope', 'nope')).resolves.toEqual([]);
    await expect(getProgramPulse(broken, { orgId: 'x', userId: 'y' }, { programId: 'z', month: '2026-11' })).resolves.toEqual({ available: false, reason: 'no_access' });
  });
});

describe('margin helper', () => {
  it('rounds half away from zero and needs revenue', () => {
    expect(marginBpOf(2500, 10000)).toBe(2500);
    expect(marginBpOf(1, 3)).toBe(3333);
    expect(marginBpOf(2, 3)).toBe(6667);
    expect(marginBpOf(-1, 3)).toBe(-3333);
    expect(marginBpOf(100, 0)).toBeNull();
    expect(countOf('12')).toBe(12);
    expect(countOf(null)).toBe(0);
  });
});
