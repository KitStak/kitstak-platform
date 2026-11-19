/**
 * The day save of the Work log, the bulk save and the future day rule, on a throwaway organization.
 * Skipped when no database answers.
 *
 *  - A new day on a job and day that already has work is refused and nothing changes (no silent overwrite).
 *  - An edit needs every row of the day with the version it read. A stale edit is refused with the fresh day.
 *  - Two saves at the same moment: one wins, the other is told, and no hours are lost.
 *  - The bulk save needs a version for a row that exists, and refuses two lines for one labor class.
 *  - Work cannot be dated after today, and hours with 0 people are refused.
 *  - The day can be put back exactly as it was (the Undo of an edit).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { addDays } from '@/lib/profit';
import type { DomainContext } from './_shared';
import { createLaborClass, createLaborRate } from './labor';
import { quickAddJob } from './jobs';
import { DayConflict, listProduction, saveProductionBulk, saveProductionDay, saveProductionEntry } from './production';

const ready = await databaseReady();

describe.skipIf(!ready)('saving a whole day of work', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let jobId: string;
  let today: string;
  let packer: string;
  let lead: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-day-save');
    owner = await org.member('owner', 'Olive Owner');
    const a = await createLaborClass(owner, { code: 'PACK', name: 'Packer' });
    const b = await createLaborClass(owner, { code: 'LEAD', name: 'Line lead' });
    packer = a.id;
    lead = b.id;
    await createLaborRate(owner, { laborClassId: packer, effectiveFrom: '2020-01-01', wageCents: 2000 });
    await createLaborRate(owner, { laborClassId: lead, effectiveFrom: '2020-01-01', wageCents: 3000 });
    const job = await quickAddJob(owner, { clientName: 'Day Save Client', name: 'Day save job', plannedUnits: '10000', unitPrice: '1.0000' });
    jobId = job.id;
    today = job.startDate as string;
  }, 60_000);
  afterAll(async () => {
    await org?.destroy();
  });

  const day = (workDate: string) => listProduction(owner, { jobId, from: workDate, to: workDate });
  const hoursOf = async (workDate: string) => (await day(workDate)).map((row) => Number(row.hours)).sort((x, y) => x - y);
  const conflict = async (run: Promise<unknown>): Promise<DayConflict> => {
    try {
      await run;
    } catch (error) {
      if (error instanceof DayConflict) return error;
      throw error;
    }
    throw new Error('the save was not refused');
  };

  it('adds a day with two labor classes, then refuses a second add for the same day', async () => {
    const date = addDays(today, -3);
    const saved = await saveProductionDay(owner, {
      jobId,
      workDate: date,
      mode: 'create',
      lines: [
        { laborClassId: packer, unitsGood: '500', unitsScrap: '5', headcount: '6', hours: '48' },
        { laborClassId: lead, headcount: '1', hours: '4' },
      ],
    });
    expect(saved.created).toBe(2);
    expect(saved.entries.map((row) => row.hours)).toEqual(['48.00', '4.00']);

    // The repro of the critic: add the same day again with 50 units and 4 hours.
    const refused = await conflict(saveProductionDay(owner, { jobId, workDate: date, mode: 'create', lines: [{ laborClassId: packer, unitsGood: '50', headcount: '2', hours: '4' }] }));
    expect(refused.reason).toBe('day_exists');
    expect(refused.fresh).toHaveLength(2);
    const after = await day(date);
    expect(after.map((row) => [row.unitsGood, row.hours]).sort()).toEqual([['0.000', '4.00'], ['500.000', '48.00']].sort());
    expect(after.every((row) => row.version === 1)).toBe(true);
  });

  it('edits a day only with the rows and versions it read, and can put the day back', async () => {
    const date = addDays(today, -4);
    const first = await saveProductionDay(owner, { jobId, workDate: date, mode: 'create', lines: [{ laborClassId: packer, unitsGood: '300', headcount: '4', hours: '32', note: 'first shift' }, { laborClassId: lead, headcount: '1', hours: '8' }] });
    const read = first.entries.map((row) => ({ id: row.id, version: row.version }));
    const packerRow = first.entries.find((row) => row.laborClassId === packer)!;

    // No rows named, or an old version: refused with the day as it is, nothing changed.
    expect((await conflict(saveProductionDay(owner, { jobId, workDate: date, mode: 'edit', read: [], lines: [{ id: packerRow.id, laborClassId: packer, hours: '3' }] }))).reason).toBe('stale');
    expect((await conflict(saveProductionDay(owner, { jobId, workDate: date, mode: 'edit', read: read.map((item) => ({ ...item, version: item.version + 1 })), lines: [{ id: packerRow.id, laborClassId: packer, hours: '3' }] }))).reason).toBe('stale');
    expect(await hoursOf(date)).toEqual([8, 32]);

    // A real edit: change the units, drop the line lead, all in one save.
    const edited = await saveProductionDay(owner, { jobId, workDate: date, mode: 'edit', read, lines: [{ id: packerRow.id, laborClassId: packer, unitsGood: '320', headcount: '4', hours: '30', note: 'first shift' }] });
    expect(edited.entries).toHaveLength(1);
    expect(edited.removed).toHaveLength(1);
    expect(edited.entries[0]).toMatchObject({ unitsGood: '320.000', hours: '30.00' });

    // The same read again is stale now: the second writer never wins without a word.
    const stale = await conflict(saveProductionDay(owner, { jobId, workDate: date, mode: 'edit', read, lines: [{ id: packerRow.id, laborClassId: packer, hours: '1' }] }));
    expect(stale.reason).toBe('stale');
    expect(stale.fresh.map((row) => row.hours)).toEqual(['30.00']);

    // Undo: the day goes back to exactly what was read (the removed line comes back as a new row).
    const undone = await saveProductionDay(owner, {
      jobId,
      workDate: date,
      mode: 'edit',
      read: edited.entries.map((row) => ({ id: row.id, version: row.version })),
      lines: first.entries.map((row) => ({ id: row.id === packerRow.id ? row.id : null, laborClassId: row.laborClassId, shift: row.shift, unitsGood: row.unitsGood, unitsScrap: row.unitsScrap, unitsRework: row.unitsRework, headcount: row.headcount, hours: row.hours, setupHours: row.setupHours, overtimeHours: row.overtimeHours, note: row.note })),
    });
    expect(undone.entries.map((row) => [row.laborClassId, row.unitsGood, row.hours, row.headcount, row.note]).sort()).toEqual(first.entries.map((row) => [row.laborClassId, row.unitsGood, row.hours, row.headcount, row.note]).sort());
    expect(undone.entries.map((row) => row.laborCostCents).reduce((sum, cents) => (sum ?? 0) + (cents ?? 0), 0)).toBe(first.entries.map((row) => row.laborCostCents).reduce((sum, cents) => (sum ?? 0) + (cents ?? 0), 0));
  });

  it('moves a day only onto a day with no work', async () => {
    const from = addDays(today, -6);
    const taken = addDays(today, -7);
    const free = addDays(today, -8);
    const a = await saveProductionDay(owner, { jobId, workDate: from, mode: 'create', lines: [{ laborClassId: packer, unitsGood: '10', headcount: '1', hours: '8' }] });
    await saveProductionDay(owner, { jobId, workDate: taken, mode: 'create', lines: [{ laborClassId: packer, unitsGood: '20', headcount: '1', hours: '8' }] });
    const read = a.entries.map((row) => ({ id: row.id, version: row.version }));
    const line = { id: a.entries[0]!.id, laborClassId: packer, unitsGood: '10', headcount: '1', hours: '8' };
    expect((await conflict(saveProductionDay(owner, { jobId, workDate: taken, fromDate: from, mode: 'edit', read, lines: [line] }))).reason).toBe('day_exists');
    const moved = await saveProductionDay(owner, { jobId, workDate: free, fromDate: from, mode: 'edit', read, lines: [line] });
    expect(moved.entries[0]?.workDate).toBe(free);
    expect(await day(from)).toEqual([]);
  });

  it('two saves at the same moment: one wins, the other is told, no hours are lost', async () => {
    // Two people add the same new day at once.
    const date = addDays(today, -10);
    const adds = await Promise.allSettled([
      saveProductionDay(owner, { jobId, workDate: date, mode: 'create', lines: [{ laborClassId: packer, unitsGood: '100', headcount: '2', hours: '16' }] }),
      saveProductionDay(owner, { jobId, workDate: date, mode: 'create', lines: [{ laborClassId: packer, unitsGood: '70', headcount: '1', hours: '7' }] }),
    ]);
    expect(adds.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const lost = adds.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect(lost.reason).toBeInstanceOf(DayConflict);
    expect((lost.reason as DayConflict).reason).toBe('day_exists');
    const rows = await day(date);
    expect(rows).toHaveLength(1);
    // The loser was shown the winner's day, so the screen can offer to open it.
    expect((lost.reason as DayConflict).fresh[0]?.hours).toBe(rows[0]?.hours);

    // Two people edit the same day at once from the same read.
    const read = rows.map((row) => ({ id: row.id, version: row.version }));
    const edits = await Promise.allSettled([
      saveProductionDay(owner, { jobId, workDate: date, mode: 'edit', read, lines: [{ id: rows[0]!.id, laborClassId: packer, unitsGood: '100', headcount: '2', hours: '9' }] }),
      saveProductionDay(owner, { jobId, workDate: date, mode: 'edit', read, lines: [{ id: rows[0]!.id, laborClassId: packer, unitsGood: '100', headcount: '2', hours: '3' }] }),
    ]);
    expect(edits.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    const stale = edits.find((result) => result.status === 'rejected') as PromiseRejectedResult;
    expect((stale.reason as DayConflict).reason).toBe('stale');
    const won = (edits.find((result) => result.status === 'fulfilled') as PromiseFulfilledResult<Awaited<ReturnType<typeof saveProductionDay>>>).value;
    expect(await hoursOf(date)).toEqual([Number(won.entries[0]!.hours)]);
    expect((stale.reason as DayConflict).fresh[0]?.hours).toBe(won.entries[0]!.hours);
  });

  it('refuses the same labor class on two lines of one day, on the line', async () => {
    const date = addDays(today, -12);
    await expect(saveProductionDay(owner, { jobId, workDate: date, mode: 'create', lines: [{ laborClassId: packer, headcount: '1', hours: '4' }, { laborClassId: packer, headcount: '1', hours: '2' }] })).rejects.toMatchObject({
      code: 'VALIDATION',
      fields: { 'entries.1.laborClassId': expect.stringContaining('already on this day') },
    });
    expect(await day(date)).toEqual([]);
  });

  it('bulk save: a row that exists needs its version, and two lines for one labor class are refused', async () => {
    const date = addDays(today, -14);
    const { entry } = await saveProductionEntry(owner, { jobId, workDate: date, laborClassId: lead, headcount: '1', hours: '9' });
    // The repro of the engineer: an id and no version.
    await expect(saveProductionBulk(owner, [{ id: entry.id, jobId, workDate: date, hours: '3' }], { requireVersion: true })).rejects.toMatchObject({ code: 'CONFLICT' });
    // No id, same job, day and labor class: also a row that exists.
    await expect(saveProductionBulk(owner, [{ jobId, workDate: date, laborClassId: lead, hours: '3' }], { requireVersion: true })).rejects.toMatchObject({ code: 'CONFLICT' });
    await expect(saveProductionBulk(owner, [{ id: entry.id, jobId, workDate: date, hours: '3', version: entry.version + 5 }], { requireVersion: true })).rejects.toMatchObject({ code: 'CONFLICT' });
    expect(await hoursOf(date)).toEqual([9]);
    const ok = await saveProductionBulk(owner, [{ id: entry.id, jobId, workDate: date, hours: '10', version: entry.version }], { requireVersion: true });
    expect(ok.entries[0]?.hours).toBe('10.00');

    // Two new lines for the same job, day and labor class: 4 hours then 2 hours used to end as 2.
    const other = addDays(today, -15);
    await expect(saveProductionBulk(owner, [{ jobId, workDate: other, laborClassId: packer, headcount: '1', hours: '4' }, { jobId, workDate: other, laborClassId: packer, headcount: '1', hours: '2' }], { requireVersion: true })).rejects.toMatchObject({
      code: 'VALIDATION',
      message: expect.stringContaining('Line 2'),
      fields: { 'entries.1.laborClassId': expect.any(String) },
    });
    expect(await day(other)).toEqual([]);
  });

  it('refuses work dated after today on every typed path, and hours with 0 people', async () => {
    const tomorrow = addDays(today, 1);
    const future = { code: 'VALIDATION', fields: { workDate: expect.any(String) } };
    await expect(saveProductionEntry(owner, { jobId, workDate: '2030-01-01', unitsGood: '1' }, { requireVersion: true })).rejects.toMatchObject(future);
    await expect(saveProductionEntry(owner, { jobId, workDate: tomorrow, unitsGood: '1' })).rejects.toMatchObject(future);
    await expect(saveProductionBulk(owner, [{ jobId, workDate: tomorrow, unitsGood: '1' }])).rejects.toMatchObject({ code: 'VALIDATION', fields: { 'entries.0.workDate': expect.any(String) } });
    await expect(saveProductionDay(owner, { jobId, workDate: tomorrow, mode: 'create', lines: [{ laborClassId: packer, unitsGood: '1' }] })).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(await listProduction(owner, { jobId, from: tomorrow, to: '2031-01-01' })).toEqual([]);
    // Today itself is fine.
    const now = await saveProductionEntry(owner, { jobId, workDate: today, laborClassId: lead, unitsGood: '1' });
    expect(now.created).toBe(true);

    await expect(saveProductionEntry(owner, { jobId, workDate: addDays(today, -16), headcount: '0', hours: '5' })).rejects.toMatchObject({ code: 'VALIDATION', fields: { headcount: expect.any(String) } });
    // People left empty is still allowed (hours known, head count not): the screens ask for it.
    const noPeople = await saveProductionEntry(owner, { jobId, workDate: addDays(today, -16), hours: '5' });
    expect(noPeople.entry.headcount).toBeNull();
  });
});
