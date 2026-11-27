/**
 * One date rule for every typed entry (`@/lib/entry-dates`), on a throwaway organization: work, extra services,
 * time not on a job, material use, other costs, revenue, paid hours and punches may not be dated
 * after today at the site, nor more than 10 years back. The owner is checked too (the round four
 * hole: a manager skips the supervisor day lock). Synced rows keep their dates, an old row can be
 * fixed without moving it, and an import marks the row as a problem row. Skipped when no database
 * answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv/parse';
import { earliestEntryDate } from '@/lib/entry-dates';
import type { StreamId } from '@/lib/streams';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { addDaysForTest } from './test-exports';
import type { DomainContext } from './_shared';
import { todayInZone } from './_shared';
import { createClient, createVasService } from './catalog';
import { saveCost, saveMaterialUsage, saveRevenue, saveVasEntry } from './entries';
import { appendImportRows, checkImportBatch, createImportBatch, discardImportBatch, listImportRows } from './imports';
import { createJob } from './jobs';
import { saveProductionEntry } from './production';
import { savePunches } from './punches';
import { saveIndirectEntry, savePaidHours } from './time';

const ready = await databaseReady();

describe.skipIf(!ready)('the date rule for typed entries', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let jobId: string;
  let clientId: string;
  let serviceId: string;
  let today: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-entry-dates');
    owner = await org.member('owner', 'Dana Dates');
    const client = await createClient(owner, { name: 'Datewise Goods' });
    clientId = client.id;
    const job = await createJob(owner, { name: 'Dated job', clientId, status: 'active', plannedUnits: '100', unitPrice: '1.0000' });
    jobId = job.id;
    serviceId = (await createVasService(owner, { name: 'Labeling', defaultPrice: '0.5000' })).id;
    const [site] = await org.query<{ timezone: string }>('select timezone from pulse.sites where org_id = $1 and deleted_at is null order by is_default desc limit 1', [org.orgId]);
    today = todayInZone(site?.timezone ?? 'UTC');
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });

  /** Every typed write path, for one date. */
  const writes = (date: string): Record<string, () => Promise<unknown>> => ({
    work: () => saveProductionEntry(owner, { jobId, workDate: date, unitsGood: '1', hours: '1' }),
    extraService: () => saveVasEntry(owner, { vasServiceId: serviceId, jobId, workDate: date, quantity: '10' }),
    timeNotOnAJob: () => saveIndirectEntry(owner, { workDate: date, reason: 'meeting', hours: '1' }),
    materials: () => saveMaterialUsage(owner, { jobId, usageDate: date, itemSku: 'BOX-1', quantityUsed: '2' }),
    otherCost: () => saveCost(owner, { costDate: date, category: 'freight', amountCents: 1500 }),
    revenue: () => saveRevenue(owner, { clientId, revenueDate: date, kind: 'fee', amountCents: 2500 }),
    paidHours: () => savePaidHours(owner, { workDate: date, paidHours: '8' }),
    punch: () => savePunches(owner, [{ workDate: date, employeeCode: 'E-1', jobRef: jobId, hours: '1' }]),
  });

  it('refuses a day after today on every typed path, even for the owner', async () => {
    for (const date of ['2030-01-01', addDaysForTest(today, 1)]) {
      for (const [path, write] of Object.entries(writes(date))) {
        await expect(write(), `${path} on ${date}`).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringContaining('cannot be dated after today') });
      }
    }
  });

  it('refuses a day more than 10 years back on every typed path', async () => {
    const earliest = earliestEntryDate(today);
    for (const date of ['1990-01-01', addDaysForTest(earliest, -1)]) {
      for (const [path, write] of Object.entries(writes(date))) {
        await expect(write(), `${path} on ${date}`).rejects.toMatchObject({ code: 'VALIDATION', message: expect.stringMatching(/cannot be dated more than 10 years ago, before [A-Z][a-z]{2} \d{1,2}, \d{4}\. Check the year\./) });
      }
    }
  });

  it('takes today and a day 10 years back, and names the date box', async () => {
    const earliest = earliestEntryDate(today);
    for (const date of [today, earliest]) {
      for (const [path, write] of Object.entries(writes(date))) await expect(write(), `${path} on ${date}`).resolves.toBeTruthy();
    }
    await expect(saveCost(owner, { costDate: '1990-01-01', category: 'freight', amountCents: 1 })).rejects.toMatchObject({ fields: { costDate: 'This day is more than 10 years ago.' } });
    await expect(saveRevenue(owner, { clientId, revenueDate: '2030-01-01', kind: 'fee', amountCents: 1 })).rejects.toMatchObject({ fields: { revenueDate: 'This day is after today.' } });
    await expect(saveMaterialUsage(owner, { jobId, usageDate: '2030-01-01', itemSku: 'BOX-1', quantityUsed: '1' })).rejects.toMatchObject({ fields: { usageDate: 'This day is after today.' } });
  });

  it('keeps the dates of synced rows, and lets an old row be fixed without moving its day', async () => {
    // Rows copied from the warehouse carry the warehouse's dates.
    await expect(saveVasEntry(owner, { vasServiceId: serviceId, jobId, workDate: '2030-01-01', quantity: '1', source: 'wms', sourceRef: 'wms:vas:test' })).resolves.toBeTruthy();
    await expect(saveCost(owner, { costDate: '1990-01-01', category: 'freight', amountCents: 10, source: 'wms', sourceRef: 'wms:cost:test' })).resolves.toBeTruthy();
    // A row with a bad day from before this rule can still be changed, and can be moved to a good day only.
    const [old] = await org.query<{ id: string; version: number }>(
      `insert into pulse.cost_entries (org_id, scope, cost_date, category, amount_cents, source) values ($1, 'company', '2030-01-01', 'freight', 100, 'manual') returning id, version`,
      [org.orgId],
    );
    const fixedNote = await saveCost(owner, { id: old!.id, version: old!.version, costDate: '2030-01-01', category: 'freight', amountCents: 100, note: 'typed the wrong year' });
    expect(fixedNote.costDate).toBe('2030-01-01');
    await expect(saveCost(owner, { id: old!.id, version: fixedNote.version, costDate: '2031-01-01', category: 'freight', amountCents: 100 })).rejects.toMatchObject({ code: 'VALIDATION' });
    const moved = await saveCost(owner, { id: old!.id, version: fixedNote.version, costDate: today, category: 'freight', amountCents: 100 });
    expect(moved.costDate).toBe(today);
  });

  it('marks an imported row with a bad day as a problem row, on every dated stream it checks', async () => {
    const upload = async (stream: StreamId, csv: string) => {
      const parsed = parseCsv(csv);
      const start = await createImportBatch(owner, { stream, fileName: `${stream}.csv`, fileSize: csv.length, headers: parsed.headers, delimiter: parsed.delimiter });
      await appendImportRows(owner, start.batch.id, parsed.rows.map((cells, index) => ({ n: parsed.rowNumbers[index] as number, cells })), { done: true });
      return checkImportBatch(owner, start.batch.id, {});
    };
    const costs = await upload('costs', `cost_date,category,amount\n2030-01-01,freight,10.00\n1990-01-01,freight,10.00\n${today},freight,10.00`);
    expect(costs.counts).toMatchObject({ error: 2, create: 1 });
    const page = await listImportRows(owner, costs.id, { action: 'all' });
    expect(page.rows.map((row) => row.messages.map((message) => message.text))).toEqual([
      ['A cost cannot be dated after today. Fix the date, or skip this row.'],
      [expect.stringMatching(/^A cost cannot be dated more than 10 years ago, before .+\. Fix the date, or skip this row\.$/)],
      [],
    ]);
    const indirect = await upload('indirect_time', `work_date,reason,labor_hours\n2030-01-01,meeting,2\n${today},meeting,2`);
    expect(indirect.counts).toMatchObject({ error: 1, create: 1 });
    for (const batch of [costs, indirect]) await discardImportBatch(owner, batch.id);
  });
});
