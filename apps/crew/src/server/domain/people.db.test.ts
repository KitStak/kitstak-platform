/**
 * Phase 1 against the local database (docs/crew/SPEC.md 12 Phase 1 and 13): people and their
 * rules, the sight rule on real reads, PIN reset, archive rules, the People import (check, errors
 * per row, commit, undo), the export round trip, and an agency link submission that becomes people.
 * Runs with the database guard on (the plain role crew_app). Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { dbGuardStatus } from '@/server/db/system';
import { parseCsv } from '@/lib/csv/parse';
import { mapHeaders } from '@/lib/csv/headers';
import { toCsv } from '@/lib/csv/write';
import { PEOPLE_COLUMNS } from '@/lib/csv/people';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { acceptSubmissions, archiveAgency, createAgency, createAgencyLink, getAgency, rejectSubmissions, revokeAgencyLink } from './agencies';
import { readPublicLink, submitAgencyRows } from './agency-public';
import { exportPeopleCsv } from './exports';
import { addImportRows, checkImport, commitImport, createImportBatch, getImportBatch, undoImport } from './imports';
import { archiveLaborClass, createLaborClass } from './labor-classes';
import { createPerson, getPerson, issuePinSlips, listPeople, setBadge, updatePerson } from './people';
import { verifyPin } from './pins';
import { setMemberRole } from './roles';
import { ensureSetup } from './settings';
import { archiveArea, archiveSite, createArea, createSite } from './sites';

const ready = (await databaseReady()) && (await dbGuardStatus()).ready;

/** Runs a whole CSV through the import center the way the browser does. */
async function importCsv(ctx: DomainContext, csv: string, options: { mode?: 'all' | 'skip' } = {}) {
  const parsed = parseCsv(csv);
  const columns = mapHeaders(parsed.headers, PEOPLE_COLUMNS).columns;
  const { id } = await createImportBatch(ctx, { stream: 'people', fileName: 'people.csv', fileSize: csv.length, headers: parsed.headers, columns, options: { mode: options.mode ?? 'all' } });
  await addImportRows(ctx, id, parsed.rows.map((cells, index) => ({ rowNumber: parsed.rowNumbers[index]!, cells })));
  const summary = await checkImport(ctx, id);
  return { id, summary };
}

