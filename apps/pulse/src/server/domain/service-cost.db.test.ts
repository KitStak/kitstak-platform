/**
 * Round four money screens against the local database:
 *   1. Home "Things to fix" and the month close checklist read one count of unpriced extra service
 *      entries, and it includes entries put on a client with no job;
 *   2. an extra service with revenue and no cost of any kind has no margin ("No cost yet"), never 100%;
 *   3. a month with a step to fix is never "ready" in the month list.
 * The suite makes its own organization and removes it at the end. Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import * as domain from './test-exports';

const ready = await databaseReady();
// A month that is long over, so the close screen treats it as waiting to be closed.
const MONTH = { from: '2025-06-01', to: '2025-06-30' };

describe.skipIf(!ready)('extra services with no price or no cost (database)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let viewer: DomainContext;
  let clientId: string;
  let jobId: string;
  let pickupId: string;
  let reworkId: string;
  let unpricedId: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-service-cost');
    owner = await org.member('owner', 'Olive Owner');
    viewer = await org.member('member', 'Vera Viewer');
    await domain.setMemberRole(owner, viewer.userId, { role: 'viewer' });
    await domain.listSites(owner);
    clientId = (await domain.createClient(owner, { name: 'Apex Kits' })).id;
    const crew = (await domain.createLaborClass(owner, { code: 'PACK', name: 'Packer' })).id;
    await domain.createLaborRate(owner, { laborClassId: crew, effectiveFrom: '2025-01-01', wageCents: 2000, payrollTaxBp: 0, benefitsBp: 0, otherBurdenBp: 0, overheadPerHourCents: 0, overtimeMultiplier: '1.50' });
    jobId = (await domain.createJob(owner, { name: 'June kits', clientId, status: 'active', unitPrice: '10.0000' })).id;
    await domain.saveProductionEntry(owner, { jobId, workDate: '2025-06-10', laborClassId: crew, unitsGood: '100', hours: '10' });
    // A flat fee that came in with a price and no hours, the way a warehouse record does.
    pickupId = (await domain.createVasService(owner, { code: 'PICKUP', name: 'Customer pickup', billing: 'flat', defaultPrice: '50.0000' })).id;
    await domain.saveVasEntry(owner, { vasServiceId: pickupId, clientId, workDate: '2025-06-11', quantity: '1', unitPrice: '50.0000' });
    // A service with hours logged: it has a real cost and a real margin.
    reworkId = (await domain.createVasService(owner, { code: 'REWORK', name: 'Rework', billing: 'per_unit', defaultPrice: '2.0000' })).id;
    await domain.saveVasEntry(owner, { vasServiceId: reworkId, jobId, workDate: '2025-06-12', quantity: '100', unitPrice: '2.0000', laborClassId: crew, hours: '4' });
    // A service with no price at all: one entry on the client (no job) and one on the job.
    unpricedId = (await domain.createVasService(owner, { code: 'PROG', name: 'Programming', billing: 'per_unit' })).id;
    await domain.saveVasEntry(owner, { vasServiceId: unpricedId, clientId, workDate: '2025-06-13', quantity: '2' });
    await domain.saveVasEntry(owner, { vasServiceId: unpricedId, clientId, workDate: '2025-06-14', quantity: '3' });
    await domain.saveVasEntry(owner, { vasServiceId: unpricedId, jobId, workDate: '2025-06-15', quantity: '1' });
  }, 120_000);

  afterAll(async () => {
    if (!org) return;
    await org.destroy();
  }, 60_000);

  it('counts unpriced entries the same on Home and at month close, entries on a client included', async () => {
    const checklist = await domain.getCloseChecklist(owner, '2025-06');
    const summary = await domain.getSummary(owner, MONTH);
    expect(checklist.servicesNoPrice).toBe(3);
    expect(summary.thingsToFix.serviceNoPrice).toBe(3);
    // Home is not tied to the dates on screen: the same three show while looking at another month.
    expect((await domain.getSummary(owner, { from: '2025-07-01', to: '2025-07-31' })).thingsToFix.serviceNoPrice).toBe(3);
    // The month card and the month list agree: one step to fix, so the month is not "ready".
    const detail = await domain.getCloseDetail(owner, '2025-06');
    expect(detail).toMatchObject({ ready: false, toFix: 1 });
    expect(detail.items.find((item) => item.key === 'prices')).toMatchObject({ state: 'fix', count: 3 });
    const board = await domain.getCloseBoard(owner);
    expect(board.months.find((month) => month.periodMonth === '2025-06-01')).toMatchObject({ status: 'open', inProgress: false, toFix: 1 });
  });

  it('gives an extra service with revenue and no cost no margin, and a costed one a real margin', async () => {
    const byService = await domain.getProfit(owner, 'service', MONTH);
    const row = (id: string) => byService.rows.find((item) => item.key === id)!;
    // $50.00 of revenue, no hours, no parts: the margin is not known. It is never 10000 bp.
    expect(row(pickupId)).toMatchObject({ revenueCents: 5000, costCents: 0, profitCents: 5000, marginBp: null, marginBeforeSharedBp: null, costMissing: true });
    // $200.00 of revenue and 4 hours at $20.00: a real 60% margin.
    expect(row(reworkId)).toMatchObject({ revenueCents: 20000, laborCents: 8000, marginBp: 6000, costMissing: false });
    // Core job work and the total keep their margins: money still adds up.
    expect(row('none').costMissing).toBe(false);
    expect(byService.total.costMissing).toBe(false);
    expect(byService.total.revenueCents).toBe(byService.rows.reduce((sum, item) => sum + (item.revenueCents ?? 0), 0));
    expect(byService.total.profitCents).toBe(byService.rows.reduce((sum, item) => sum + (item.profitCents ?? 0), 0));
    // The page of one service asks with a service filter: its total gets the same check.
    const one = await domain.getProfit(owner, 'month', { ...MONTH, vasServiceId: pickupId });
    expect(one.total).toMatchObject({ costMissing: true, marginBp: null });
    // Other views are not about one service, so nothing changes there.
    const byClient = await domain.getProfit(owner, 'client', MONTH);
    expect(byClient.rows.every((item) => !item.costMissing)).toBe(true);
  });

  it('explains the missing cost in words and never as 100%', async () => {
    const explained = await domain.explain(owner, 'margin', { ...MONTH, vasServiceId: pickupId });
    const margin = explained.lines.find((item) => item.label === 'Job margin');
    expect(margin).toMatchObject({ unit: 'text', text: 'No cost yet', value: null });
    expect(explained.quality.some((text) => text.includes('does not know what it cost'))).toBe(true);
  });

  it('never tells a reader without money that a cost is missing', async () => {
    const hidden = await domain.getProfit(viewer, 'service', MONTH);
    expect(hidden.rows.every((item) => !item.costMissing && item.marginBp === null)).toBe(true);
  });

  it('drops the count when the entries get a price, and leaves a closed month out of Home', async () => {
    const list = await domain.listVasEntries(owner, { vasServiceId: unpricedId, from: MONTH.from, to: MONTH.to });
    const first = list.find((item) => item.workDate === '2025-06-13')!;
    await domain.saveVasEntry(owner, { id: first.id, version: first.version, vasServiceId: first.vasServiceId, clientId, workDate: first.workDate, quantity: first.quantity, unitPrice: '65.0000' });
    expect((await domain.getCloseChecklist(owner, '2025-06')).servicesNoPrice).toBe(2);
    expect((await domain.getSummary(owner, MONTH)).thingsToFix.serviceNoPrice).toBe(2);
    // Once the month is closed its entries cannot be fixed, so Home stops asking. The saved checklist keeps the 2.
    await domain.closePeriod(owner, '2025-06');
    expect((await domain.getSummary(owner, MONTH)).thingsToFix.serviceNoPrice).toBe(0);
    expect((await domain.getCloseChecklist(owner, '2025-06')).servicesNoPrice).toBe(2);
    const board = await domain.getCloseBoard(owner);
    expect(board.months.find((month) => month.periodMonth === '2025-06-01')).toMatchObject({ status: 'closed', toFix: null });
  });
});
