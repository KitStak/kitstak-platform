/**
 * Production team domain tests against the local database: the time punch roll up (production,
 * time not on a job and paid hours rows are rebuilt exactly and typed units survive), device links
 * and the floor tablet (PIN, lock out, a signed session, a retry that logs nothing twice, no
 * money), and the review queue. The suite makes its own organization and removes it at the end.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import { isDomainError } from '@/server/errors';
import { laborHoursFromCrew } from '@/lib/profit';
import type { DomainContext } from './_shared';
import { todayInZone } from './_shared';
import {
  addDaysForTest,
  createClient,
  createDeviceLink,
  createJob,
  createLaborClass,
  createLaborRate,
  deletePunches,
  getKioskState,
  getPaceBoard,
  getReviewQueue,
  listDeviceLinks,
  listIndirect,
  listKioskJobs,
  listPaidHours,
  listProduction,
  listPunches,
  listSites,
  readKioskSession,
  renewDeviceLink,
  resolveDeviceLink,
  restorePunches,
  revokeDeviceLink,
  saveKioskProduction,
  savePaidHours,
  saveProductionEntry,
  savePunches,
  setKioskPin,
  setMemberRole,
  suggestAllStandards,
  unlockKiosk,
} from './test-exports';

const ready = await databaseReady();

async function expectError(run: () => Promise<unknown>, code: string, message?: RegExp): Promise<void> {
  let caught: unknown;
  try {
    await run();
  } catch (error) {
    caught = error;
  }
  expect(isDomainError(caught), `expected a ${code} error, got ${String(caught)}`).toBe(true);
  if (isDomainError(caught)) {
    expect(caught.code).toBe(code);
    if (message) expect(caught.message).toMatch(message);
  }
}

describe.skipIf(!ready)('production team domain (database)', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let supervisor: DomainContext;
  let viewer: DomainContext;
  let siteId: string;
  let today: string;
  let packer: string;
  let lead: string;
  let jobA: string;
  let jobB: string;

  beforeAll(async () => {
    org = await createTestOrg('pulse-floor');
    owner = await org.member('owner', 'Olive Owner');
    supervisor = await org.member('member', 'Sam Supervisor');
    viewer = await org.member('member', 'Vera Viewer');
    const sites = await listSites(owner);
    siteId = sites[0]!.id;
    today = todayInZone(sites[0]!.timezone);
    await setMemberRole(owner, supervisor.userId, { role: 'supervisor' });
    await setMemberRole(owner, viewer.userId, { role: 'viewer' });
    const client = await createClient(owner, { name: 'Acme Foods' });
    packer = (await createLaborClass(owner, { code: 'PACK', name: 'Packer' })).id;
    lead = (await createLaborClass(owner, { code: 'LEAD', name: 'Line lead' })).id;
    await createLaborRate(owner, {
      laborClassId: packer,
      effectiveFrom: '2026-01-01',
      wageCents: 1600,
      payrollTaxBp: 900,
      benefitsBp: 1200,
      otherBurdenBp: 0,
      overheadPerHourCents: 240,
      overtimeMultiplier: '1.50',
    });
    await createLaborRate(owner, {
      laborClassId: lead,
      effectiveFrom: '2026-01-01',
      wageCents: 2200,
      payrollTaxBp: 900,
      benefitsBp: 1200,
      otherBurdenBp: 0,
      overheadPerHourCents: 240,
      overtimeMultiplier: '1.50',
    });
    jobA = (
      await createJob(owner, {
        clientId: client.id,
        name: 'Holiday kit',
        status: 'active',
        plannedUnits: '10000',
        unitPrice: '1.2500',
        defaultLaborClassId: packer,
        standardUph: '42.000',
        startDate: addDaysForTest(today, -30),
      })
    ).id;
    jobB = (
      await createJob(owner, {
        clientId: client.id,
        name: 'Sampler box',
        status: 'active',
        plannedUnits: '5000',
        unitPrice: '2.0000',
        defaultLaborClassId: packer,
        startDate: addDaysForTest(today, -30),
      })
    ).id;
  }, 60_000);

  afterAll(async () => {
    await org?.destroy();
  });

  describe('time punches', () => {
    const day = () => addDaysForTest(today, -1);

    it('rolls punches up into production, time not on a job and paid hours, and keeps typed units', async () => {
      // Units typed on the grid first, with rough hours.
      await saveProductionEntry(owner, {
        jobId: jobA,
        workDate: day(),
        laborClassId: packer,
        unitsGood: '2000',
        headcount: '5',
        hours: '40',
      });
      const saved = await savePunches(owner, [
        {
          workDate: day(),
          employeeCode: 'E1',
          employeeName: 'Ann',
          jobRef: jobA,
          laborClassId: packer,
          hours: '8',
          overtimeHours: '1',
          payCents: 14400,
        },
        {
          workDate: day(),
          employeeCode: 'E2',
          employeeName: 'Bo',
          jobRef: jobA,
          laborClassId: packer,
          hours: '7.5',
          payCents: 12000,
        },
        {
          workDate: day(),
          employeeCode: 'E3',
          employeeName: 'Cy',
          jobRef: jobA,
          laborClassId: lead,
          hours: '4',
          payCents: 8800,
        },
        {
          workDate: day(),
          employeeCode: 'E3',
          employeeName: 'Cy',
          reason: 'meeting',
          laborClassId: lead,
          hours: '1',
          payCents: 2200,
        },
        {
          workDate: day(),
          employeeCode: 'E1',
          employeeName: 'Ann',
          reason: 'meeting',
          laborClassId: packer,
          hours: '0.5',
          payCents: 800,
        },
        {
          workDate: day(),
          employeeCode: 'E4',
          employeeName: 'Di',
          laborClassId: packer,
          hours: '2',
          payCents: 3200,
        },
      ]);
      expect(saved.created).toBe(6);
      expect(saved.rollup.punches).toBe(6);

      const production = await listProduction(owner, { jobId: jobA, from: day(), to: day() });
      const packers = production.find((row) => row.laborClassId === packer)!;
      const leads = production.find((row) => row.laborClassId === lead)!;
      // The typed row keeps its units; hours, overtime and people now come from the punches.
      expect(packers).toMatchObject({
        unitsGood: '2000.000',
        hours: '15.50',
        overtimeHours: '1.00',
        headcount: '2.00',
        source: 'manual',
      });
      expect(leads).toMatchObject({ unitsGood: '0.000', hours: '4.00', headcount: '1.00', source: 'punch' });
      // Stamped like any other entry: 14.5 regular hours at $21.76 plus 1 overtime hour at $30.48.
      expect(packers.laborCostCents).toBe(31552 + 3048);

      const indirect = await listIndirect(owner, { siteId, from: day(), to: day() });
      expect(indirect.map((row) => [row.reason, row.laborClassId, row.hours, row.source]).sort()).toEqual(
        [
          ['meeting', lead, '1.00', 'punch'],
          ['meeting', packer, '0.50', 'punch'],
        ].sort(),
      );

      // Paid hours are every punch hour of the day by class; pay only when every punch has it.
      const paid = await listPaidHours(owner, { siteId, from: day(), to: day() });
      expect(paid.map((row) => [row.laborClassId, row.paidHours, row.paidCents]).sort()).toEqual(
        [
          [lead, '5.00', 11000],
          [packer, '18.00', 30400],
        ].sort(),
      );
    });

    it('is exact: saving the same punches again changes nothing', async () => {
      const before = await listProduction(owner, { jobId: jobA, from: day(), to: day() });
      const again = await savePunches(owner, [
        {
          workDate: day(),
          employeeCode: 'E2',
          employeeName: 'Bo',
          jobRef: jobA,
          laborClassId: packer,
          hours: '7.5',
          payCents: 12000,
        },
      ]);
      expect(again.created).toBe(0);
      expect(again.updated).toBe(1);
      expect(again.rollup).toMatchObject({ productionRows: 0, indirectRows: 0, paidRows: 0 });
      const after = await listProduction(owner, { jobId: jobA, from: day(), to: day() });
      expect(after.map((row) => [row.id, row.hours, row.version])).toEqual(
        before.map((row) => [row.id, row.hours, row.version]),
      );
    });

    it('a punch with no pay clears the pay amount of its group', async () => {
      await savePunches(owner, [
        { workDate: day(), employeeCode: 'E5', jobRef: jobB, laborClassId: packer, hours: '3' },
      ]);
      const paid = await listPaidHours(owner, { siteId, from: day(), to: day() });
      expect(paid.find((row) => row.laborClassId === packer)).toMatchObject({
        paidHours: '21.00',
        paidCents: null,
      });
      const jobBRows = await listProduction(owner, { jobId: jobB, from: day(), to: day() });
      expect(jobBRows).toHaveLength(1);
      expect(jobBRows[0]).toMatchObject({
        hours: '3.00',
        headcount: '1.00',
        unitsGood: '0.000',
        source: 'punch',
      });
    });

    it('removing punches gives typed hours back, drops empty punch rows, and undo restores them', async () => {
      const punches = await listPunches(owner, { from: day(), to: day() });
      const onA = punches
        .filter((punch) => punch.jobId === jobA && punch.laborClassId === packer)
        .map((punch) => punch.id);
      const onB = punches.filter((punch) => punch.jobId === jobB).map((punch) => punch.id);
      await deletePunches(owner, [...onA, ...onB]);
      const packers = (await listProduction(owner, { jobId: jobA, from: day(), to: day() })).find(
        (row) => row.laborClassId === packer,
      )!;
      // The hours typed before the punches took over are back.
      expect(packers).toMatchObject({ unitsGood: '2000.000', hours: '40.00', headcount: '5.00' });
      expect(await listProduction(owner, { jobId: jobB, from: day(), to: day() })).toHaveLength(0);
      await restorePunches(owner, onA);
      const again = (await listProduction(owner, { jobId: jobA, from: day(), to: day() })).find(
        (row) => row.laborClassId === packer,
      )!;
      expect(again).toMatchObject({ unitsGood: '2000.000', hours: '15.50', headcount: '2.00' });
    });

    it('takes over a typed paid hours row and gives it back', async () => {
      const other = addDaysForTest(today, -2);
      await savePaidHours(owner, { siteId, workDate: other, paidHours: '80', paidCents: 150000 });
      const saved = await savePunches(owner, [
        { workDate: other, employeeCode: 'E9', hours: '6', payCents: 9000 },
      ]);
      let paid = await listPaidHours(owner, { siteId, from: other, to: other });
      expect(paid).toHaveLength(1);
      expect(paid[0]).toMatchObject({ paidHours: '6.00', paidCents: 9000 });
      await deletePunches(
        owner,
        saved.punches.map((punch) => punch.id),
      );
      paid = await listPaidHours(owner, { siteId, from: other, to: other });
      expect(paid[0]).toMatchObject({ paidHours: '80.00', paidCents: 150000 });
    });

    it('checks every punch and saves nothing when one is wrong', async () => {
      const count = (await listPunches(owner, {})).length;
      await expectError(
        () =>
          savePunches(owner, [
            { workDate: day(), employeeCode: 'E7', hours: '4' },
            { workDate: day(), employeeCode: 'E8', hours: '4', overtimeHours: '5' },
          ]),
        'VALIDATION',
        /Overtime hours cannot be more/,
      );
      await expectError(
        () =>
          savePunches(owner, [
            { workDate: day(), employeeCode: 'E7', jobRef: jobA, reason: 'meeting', hours: '4' },
          ]),
        'VALIDATION',
        /a job or for a reason/,
      );
      await expectError(
        () => savePunches(owner, [{ workDate: day(), employeeCode: 'E7', jobRef: 'J-9999', hours: '4' }]),
        'NOT_FOUND',
      );
      expect((await listPunches(owner, {})).length).toBe(count);
    });

    it('hides names and pay from people who may not see them', async () => {
      const forSupervisor = await listPunches(supervisor, { from: day(), to: day() });
      expect(forSupervisor.length).toBeGreaterThan(0);
      expect(
        forSupervisor.every(
          (punch) => punch.employeeName === null && punch.payCents === null && punch.moneyHidden,
        ),
      ).toBe(true);
      const forOwner = await listPunches(owner, { from: day(), to: day() });
      expect(forOwner.some((punch) => punch.employeeName === 'Ann' && punch.payCents === 14400)).toBe(true);
      await expectError(
        () => savePunches(viewer, [{ workDate: day(), employeeCode: 'E1', hours: '1' }]),
        'FORBIDDEN',
      );
    });
  });

  describe('device links and the floor tablet', () => {
    let token: string;
    let linkId: string;

    it('makes a link that only stores a hash of its secret', async () => {
      await expectError(() => createDeviceLink(supervisor, { kind: 'kiosk', name: 'Nope' }), 'FORBIDDEN');
      await expectError(() => createDeviceLink(owner, { kind: 'kiosk', name: '  ' }), 'VALIDATION');
      const made = await createDeviceLink(owner, {
        kind: 'kiosk',
        name: 'Line 2 tablet',
        config: { idleSeconds: 60, pinFails: { x: { n: 4 } } },
      });
      token = made.token;
      linkId = made.link.id;
      expect(made.path).toBe(`/kiosk/t/${token}`);
      expect(made.link).toMatchObject({
        kind: 'kiosk',
        name: 'Line 2 tablet',
        status: 'active',
        siteId,
        config: { idleSeconds: 60 },
      });
      const stored = await org.query<{ token_hash: string; token_prefix: string }>(
        'select token_hash, token_prefix from pulse.device_links where id = $1',
        [linkId],
      );
      expect(stored[0]!.token_hash).not.toContain(token);
      expect(stored[0]!.token_hash).toMatch(/^[0-9a-f]{64}$/);
      expect(token.startsWith(stored[0]!.token_prefix)).toBe(true);
      expect(JSON.stringify(await listDeviceLinks(owner))).not.toContain(token);
    });

    it('opens only for the right kind, and never for a wrong secret', async () => {
      expect(await resolveDeviceLink(token, 'kiosk')).not.toBeNull();
      expect(await resolveDeviceLink(token, 'wall')).toBeNull();
      // A wrong secret: the real one with its last character swapped. The swap must really change
      // it. A secret is random, so about 1 in 64 ends in "x", and putting "x" there again gave
      // the real secret back (this test then failed now and then).
      const wrongSecret = `${token.slice(0, -1)}${token.endsWith('x') ? 'y' : 'x'}`;
      expect(wrongSecret).not.toBe(token);
      expect(wrongSecret).toHaveLength(token.length);
      expect(await resolveDeviceLink(wrongSecret, 'kiosk')).toBeNull();
      expect(await getKioskState(wrongSecret)).toBeNull();
      expect(await getKioskState('short')).toBeNull();
    });

    it('lists only people who can log work and have a PIN', async () => {
      let state = await getKioskState(token);
      expect(state).toMatchObject({ linkName: 'Line 2 tablet', idleSeconds: 60, today, people: [] });
      await setKioskPin(owner, supervisor.userId, '4821');
      await setKioskPin(owner, viewer.userId, '1111');
      state = await getKioskState(token);
      // The viewer has a PIN but may not log production, so the tablet does not offer the name.
      expect(state!.people).toEqual([{ id: supervisor.userId, name: 'Sam Supervisor' }]);
      expect(JSON.stringify(state)).not.toMatch(/cents|rate|pinFails|hash/i);
    });

    it('counts wrong PINs, locks the name after five, and a right PIN in time clears the count', async () => {
      await expectError(
        () => unlockKiosk(token, { userId: supervisor.userId, pin: '0000' }),
        'FORBIDDEN',
        /4 tries left/,
      );
      await expectError(
        () => unlockKiosk(token, { userId: supervisor.userId, pin: '0000' }),
        'FORBIDDEN',
        /3 tries left/,
      );
      const good = await unlockKiosk(token, { userId: supervisor.userId, pin: '4821' });
      expect(good.person).toEqual({ id: supervisor.userId, name: 'Sam Supervisor' });
      for (const left of [4, 3, 2, 1])
        await expectError(
          () => unlockKiosk(token, { userId: supervisor.userId, pin: '9999' }),
          'FORBIDDEN',
          new RegExp(`${left} ${left === 1 ? 'try' : 'tries'} left`),
        );
      await expectError(
        () => unlockKiosk(token, { userId: supervisor.userId, pin: '9999' }),
        'RATE_LIMITED',
        /locked for 5 minutes/,
      );
      await expectError(
        () => unlockKiosk(token, { userId: supervisor.userId, pin: '4821' }),
        'RATE_LIMITED',
        /locked for/,
      );
      // A viewer and a stranger get the same answer as a wrong PIN.
      await expectError(
        () => unlockKiosk(token, { userId: viewer.userId, pin: '1111' }),
        'FORBIDDEN',
        /not right/,
      );
      await org.query("update pulse.device_links set config = config - 'pinFails' where id = $1", [linkId]);
    });

    it('a session is signed for one link and one person', async () => {
      const { session } = await unlockKiosk(token, { userId: supervisor.userId, pin: '4821' });
      expect(readKioskSession(session, linkId)).toBe(supervisor.userId);
      expect(readKioskSession(session, '00000000-0000-4000-8000-000000000000')).toBeNull();
      expect(readKioskSession(`${session.slice(0, -2)}xx`, linkId)).toBeNull();
      expect(readKioskSession(session, linkId, Date.now() + 13 * 3600 * 1000)).toBeNull();
      const forged = session.replace(supervisor.userId, owner.userId);
      expect(readKioskSession(forged, linkId)).toBeNull();
      await expectError(() => listKioskJobs(token, forged), 'UNAUTHENTICATED');
    });

    it('saves a tablet entry once, adds a second entry to the same day, and never shows money', async () => {
      const { session, jobs } = await unlockKiosk(token, { userId: supervisor.userId, pin: '4821' });
      expect(jobs.map((job) => job.jobId).sort()).toEqual([jobA, jobB].sort());
      expect(JSON.stringify(jobs)).not.toMatch(/cents|price|margin/i);
      const first = await saveKioskProduction(token, session, {
        clientRef: 'tablet-ref-0001',
        jobId: jobB,
        unitsGood: '300',
        headcount: '4',
        hoursEach: '2',
      });
      expect(first).toMatchObject({
        duplicate: false,
        todayUnits: '300.000',
        todayHours: laborHoursFromCrew(4, 2).toFixed(2),
        uph: '37.500',
      });
      // The wifi dropped and the tablet sends it again: nothing changes.
      const retry = await saveKioskProduction(token, session, {
        clientRef: 'tablet-ref-0001',
        jobId: jobB,
        unitsGood: '300',
        headcount: '4',
        hoursEach: '2',
      });
      expect(retry).toMatchObject({ duplicate: true, todayUnits: '300.000', todayHours: '8.00' });
      // A later entry for the same job the same day adds to the row.
      const second = await saveKioskProduction(token, session, {
        clientRef: 'tablet-ref-0002',
        jobId: jobB,
        unitsGood: '200',
        unitsScrap: '3',
        headcount: '3',
        hoursEach: '2',
      });
      expect(second).toMatchObject({ duplicate: false, todayUnits: '500.000', todayHours: '14.00' });
      expect(JSON.stringify(second)).not.toMatch(/cents|margin/i);
      const rows = await listProduction(owner, { jobId: jobB, from: today, to: today });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        unitsGood: '500.000',
        unitsScrap: '3.000',
        hours: '14.00',
        headcount: '4.00',
        enteredBy: supervisor.userId,
        sourceRef: 'kiosk:tablet-ref-0001',
      });
      // Stamped: 14 hours at $21.76, and 500 units at $2.00.
      expect(rows[0]!.laborCostCents).toBe(30464);
      expect(rows[0]!.baseRevenueCents).toBe(100000);
    });

    it('refuses what a tablet may not do', async () => {
      const { session } = await unlockKiosk(token, { userId: supervisor.userId, pin: '4821' });
      const base = { jobId: jobB, unitsGood: '10', headcount: '1', hoursEach: '1' };
      await expectError(
        () => saveKioskProduction(token, session, { ...base, clientRef: 'bad ref!' }),
        'VALIDATION',
      );
      await expectError(
        () =>
          saveKioskProduction(token, session, {
            ...base,
            clientRef: 'tablet-ref-0003',
            workDate: addDaysForTest(today, -3),
          }),
        'VALIDATION',
        /today or yesterday/,
      );
      await expectError(
        () =>
          saveKioskProduction(token, session, {
            ...base,
            clientRef: 'tablet-ref-0004',
            unitsGood: '0',
            headcount: '0',
          }),
        'VALIDATION',
        /Type the units/,
      );
      await expectError(
        () => saveKioskProduction(token, session, { ...base, clientRef: 'tablet-ref-0005', hoursEach: '30' }),
        'VALIDATION',
        /more than 24/,
      );
      expect((await listProduction(owner, { jobId: jobB, from: today, to: today }))[0]!.unitsGood).toBe(
        '500.000',
      );
    });

    it('a link that is turned off stops at once, and can be turned on again', async () => {
      const { session } = await unlockKiosk(token, { userId: supervisor.userId, pin: '4821' });
      const off = await revokeDeviceLink(owner, linkId);
      expect(off.status).toBe('revoked');
      expect(await getKioskState(token)).toBeNull();
      await expectError(() => listKioskJobs(token, session), 'NOT_FOUND', /not active/);
      await expectError(() => unlockKiosk(token, { userId: supervisor.userId, pin: '4821' }), 'NOT_FOUND');
      const on = await renewDeviceLink(owner, linkId, { expiresInDays: 30 });
      expect(on.status).toBe('active');
      expect(await getKioskState(token)).not.toBeNull();
      await org.query(
        "update pulse.device_links set expires_at = now() - interval '1 minute' where id = $1",
        [linkId],
      );
      expect(await getKioskState(token)).toBeNull();
      expect((await listDeviceLinks(owner, { kind: 'kiosk' }))[0]!.status).toBe('expired');
    });
  });

  describe('review queue and pace board', () => {
    it('lists the days with work, their odd rows and the jobs that look forgotten', async () => {
      const yesterday = addDaysForTest(today, -1);
      // Units with no hours today on job A; job A also ran yesterday (from the punches above).
      await saveProductionEntry(owner, {
        jobId: jobA,
        workDate: today,
        laborClassId: packer,
        unitsGood: '120',
        hours: '0',
      });
      const queue = await getReviewQueue(owner, { days: 5 });
      const todayRow = queue.find((item) => item.date === today)!;
      expect(todayRow.status).toBe('not_marked');
      expect(todayRow.flags).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ kind: 'units_no_hours', jobId: jobA, units: 120 }),
        ]),
      );
      const yesterdayRow = queue.find((item) => item.date === yesterday)!;
      expect(yesterdayRow.jobs).toBeGreaterThanOrEqual(1);
      // Newest day first.
      expect(queue.map((item) => item.date)).toEqual([...queue.map((item) => item.date)].sort().reverse());
      await expectError(
        () => getReviewQueue({ ...viewer, userId: '00000000-0000-4000-8000-000000000001' }, {}),
        'FORBIDDEN',
      );
    });

    it('measures pace against each job target with counted hours only', async () => {
      const board = await getPaceBoard(owner, { from: addDaysForTest(today, -2), to: today });
      const b = board.byJob.find((row) => row.jobId === jobB)!;
      // 500 units in 14 labor hours.
      expect(b).toMatchObject({
        unitsGood: '500.000',
        paceHours: '14.00',
        uph: '35.714',
        targetUph: null,
        productivityBp: null,
      });
      const a = board.byJob.find((row) => row.jobId === jobA)!;
      // Yesterday: 2000 units over 15.5 packer hours plus 4 lead hours. Today has units but no hours, so it is not a counted day.
      expect(a).toMatchObject({
        unitsGood: '2000.000',
        paceHours: '19.50',
        targetUph: '42.000',
        jobTargetUph: '42.000',
      });
      expect(a.uph).toBe('102.564');
      expect(a.productivityBp).toBe(24420);
      expect(board.byDay.map((row) => row.key)).toEqual([...board.byDay.map((row) => row.key)].sort());
      expect(board.byClass.map((row) => row.label).sort()).toEqual(['Line lead', 'Packer']);
    });

    it('suggests a target for every job type from its own history', async () => {
      const rows = await suggestAllStandards(owner);
      expect(rows.length).toBeGreaterThanOrEqual(1);
      const general = rows.find((row) => row.jobTypeName === 'General')!;
      expect(general.days).toBeGreaterThanOrEqual(2);
      expect(Number(general.median)).toBeGreaterThan(0);
      expect(Number(general.low)).toBeLessThanOrEqual(Number(general.median));
      expect(Number(general.high)).toBeGreaterThanOrEqual(Number(general.median));
    });
  });
});