describe.skipIf(!ready)('Crew Phase 1: people and import', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let payroll: DomainContext;
  let supervisor: DomainContext;
  let lead: DomainContext;
  let viewer: DomainContext;
  let mainSite: string;
  let otherSite: string;
  let leadPersonId: string;
  let crewPersonId: string;

  beforeAll(async () => {
    org = await createTestOrg('crew-people');
    owner = await org.member('owner', 'People Owner');
    payroll = await org.member('member', 'People Payroll');
    supervisor = await org.member('member', 'People Supervisor');
    lead = await org.member('member', 'People Lead');
    viewer = await org.member('member', 'People Viewer');
    mainSite = (await ensureSetup(owner.orgId, { timezone: 'America/New_York' })).defaultSite.id;
    otherSite = (await createSite(owner, { code: 'KS2', name: 'KS2', timezone: 'America/New_York', weekStart: 0 })).id;
    await createArea(owner, { siteId: mainSite, code: 'KIT1', name: 'Kitting line 1' });
    await createLaborClass(owner, { code: 'EMP', name: 'Employee', kind: 'employee', isDefault: true });
    await createLaborClass(owner, { code: 'TEMP', name: 'Temp packer', kind: 'temp_agency' });
    await setMemberRole(owner, { userId: payroll.userId, role: 'payroll' });
    await setMemberRole(owner, { userId: supervisor.userId, role: 'supervisor', siteIds: [mainSite] });
    await setMemberRole(owner, { userId: lead.userId, role: 'lead' });
    await setMemberRole(owner, { userId: viewer.userId, role: 'viewer' });
    leadPersonId = (await createPerson(owner, { number: '1001', firstName: 'Ana', lastName: 'Ruiz', homeSiteId: mainSite, userId: lead.userId })).id;
    crewPersonId = (
      await createPerson(
        owner,
        { number: '1002', firstName: 'Maria', lastName: 'Lopez', homeSiteId: mainSite, leadPersonId, email: 'maria@example.com', phone: '555-0101' },
        { private: { emergencyName: 'Luis Lopez', emergencyPhone: '555-0199' }, pay: { payType: 'hourly', wageCents: 1950 } },
      )
    ).id;
  }, 120_000);

  afterAll(async () => {
    await org?.destroy();
  });

  describe('people rules (SPEC 5.2)', () => {
    it('makes numbers for temps, keeps numbers and badges unique, and needs an end date to end someone', async () => {
      const temp = await createPerson(owner, { firstName: 'Tess', lastName: 'Temp', kind: 'temp' });
      expect(temp.number).toBe('T-1001');
      expect((await createPerson(owner, { firstName: 'Tom', lastName: 'Temp', kind: 'temp' })).number).toBe('T-1002');
      await expect(createPerson(owner, { number: '1002', firstName: 'Dup', lastName: 'Licate' })).rejects.toMatchObject({ code: 'CONFLICT', message: 'Another person already uses that number.' });
      await setBadge(owner, temp.id, ' B-77 ');
      const other = await createPerson(owner, { number: '1003', firstName: 'Bea', lastName: 'Badge' });
      await expect(setBadge(owner, other.id, 'B-77')).rejects.toMatchObject({ code: 'CONFLICT', message: 'Another person already has that badge.' });
      const person = await getPerson(owner, other.id);
      await expect(updatePerson(owner, other.id, person.person.version, { firstName: 'Bea', lastName: 'Badge', status: 'ended' })).rejects.toMatchObject({ code: 'VALIDATION', fields: { endDate: 'An ended person needs an end date.' } });
      await expect(createPerson(owner, { number: '1004', firstName: 'X', lastName: 'Y', kind: 'employee', agencyVendorId: (await createAgency(owner, { name: 'Rule Staffing' })).id })).rejects.toMatchObject({ code: 'VALIDATION' });
    });

    it('refuses a stale version with the plain 409 sentence', async () => {
      const { person } = await getPerson(owner, crewPersonId);
      await updatePerson(owner, crewPersonId, person.version, { firstName: 'Maria', lastName: 'Lopez', homeSiteId: mainSite, leadPersonId, preferredName: 'Mari' });
      await expect(updatePerson(owner, crewPersonId, person.version, { firstName: 'Maria', lastName: 'Lopez' })).rejects.toMatchObject({ code: 'CONFLICT', message: 'Someone else changed this row. Here is the new one.' });
      const fresh = (await getPerson(owner, crewPersonId)).person;
      expect(fresh).toMatchObject({ preferredName: 'Mari', email: 'maria@example.com', phone: '555-0101' });
    });
  });

  describe('pay and private details are hidden on the server (SPEC 3.2, 3.3)', () => {
    it('owner and payroll see pay; supervisor sees private, not pay; lead and viewer see neither', async () => {
      const as = async (ctx: DomainContext) => (await getPerson(ctx, crewPersonId)).person;
      expect(await as(owner)).toMatchObject({ wageCents: 1950, payType: 'hourly', emergencyName: 'Luis Lopez', payHidden: false, privateHidden: false });
      expect(await as(payroll)).toMatchObject({ wageCents: 1950, emergencyPhone: '555-0199', payHidden: false });
      expect(await as(supervisor)).toMatchObject({ wageCents: null, wages: null, payType: null, emergencyName: 'Luis Lopez', phone: '555-0101', payHidden: true, privateHidden: false });
      const leadView = await as(lead);
      expect(leadView).toMatchObject({ wageCents: null, wages: null, payType: null, overtimeExempt: null, emergencyName: null, emergencyPhone: null, email: null, phone: null, notes: null, payHidden: true, privateHidden: true });
      expect(JSON.stringify(leadView)).not.toMatch(/1950|19\.50|555-01|Luis/);
      expect((await as(viewer)).privateHidden).toBe(true);
    });

    it('a lead sees only their crew, and the activity they read has no pay or private value', async () => {
      const crew = await listPeople(lead, { status: 'all' });
      expect(crew.items.map((item) => item.number)).toEqual(['1002']);
      expect(crew.items[0]).toMatchObject({ phone: null, email: null, privateHidden: true });
      const detail = await getPerson(lead, crewPersonId);
      expect(detail.activity.length).toBeGreaterThan(0);
      expect(detail.activity.map((entry) => entry.entityType)).not.toContain('person_wage');
      expect(JSON.stringify(detail.activity)).not.toMatch(/1950|maria@example\.com|555-01/);
      await expect(getPerson(lead, leadPersonId)).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('a supervisor sees and changes only the people of their sites', async () => {
      const away = await createPerson(owner, { number: '2001', firstName: 'Kai', lastName: 'Away', homeSiteId: otherSite });
      expect((await listPeople(supervisor, { status: 'all' })).items.map((item) => item.number)).not.toContain('2001');
      await expect(getPerson(supervisor, away.id)).rejects.toMatchObject({ code: 'NOT_FOUND' });
      await expect(createPerson(supervisor, { number: '2002', firstName: 'No', lastName: 'Way', homeSiteId: otherSite })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(createPerson(supervisor, { firstName: 'A', lastName: 'B' }, { pay: { wageCents: 2000 } })).rejects.toMatchObject({ code: 'FORBIDDEN' });
      await expect(createPerson(lead, { number: '2003', firstName: 'Lead', lastName: 'Write' })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('PIN slips and reset (SPEC 6.1, 7)', () => {
    it('makes a new starting PIN shown once, stores only its hash, and clears a lock', async () => {
      await org.query("update crew.people set pin_fails = 5, pin_locked_until = now() + interval '5 minutes' where id = $1", [crewPersonId]);
      const [slip] = await issuePinSlips(supervisor, [crewPersonId]);
      expect(slip).toMatchObject({ personId: crewPersonId, number: '1002', name: 'Mari Lopez' });
      expect(slip!.pin).toMatch(/^\d{4}$/);
      const [row] = await org.query<{ pin_hash: string; pin_fails: number; pin_locked_until: Date | null }>('select pin_hash, pin_fails, pin_locked_until from crew.people where id = $1', [crewPersonId]);
      expect(row!.pin_hash).not.toContain(slip!.pin);
      expect(verifyPin(row!.pin_hash, slip!.pin)).toBe(true);
      expect(row).toMatchObject({ pin_fails: 0, pin_locked_until: null });
      const [again] = await issuePinSlips(owner, [crewPersonId]);
      const [after] = await org.query<{ pin_hash: string }>('select pin_hash from crew.people where id = $1', [crewPersonId]);
      expect(verifyPin(after!.pin_hash, slip!.pin) && slip!.pin !== again!.pin).toBe(false);
      await expect(issuePinSlips(lead, [crewPersonId])).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('archive rules (SPEC 5.1, 5.2)', () => {
    it('keeps the default site and any site, area or class people still use; frees the code of an archived one', async () => {
      await expect(archiveSite(owner, mainSite)).rejects.toMatchObject({ code: 'CONFLICT' });
      await expect(archiveSite(owner, otherSite)).rejects.toMatchObject({ code: 'CONFLICT', message: '1 person has this as their home site. Move them first.' });
      const spare = await createSite(owner, { code: 'SPARE', name: 'Spare', timezone: 'America/Chicago', weekStart: 1 });
      await archiveSite(owner, spare.id);
      expect((await createSite(owner, { code: 'spare', name: 'Spare again', timezone: 'America/Chicago', weekStart: 1 })).id).not.toBe(spare.id);
      const area = await createArea(owner, { siteId: mainSite, code: 'RECV', name: 'Receiving' });
      const { person } = await getPerson(owner, crewPersonId);
      await updatePerson(owner, crewPersonId, person.version, { firstName: 'Maria', lastName: 'Lopez', preferredName: 'Mari', homeSiteId: mainSite, leadPersonId, usualAreaId: area.id });
      await expect(archiveArea(owner, area.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      const cls = await createLaborClass(owner, { code: 'SEAS', name: 'Seasonal', kind: 'employee' });
      await archiveLaborClass(owner, cls.id);
      await org.query("insert into crew.labor_classes (org_id, code, name, source) values ($1, 'PUL', 'From Pulse', 'pulse')", [org.orgId]);
      const [pulse] = await org.query<{ id: string }>("select id from crew.labor_classes where org_id = $1 and code = 'PUL'", [org.orgId]);
      await expect(archiveLaborClass(owner, pulse!.id)).rejects.toMatchObject({ code: 'CONFLICT', message: 'This labor class comes from Pulse. Edit it in Pulse.' });
      await expect(archiveSite(supervisor, otherSite)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });

    it('archives an agency only when Crew is its one user and nobody active is from it', async () => {
      await org.query("insert into core.vendors (org_id, name, kinds) values ($1, 'Shared Staffing', '{supplier}')", [org.orgId]);
      const shared = await createAgency(owner, { name: 'shared staffing' });
      expect(shared.created).toBe(false);
      await expect(archiveAgency(owner, shared.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      const solo = await createAgency(owner, { name: 'Solo Staffing' });
      await createPerson(owner, { firstName: 'Sam', lastName: 'Solo', kind: 'temp', agencyVendorId: solo.id });
      await expect(archiveAgency(owner, solo.id)).rejects.toMatchObject({ code: 'CONFLICT' });
      const empty = await createAgency(owner, { name: 'Empty Staffing' });
      await archiveAgency(owner, empty.id);
      const [row] = await org.query<{ archived: boolean; kinds: string[] }>('select archived_at is not null as archived, kinds from core.vendors where id = $1', [empty.id]);
      expect(row).toEqual({ archived: true, kinds: ['temp_agency'] });
    });
  });

  describe('the People import (SPEC 7)', () => {
    const agencyFile = (count: number, extra: readonly (readonly string[])[] = []) =>
      toCsv(
        ['employee_number', 'first_name', 'last_name', 'kind', 'agency', 'agency_person_id', 'start_date', 'phone', 'language', 'lead_employee_number'],
        [
          ...Array.from({ length: count }, (_, index) => ['', `Temp${index + 1}`, `Brightway${index + 1}`, 'temp', 'Brightway Staffing', `BW-${5000 + index}`, '2026-11-30', `555-02${String(index).padStart(2, '0')}`, index % 3 === 0 ? 'es' : 'en', '1001']),
          ...extra,
        ],
      );

    it('checks every row with errors per row, refuses pay columns for a supervisor, then brings 30 temps in with PIN slips in under 2 minutes', async () => {
      const started = Date.now();
      const bad = [
        ['', 'NoLast', '', 'temp', 'Brightway Staffing', 'BW-9001', '2026-11-30', '', 'en', ''],
        ['', 'Bad', 'Date', 'temp', 'Brightway Staffing', 'BW-9002', '2026-02-30', '', 'en', ''],
        ['', 'Ghost', 'Lead', 'temp', 'Brightway Staffing', 'BW-9003', '', '', 'en', '9999'],
      ];
      const { id, summary } = await importCsv(supervisor, agencyFile(30, bad));
      expect(summary).toMatchObject({ total: 33, create: 30, error: 3 });
      const detail = await getImportBatch(supervisor, id);
      const errors = detail.rows.filter((row) => row.action === 'error');
      expect(errors.map((row) => [row.rowNumber, row.messages.filter((issue) => issue.level === 'error').map((issue) => issue.column)])).toEqual([
        [32, ['last_name']],
        [33, ['start_date']],
        [34, ['lead_employee_number']],
      ]);
      expect(detail.rows.find((row) => row.action === 'create')?.messages.map((issue) => issue.message)).toEqual(['Brightway Staffing is a new agency. Crew will add it.']);
      // All or nothing refuses while an error is there.
      await expect(commitImport(supervisor, id)).rejects.toMatchObject({ code: 'VALIDATION' });
      await checkImport(supervisor, id, { mode: 'skip' });
      const result = await commitImport(supervisor, id);
      expect(result).toMatchObject({ create: 30, error: 3, written: 30 });
      const slips = await issuePinSlips(supervisor, result.createdIds);
      expect(slips).toHaveLength(30);
      expect(new Set(slips.map((slip) => slip.number)).size).toBe(30);
      expect(Date.now() - started).toBeLessThan(120_000);
      const made = await org.query<{ kind: string; agency: string; lead: string; source: string; number: string }>(
        "select p.kind, v.name as agency, l.number as lead, p.source, p.number from crew.people p join core.vendors v on v.id = p.agency_vendor_id join crew.people l on l.id = p.lead_person_id where p.org_id = $1 and p.import_batch_id = $2 order by p.number",
        [org.orgId, id],
      );
      expect(made).toHaveLength(30);
      expect(made.every((row) => row.kind === 'temp' && row.agency === 'Brightway Staffing' && row.lead === '1001' && row.source === 'csv' && /^T-\d+$/.test(row.number))).toBe(true);

      const pay = await importCsv(supervisor, toCsv(['employee_number', 'first_name', 'last_name', 'wage_per_hour'], [['1002', 'Maria', 'Lopez', '25.00']]));
      expect(pay.summary.error).toBe(1);
      const payRow = (await getImportBatch(supervisor, pay.id)).rows[0]!;
      expect(payRow.cells.wage_per_hour).toBeUndefined();
      expect(payRow.messages[0]!.message).toMatch(/^Your role cannot bring in wage_per_hour\./);

      // A second run of the same file matches by agency and agency person id: nothing new.
      const again = await importCsv(supervisor, agencyFile(30));
      expect(again.summary).toMatchObject({ create: 0, unchanged: 30, error: 0 });

      // Undo removes what the file made.
      const undone = await undoImport(supervisor, id);
      expect(undone).toEqual({ removed: 30, restored: 0 });
      expect(await org.query('select 1 from crew.people where org_id = $1 and import_batch_id = $2 and deleted_at is null', [org.orgId, id])).toHaveLength(0);
    }, 120_000);

    it('changes only what the file says, flags a look alike, and payroll may bring in wages', async () => {
      const { id, summary } = await importCsv(
        payroll,
        toCsv(
          ['employee_number', 'first_name', 'last_name', 'agency', 'wage_per_hour', 'site_code'],
          [
            ['1002', 'Maria', 'Lopez', '', '21.00', ''],
            ['', 'Bea', 'Badge', '', '', 'MAIN'],
          ],
        ),
      );
      expect(summary).toMatchObject({ update: 1, lookalike: 1, error: 0 });
      const rows = (await getImportBatch(payroll, id)).rows;
      expect(rows[0]!.changes).toEqual(['wage_per_hour']);
      expect(rows[1]!.messages[0]!.message).toMatch(/^Looks the same as Bea Badge \(1003\)/);
      await commitImport(payroll, id);
      expect((await getPerson(payroll, crewPersonId)).person).toMatchObject({ wageCents: 2100, preferredName: 'Mari', phone: '555-0101' });
      await undoImport(payroll, id);
      expect((await getPerson(payroll, crewPersonId)).person.wageCents).toBe(1950);
    });

    it('round trips: an export imported back is all "unchanged", for payroll and for a supervisor', async () => {
      for (const ctx of [payroll, supervisor]) {
        const file = await exportPeopleCsv(ctx, { status: 'all' });
        expect(file.fileName).toMatch(/^crew-people-crew-people-[a-z0-9-]+\.csv$/);
        expect(file.csv.includes('wage_per_hour')).toBe(ctx === payroll);
        expect(file.csv.includes('emergency_name')).toBe(true);
        const { summary } = await importCsv(ctx, file.csv);
        expect(summary, ctx.userName).toMatchObject({ create: 0, update: 0, error: 0, lookalike: 0 });
        expect(summary.unchanged).toBe(file.rows);
      }
      await expect(exportPeopleCsv(lead)).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });

  describe('agency links (SPEC 5.2, 6.1 /join/a)', () => {
    it('a submission waits, then becomes people after acceptance; a revoked link is not active', async () => {
      const agency = await createAgency(supervisor, { name: 'Coastline Staffing', email: 'jobs@coastline.example' });
      const link = await createAgencyLink(supervisor, agency.id, { siteId: mainSite, days: 14, maxPeople: 5 });
      expect(await readPublicLink(link.token)).toEqual({ siteName: 'Main site', agencyName: 'Coastline Staffing', remaining: 5 });
      expect(await readPublicLink('not-a-real-token-at-all-xxxxx')).toBeNull();
      await expect(submitAgencyRows(link.token, [{ firstName: 'A', lastName: '' }], '10.0.0.1')).rejects.toMatchObject({ code: 'VALIDATION' });
      expect(await submitAgencyRows(link.token, [{ firstName: 'Rosa', lastName: 'Diaz', agencyRef: 'CL-1', startDate: '2026-12-01', language: 'es', email: 'Rosa@Example.com' }, { firstName: 'Ben', lastName: 'Ortiz' }, { firstName: 'Zed', lastName: 'Nope' }], '10.0.0.1')).toEqual({ received: 3 });
      await expect(submitAgencyRows(link.token, [1, 2, 3].map((n) => ({ firstName: `X${n}`, lastName: 'Y' })), '10.0.0.1')).rejects.toMatchObject({ code: 'VALIDATION', message: 'This link takes 2 more people. Send fewer rows or ask for a new link.' });
      expect(await org.query("select 1 from crew.people where org_id = $1 and last_name in ('Diaz', 'Ortiz')", [org.orgId])).toHaveLength(0);

      const detail = await getAgency(supervisor, agency.id);
      const pending = detail.submissions.filter((row) => row.status === 'pending');
      expect(pending.map((row) => row.lastName).sort()).toEqual(['Diaz', 'Nope', 'Ortiz']);
      await rejectSubmissions(supervisor, [pending.find((row) => row.lastName === 'Nope')!.id]);
      const accepted = await acceptSubmissions(supervisor, pending.filter((row) => row.lastName !== 'Nope').map((row) => row.id));
      expect(accepted.accepted).toBe(2);
      const people = await org.query<{ first_name: string; kind: string; agency_vendor_id: string; home_site_id: string; source: string; language: string; email: string | null; agency_ref: string | null }>(
        'select first_name, kind, agency_vendor_id, home_site_id, source, language, email, agency_ref from crew.people where id = any($1::uuid[]) order by first_name',
        [accepted.personIds],
      );
      expect(people).toEqual([
        { first_name: 'Ben', kind: 'temp', agency_vendor_id: agency.id, home_site_id: mainSite, source: 'agency_link', language: 'en', email: null, agency_ref: null },
        { first_name: 'Rosa', kind: 'temp', agency_vendor_id: agency.id, home_site_id: mainSite, source: 'agency_link', language: 'es', email: 'rosa@example.com', agency_ref: 'CL-1' },
      ]);
      await expect(acceptSubmissions(supervisor, [pending[0]!.id])).rejects.toMatchObject({ code: 'CONFLICT' });
      expect(await issuePinSlips(supervisor, accepted.personIds)).toHaveLength(2);

      await revokeAgencyLink(supervisor, link.id);
      expect(await readPublicLink(link.token)).toBeNull();
      await expect(submitAgencyRows(link.token, [{ firstName: 'Late', lastName: 'Comer' }], '10.0.0.2')).rejects.toMatchObject({ code: 'NOT_FOUND', message: 'This link is not active.' });
      await expect(createAgencyLink(supervisor, agency.id, { siteId: otherSite })).rejects.toMatchObject({ code: 'FORBIDDEN' });
    });
  });
});
