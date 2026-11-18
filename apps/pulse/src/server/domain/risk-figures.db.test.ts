/**
 * A job quick added with units and a price, and nothing else, against the database: it must read
 * Not enough data with a next step to add a plan, never On track at a 100% margin, and its cost
 * at finish must not be stored as zero. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { createClient, createLaborClass, createLaborRate, getJob, quickAddJob, saveProductionEntry } from './test-exports';

const ready = await databaseReady();

describe.skipIf(!ready)('a job with a price and no plan (database)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let clientId: string;
  let packer: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-risk-figures');
    owner = await org.member('owner', 'Olive Owner');
    clientId = (await createClient(owner, { name: 'Apex Foods' })).id;
    packer = (await createLaborClass(owner, { code: 'PACK', name: 'Packer' })).id;
    await createLaborRate(owner, { laborClassId: packer, effectiveFrom: '2026-01-01', wageCents: 1600, payrollTaxBp: 900, benefitsBp: 1200, otherBurdenBp: 0, overheadPerHourCents: 240, overtimeMultiplier: '1.50' });
  }, 60_000);

  afterAll(async () => {
    if (org) await org.destroy();
  }, 60_000);

  it('reads Not enough data, not On track at 100%', async () => {
    const job = await quickAddJob(owner, { clientId, name: 'Critic test kit', plannedUnits: '1000', unitPrice: '1.25' });
    const { stats } = await getJob(owner, job.id);
    expect(stats.riskStatus).toBe('no_data');
    expect(stats.headline).toBe('No plan yet, so Pulse cannot tell if this job will make money.');
    expect(stats.riskReasons[0]?.nextStep).toBe('add_plan');
    expect(stats.projectedMarginBp).toBeNull();
    expect(stats.projectedProfitCents).toBeNull();
    expect(stats.costAtFinishCents).toBeNull();
    expect(stats.laborMissing).toBe(true);
    expect(stats.needs.noPlan).toBe(true);
  });

  it('is judged on what happened once a day is logged, and still says it has no cost plan', async () => {
    const job = await quickAddJob(owner, { clientId, name: 'Second test kit', plannedUnits: '1000', unitPrice: '2.00' });
    await saveProductionEntry(owner, { jobId: job.id, workDate: '2026-03-02', laborClassId: packer, unitsGood: '400', headcount: '4', hours: '32' });
    const { stats } = await getJob(owner, job.id);
    const rules = stats.riskReasons.map((reason) => reason.rule);
    expect(rules).not.toContain('D4');
    expect(rules).toContain('W7');
    expect(stats.projectedProfitCents).not.toBeNull();
    expect(stats.costAtFinishCents).toBeGreaterThan(0);
  });
});
