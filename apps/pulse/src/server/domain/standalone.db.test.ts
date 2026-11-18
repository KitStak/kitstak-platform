/**
 * A workspace that licenses only Pulse, on a throwaway organization. Skipped when no database answers.
 *
 *  - With entitlements enforced, only the Pulse module is on and every sibling app reads "not installed".
 *  - A row left out of an import keeps the reason, so the report of rows left out still says why.
 *  - A work day in the future and more than 24 hours for one person are flagged, not saved silently.
 *  - A labor class made on the fly by another file gets its real name and kind from the labor rates file.
 *  - Hours that come from time punches are not changed by a production file.
 *  - Exporting everything and importing it again, time punches included, does not count time twice.
 *  - A reader without money does not get money goals in the goals file.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { grantModule } from '@kitstak/entitlements';
import { parseCsv } from '@/lib/csv/parse';
import type { StreamId } from '@/lib/streams';
import type { ImportBatchDTO, ImportOptions } from '@/features/imports/types';
import { db } from '@/server/db';
import { orgHasPulseModule, orgModuleFlags } from '@/server/entitlements';
import { integrationAvailability } from '@/server/integrations';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { exportStream } from './exports';
import { appendImportRows, checkImportBatch, commitImportBatch, createImportBatch, editImportRows, importErrorReport, listImportRows } from './imports';
import { getConnectedApps, runSync } from './sync';
import { setMemberRole } from './test-exports';

const ready = await databaseReady();
process.env.PULSE_IMPORT_UPLOADS_PER_HOUR = '1000';

async function upload(ctx: DomainContext, stream: StreamId, csv: string, options: Partial<ImportOptions> = {}): Promise<ImportBatchDTO> {
  const parsed = parseCsv(csv);
  const start = await createImportBatch(ctx, { stream, fileName: `${stream}.csv`, fileSize: csv.length, headers: parsed.headers, delimiter: parsed.delimiter });
  await appendImportRows(
    ctx,
    start.batch.id,
    parsed.rows.map((cells, index) => ({ n: parsed.rowNumbers[index] as number, cells })),
    { done: true },
  );
  return checkImportBatch(ctx, start.batch.id, { options });
}

const save = async (ctx: DomainContext, stream: StreamId, csv: string): Promise<ImportBatchDTO> => commitImportBatch(ctx, (await upload(ctx, stream, csv)).id);

describe.skipIf(!ready)('a workspace that licenses only Pulse', () => {
  let org: TestOrg;
  let copy: TestOrg;
  let owner: DomainContext;
  let copyOwner: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('pulse-alone');
    copy = await createTestOrg('pulse-alone-copy');
    owner = await org.member('owner', 'Alone Owner');
    copyOwner = await copy.member('owner', 'Copy Owner');
  }, 60_000);
  afterAll(async () => {
    vi.unstubAllEnvs();
    await org?.destroy();
    await copy?.destroy();
  });

  it('turns every sibling app off when entitlements are enforced', async () => {
    vi.stubEnv('ENTITLEMENTS_DEV_ALLOW_ALL', '0');
    expect(await orgHasPulseModule(org.orgId)).toBe(false);
    await grantModule(db as never, org.orgId, 'pulse', 'manual');
    expect(await orgHasPulseModule(org.orgId)).toBe(true);
    expect(await orgModuleFlags(org.orgId)).toEqual({ crm: false, wms: false, projects: false, pulse: true });
    expect(await integrationAvailability(owner)).toEqual({ crm: false, wms: false, projects: false });
    const connected = await getConnectedApps(owner);
    expect(connected.apps.map((app) => [app.app, app.state])).toEqual([
      ['crm', 'not_on_plan'],
      ['wms', 'not_on_plan'],
      ['projects', 'not_on_plan'],
    ]);
    // A sync asked for anyway brings nothing in and does not fail.
    const runs = await runSync(owner, 'all');
    expect(runs.every((run) => run.created === 0 && run.updated === 0)).toBe(true);
    vi.unstubAllEnvs();
  });

  it('keeps the reason on a row that is left out, and lists it in the report', async () => {
    await save(owner, 'clients', 'client_code,name\nACME,Acme Outdoor Co');
    await save(owner, 'labor_rates', 'labor_class_code,labor_class_name,kind,effective_from,wage_per_hour\nPACK,Packer,employee,2026-01-01,16.00');
    await save(owner, 'jobs', 'job_number,name,client_code,status,planned_units,unit_price,labor_class\nJ-1,Kits,ACME,active,1000,2.75,PACK');
    const checked = await upload(owner, 'production', 'work_date,job_number,labor_class,units_good,people,hours_each\n2026-13-01,J-1,PACK,10,1,8\n2026-11-03,J-404,PACK,10,1,8\n2026-11-03,J-1,PACK,100,2,8');
    expect(checked.counts).toMatchObject({ error: 2, create: 1 });
    const left = await editImportRows(owner, checked.id, [
      { rowNumber: 2, skip: true },
      { rowNumber: 3, skip: true },
    ]);
    expect(left.counts).toMatchObject({ error: 0, skip: 2, create: 1 });
    const skipped = await listImportRows(owner, checked.id, { action: 'skip' });
    expect(skipped.rows[0]?.messages.map((message) => message.level)).toEqual(['info', 'error']);
    expect(skipped.rows[1]?.messages[1]?.text).toContain('There is no job J-404');
    await commitImportBatch(owner, checked.id);
    const report = await importErrorReport(owner, checked.id);
    expect(report.rows).toBe(2);
    expect(report.csv).toContain('is not a real date');
    expect(report.csv).toContain('There is no job J-404');
  });

  it('flags a future work day and more than 24 hours for one person', async () => {
    const checked = await upload(owner, 'production', 'work_date,job_number,labor_class,units_good,people,hours_each\n2099-01-05,J-1,PACK,10,1,8\n2026-11-04,J-1,PACK,10,1,30');
    expect(checked.counts).toMatchObject({ error: 0, create: 2 });
    const page = await listImportRows(owner, checked.id, { action: 'all' });
    expect(page.rows[0]?.messages).toEqual([{ level: 'warning', column: 'work_date', text: 'This day is in the future. Check the date.' }]);
    expect(page.rows[1]?.messages).toEqual([{ level: 'warning', column: 'hours_each', text: 'One person cannot work more than 24 hours in a day. Check the hours each.' }]);
  });

  it('says so when dates like 3/4/2026 are read with the usual order', async () => {
    const checked = await upload(owner, 'production', 'work_date,job_number,labor_class,units_good,people,hours_each\n3/4/2026,J-1,PACK,10,1,8');
    expect(checked.dateOrderNote).toContain('can be read two ways');
    expect(checked.dateOrderNote).toContain('March 4');
  });

  it('fills in the name and kind of a labor class that another file made on the fly', async () => {
    await save(owner, 'job_types', 'job_type_code,name,default_labor_class\nRELABEL,Relabeling,TEMP');
    const before = await org.query<{ name: string; kind: string }>("select name, kind from pulse.labor_classes where org_id = $1 and code = 'TEMP'", [org.orgId]);
    expect(before).toEqual([{ name: 'TEMP', kind: 'employee' }]);
    await save(owner, 'labor_rates', 'labor_class_code,labor_class_name,kind,effective_from,wage_per_hour\nTEMP,Temp packer,temp_agency,2026-01-01,24.50');
    const after = await org.query<{ name: string; kind: string }>("select name, kind from pulse.labor_classes where org_id = $1 and code = 'TEMP'", [org.orgId]);
    expect(after).toEqual([{ name: 'Temp packer', kind: 'temp_agency' }]);
  });

  it('leaves hours that come from time punches alone when a production file names the same row', async () => {
    await save(owner, 'time_punches', 'employee_id,work_date,job_number,reason,labor_class,hours\nE-1,2026-11-05,J-1,,PACK,7.5\nE-2,2026-11-05,,meeting,PACK,1');
    const checked = await upload(owner, 'production', 'work_date,job_number,shift,labor_class,units_good,people,hours_each\n2026-11-05,J-1,day,PACK,400,3,8');
    expect(checked.counts).toMatchObject({ update: 1, error: 0 });
    const page = await listImportRows(owner, checked.id, { action: 'update' });
    expect(page.rows[0]?.changes.map((change) => change.column)).toEqual(['units_good']);
    expect(page.rows[0]?.messages[0]?.text).toContain('come from your time punches');
    await commitImportBatch(owner, checked.id);
    const [row] = await org.query<{ hours: string; units_good: string }>("select hours::text, units_good::text from pulse.production_entries where org_id = $1 and work_date = '2026-11-05' and deleted_at is null", [org.orgId]);
    expect(Number(row?.hours)).toBe(7.5);
    expect(Number(row?.units_good)).toBe(400);
  });

  it('counts nothing twice when everything is exported and imported into another workspace', async () => {
    const order: readonly StreamId[] = ['clients', 'job_types', 'labor_rates', 'jobs', 'production', 'indirect_time', 'paid_hours', 'time_punches'];
    for (const stream of order) {
      const file = await exportStream(owner, stream);
      if (file.rowCount > 0) await save(copyOwner, stream, file.csv);
    }
    const totals = (orgId: string) =>
      org.query<{ kind: string; cents: string; hours: string }>('select kind, sum(amount_cents)::text as cents, sum(hours)::text as hours from pulse.v_facts where org_id = $1 group by kind order by kind', [orgId]);
    const counts = (orgId: string) =>
      org.query<{ production: number; indirect: number; paid: number }>(
        `select (select count(*)::int from pulse.production_entries where org_id = $1 and deleted_at is null) as production,
                (select count(*)::int from pulse.indirect_entries where org_id = $1 and deleted_at is null) as indirect,
                (select count(*)::int from pulse.paid_hours where org_id = $1 and deleted_at is null) as paid`,
        [orgId],
      );
    expect(await counts(copy.orgId)).toEqual(await counts(org.orgId));
    expect(await totals(copy.orgId)).toEqual(await totals(org.orgId));
  });

  it('leaves money goals out of the goals file for a reader without money', async () => {
    await save(owner, 'goals', 'scope,scope_code,metric,month,value\norg,,revenue,2026-11,45000\norg,,margin_pct,,30\norg,,utilization_pct,,85');
    const supervisor = await org.member('member', 'Alone Supervisor');
    await setMemberRole(owner, supervisor.userId, { role: 'supervisor' });
    const hidden = await exportStream(supervisor, 'goals');
    expect(hidden.rowCount).toBe(1);
    expect(hidden.csv).toContain('utilization_pct');
    expect(hidden.csv).not.toContain('45000');
    expect((await exportStream(owner, 'goals')).rowCount).toBe(3);
    expect((await exportStream(owner, 'goals', { hideMoney: true })).rowCount).toBe(1);
  });
});
