/**
 * The standalone promise, proven end to end (SPEC section 7): a brand new workspace with nothing
 * else licensed imports the template of every stream, reaches a correct job profit, exports
 * everything, imports the exports back with no change, and can undo a batch.
 * Skipped when no database answers.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { parseCsv } from '@/lib/csv/parse';
import { templateCsv } from '@/lib/csv/template';
import { STREAM_IDS, type StreamId } from '@/lib/streams';
import type { ImportBatchDTO, ImportOptions } from '@/features/imports/types';
import { createTestOrg, databaseReady, type TestOrg } from '@/test/db';
import type { DomainContext } from './_shared';
import { exportStream } from './exports';
import { appendImportRows, checkImportBatch, commitImportBatch, createImportBatch, discardImportBatch, editImportRows, importErrorReport, listImportBatches, listImportRows, undoImportBatch } from './imports';
import { getJobProfit } from './test-exports';

const ready = await databaseReady();
// One test person starts far more than 20 imports an hour.
process.env.PULSE_IMPORT_UPLOADS_PER_HOUR = '1000';

/** The order a new workspace would import its files in: set up first, then the daily rows, then money. */
const ORDER: readonly StreamId[] = ['clients', 'labor_rates', 'job_types', 'items', 'services', 'jobs', 'job_plans', 'target_pace', 'goals', 'production', 'indirect_time', 'paid_hours', 'materials', 'services_done', 'costs', 'revenue', 'time_punches'];

async function upload(ctx: DomainContext, stream: StreamId, csv: string, options: Partial<ImportOptions> = {}, mapping?: (string | null)[]): Promise<ImportBatchDTO> {
  const parsed = parseCsv(csv);
  const start = await createImportBatch(ctx, { stream, fileName: `${stream}.csv`, fileSize: csv.length, headers: parsed.headers, delimiter: parsed.delimiter });
  for (let offset = 0; offset < parsed.rows.length; offset += 500) {
    await appendImportRows(
      ctx,
      start.batch.id,
      parsed.rows.slice(offset, offset + 500).map((cells, index) => ({ n: parsed.rowNumbers[offset + index] as number, cells })),
      { done: offset + 500 >= parsed.rows.length },
    );
  }
  return checkImportBatch(ctx, start.batch.id, { options, mapping });
}

describe.skipIf(!ready)('imports and exports', () => {
  let org: TestOrg;
  let owner: DomainContext;
  let jobId = '';

  beforeAll(async () => {
    org = await createTestOrg('pulse-import');
    owner = await org.member('owner', 'Import Owner');
  });
  afterAll(async () => {
    await org?.destroy();
  });

  it('covers every stream', () => {
    expect([...ORDER].sort()).toEqual([...STREAM_IDS].sort());
  });

  it('imports the template of every stream into an empty workspace', async () => {
    for (const stream of ORDER) {
      const checked = await upload(owner, stream, templateCsv(stream));
      expect(checked.problems, `${stream} problems`).toEqual([]);
      const page = await listImportRows(owner, checked.id, { action: 'error' });
      expect(page.rows.map((row) => row.messages), `${stream} row problems`).toEqual([]);
      // The jobs file already made the quote of J-1042, so the plans file changes that one and adds the budget.
      expect(checked.counts.create + checked.counts.update, `${stream} rows to save`).toBe(2);
      if (stream !== 'job_plans') expect(checked.counts.create, `${stream} new rows`).toBe(2);
      const saved = await commitImportBatch(owner, checked.id);
      expect(saved.status).toBe('committed');
      expect(saved.canUndo).toBe(true);
    }
    const [job] = await org.query<{ id: string }>("select id from pulse.jobs where org_id = $1 and number = 'J-1042'", [org.orgId]);
    jobId = job?.id ?? '';
    expect(jobId).not.toBe('');
  }, 120_000);

  it('reaches a correct job profit from the imported files alone', async () => {
    const profit = await getJobProfit(owner, jobId);
    // Labor by hand. Packer: $16.00 wage, 9% tax, 12% benefits, $2.40 overhead: $21.76 an hour, $30.48 overtime.
    // Nov 2: the time clock file owns the hours of that row (8.00 hours, 1 of them overtime): 7 x 21.76 + 1 x 30.48 = 182.80.
    // Nov 3: 24 hours, 4 overtime: 20 x 21.76 + 4 x 30.48 = 557.12.  Service entry on the job: 6 x 21.76 = 130.56.
    expect(profit.laborCents).toBe(18280 + 55712 + 13056);
    // Revenue: 600 + 720 kits at $2.75 = 3,630.00, plus 1,200 labels at $0.35 = 420.00. The invoice is a billed memo, not revenue.
    expect(profit.baseRevenueCents).toBe(363000);
    expect(profit.vasRevenueCents).toBe(42000);
    expect(profit.revenueCents).toBe(405000);
    expect(profit.billedCents).toBe(825000);
    // Materials: standard cost $0.45 a kit on good and scrapped kits, 612 + 725 = 1,337 kits = 601.65, plus $48.00 on the service entry.
    expect(profit.materialCents).toBe(60165 + 4800);
    // Other costs: the freight bill on the job.
    expect(profit.otherCents).toBe(38500);
    expect(profit.costCents).toBe((profit.laborCents ?? 0) + (profit.materialCents ?? 0) + (profit.otherCents ?? 0) + (profit.sharedCents ?? 0));
    expect(profit.profitCents).toBe((profit.revenueCents ?? 0) - (profit.costCents ?? 0));
    expect(profit.unitsGood).toBe('1320.000');
  });

  it('exports every stream and imports it back with no change', async () => {
    for (const stream of STREAM_IDS) {
      const file = await exportStream(owner, stream);
      expect(file.rowCount, `${stream} exported rows`).toBeGreaterThan(0);
      const checked = await upload(owner, stream, file.csv);
      expect(checked.problems, `${stream} problems`).toEqual([]);
      const { create, update, error, lookalike, unchanged } = checked.counts;
      expect({ stream, create, update, error, lookalike }, `${stream} round trip`).toEqual({ stream, create: 0, update: 0, error: 0, lookalike: 0 });
      expect(unchanged).toBe(file.rowCount);
      await commitImportBatch(owner, checked.id);
    }
    const lines = await exportStream(owner, 'job_plans', { layout: 'lines' });
    expect(lines.csv).toContain('category');
  }, 120_000);

  it('says the same file again changes nothing, even without entry ids', async () => {
    for (const stream of ['costs', 'revenue', 'indirect_time', 'services_done', 'materials'] as const) {
      const again = await upload(owner, stream, templateCsv(stream));
      expect(again.counts.create, `${stream} must not double`).toBe(0);
      expect(again.counts.lookalike + again.counts.unchanged).toBe(2);
      await discardImportBatch(owner, again.id);
    }
    const forced = await upload(owner, 'indirect_time', templateCsv('indirect_time'), { lookalikes: 'add' });
    expect(forced.counts.create).toBe(2);
    await discardImportBatch(owner, forced.id);
  });

  it('finds problems in plain words, lets a row be fixed or left out, and writes an error report', async () => {
    const csv = ['Date,Job,Units Good,Hours,Notes', '2026-11-04,J-1042,500,9x,=SUM(A1)', '2026-11-05,J-9999,10,8,', '2026-11-06,J-1042,300,16,ok'].join('\n');
    const checked = await upload(owner, 'production', csv);
    expect(checked.mapping).toEqual(['work_date', 'job_number', 'units_good', 'labor_hours', 'note']);
    expect(checked.counts.error).toBe(2);
    expect(checked.counts.create).toBe(1);
    const problems = await listImportRows(owner, checked.id, { action: 'error' });
    expect(problems.rows[0]?.messages[0]).toMatchObject({ level: 'error', column: 'labor_hours' });
    expect(problems.rows[0]?.messages[0]?.text).toContain('9x');
    expect(problems.rows[1]?.messages[0]?.text).toBe('There is no job J-9999. Add it first, or import your jobs before this file.');
    await expect(commitImportBatch(owner, checked.id)).rejects.toThrow(/2 rows have problems/);
    const report = await importErrorReport(owner, checked.id);
    expect(report.rows).toBe(2);
    expect(report.csv).toContain('problem');
    expect(report.csv).toContain("'=SUM(A1)");
    const fixed = await editImportRows(owner, checked.id, [
      { rowNumber: 2, cells: ['2026-11-04', 'J-1042', '500', '9', 'fixed'] },
      { rowNumber: 3, skip: true },
    ]);
    expect(fixed.counts).toMatchObject({ error: 0, create: 2, skip: 1 });
    const saved = await commitImportBatch(owner, checked.id);
    expect(saved.status).toBe('committed');
    const profit = await getJobProfit(owner, jobId);
    expect(profit.unitsGood).toBe('2120.000');
  });

  it('shows a field by field diff for a changed row and undoes the whole batch', async () => {
    const before = await getJobProfit(owner, jobId);
    const csv = ['work_date,job_number,shift,labor_class,units_good', '2026-11-03,J-1042,day,PACK,800', '2026-11-09,J-1042,day,PACK,100'].join('\n');
    const checked = await upload(owner, 'production', csv);
    expect(checked.counts).toMatchObject({ update: 1, create: 1, error: 0 });
    const changed = await listImportRows(owner, checked.id, { action: 'update' });
    expect(changed.rows[0]?.changes).toEqual([{ column: 'units_good', from: '720', to: '800' }]);
    await commitImportBatch(owner, checked.id);
    const during = await getJobProfit(owner, jobId);
    expect(during.unitsGood).toBe('2300.000');
    const undone = await undoImportBatch(owner, checked.id);
    expect(undone.status).toBe('undone');
    expect(undone.undoLeft).toBe(0);
    const after = await getJobProfit(owner, jobId);
    expect(after.unitsGood).toBe(before.unitsGood);
    expect(after.revenueCents).toBe(before.revenueCents);
    expect(after.costCents).toBe(before.costCents);
    expect(after.profitCents).toBe(before.profitCents);
    await expect(undoImportBatch(owner, checked.id)).rejects.toThrow(/already undone/);
  });

  it('leaves a row alone on undo when somebody changed it after the import', async () => {
    const checked = await upload(owner, 'clients', ['client_code,name', 'CEDAR,Cedar Supply', 'DUNE,Dune Goods'].join('\n'));
    await commitImportBatch(owner, checked.id);
    await org.query("update pulse.clients set name = 'Cedar Supply Co', version = version + 1 where org_id = $1 and code = 'CEDAR'", [org.orgId]);
    const undone = await undoImportBatch(owner, checked.id);
    expect(undone.undoLeft).toBe(1);
    const left = await org.query<{ code: string; gone: boolean }>("select code, deleted_at is not null as gone from pulse.clients where org_id = $1 and code in ('CEDAR', 'DUNE') order by code", [org.orgId]);
    expect(left).toEqual([
      { code: 'CEDAR', gone: false },
      { code: 'DUNE', gone: true },
    ]);
  });

  it('adds missing records only when asked, and takes them out again on undo', async () => {
    const csv = ['job_number,name,client_code,job_type_code,unit_price,planned_units', 'J-2001,Display build,Elm Street Foods,DISPLAY,4.10,900'].join('\n');
    const strict = await upload(owner, 'jobs', csv, { createMissing: false });
    expect(strict.counts.error).toBe(1);
    await discardImportBatch(owner, strict.id);
    const open = await upload(owner, 'jobs', csv, { createMissing: true });
    expect(open.counts).toMatchObject({ create: 1, error: 0 });
    expect(open.willCreate).toEqual([
      { kind: 'client', code: 'Elm Street Foods' },
      { kind: 'job_type', code: 'DISPLAY' },
    ]);
    await commitImportBatch(owner, open.id);
    const made = await org.query<{ name: string; code: string }>("select name, code from pulse.clients where org_id = $1 and name = 'Elm Street Foods' and deleted_at is null", [org.orgId]);
    expect(made).toHaveLength(1);
    await undoImportBatch(owner, open.id);
    const gone = await org.query("select 1 from pulse.clients where org_id = $1 and name = 'Elm Street Foods' and deleted_at is null", [org.orgId]);
    expect(gone).toHaveLength(0);
  });

  it('refuses rows in a closed month and keeps the history', async () => {
    await org.query("insert into pulse.periods (org_id, period_month, status, closed_at) values ($1, '2026-10-01', 'closed', now())", [org.orgId]);
    const checked = await upload(owner, 'costs', ['cost_date,category,amount', '2026-10-15,rent,100.00'].join('\n'));
    const page = await listImportRows(owner, checked.id, { action: 'error' });
    expect(page.rows[0]?.messages[0]?.text).toBe('October is closed. Ask the owner to reopen it.');
    await discardImportBatch(owner, checked.id);
    const history = await listImportBatches(owner, { limit: 100 });
    expect(history.length).toBeGreaterThan(30);
    expect(history.some((batch) => batch.status === 'undone')).toBe(true);
  });

  it('keeps people without the right role out, and hides money from people who may not see it', async () => {
    const outsider = await org.member('viewer', 'Outsider');
    await expect(upload(outsider, 'clients', templateCsv('clients'))).rejects.toThrow(/cannot import/);

    // A supervisor may bring in floor files only, and only for the last few days.
    const supervisor = await org.member('member', 'Floor Lead');
    await org.query("insert into pulse.member_roles (org_id, user_id, role, sees_money) values ($1, $2, 'supervisor', false)", [org.orgId, supervisor.userId]);
    await expect(upload(supervisor, 'jobs', templateCsv('jobs'))).rejects.toThrow(/cannot import/);
    await expect(upload(supervisor, 'labor_rates', templateCsv('labor_rates'))).rejects.toThrow(/cannot import/);
    // Yesterday in UTC is today or yesterday at the site, wherever its time zone is.
    const today = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
    const floor = await upload(supervisor, 'production', ['work_date,job_number,shift,units_good,people,hours_each', `2026-01-05,J-1042,sup,10,1,1`, `${today},J-1042,sup,10,1,1`, `${today},J-1042,sup2,10,1,1,`, `${today},NEW-CLASS-JOB,sup3,10,1,1`].join('\n'));
    const rowsNow = await listImportRows(supervisor, floor.id, { action: 'all' });
    expect(rowsNow.rows[0]?.action).toBe('error');
    expect(rowsNow.rows[0]?.messages[0]?.text).toMatch(/last 7 days/);
    expect(rowsNow.rows[1]?.action).toBe('create');
    expect(rowsNow.rows[3]?.action).toBe('error');
    await discardImportBatch(supervisor, floor.id);

    // A viewer who may not see money exports files with the money columns left out, and no labor rates at all.
    const viewer = await org.member('member', 'Read Only');
    await org.query("insert into pulse.member_roles (org_id, user_id, role, sees_money) values ($1, $2, 'viewer', false)", [org.orgId, viewer.userId]);
    const jobsFile = await exportStream(viewer, 'jobs');
    const header = jobsFile.csv.split('\r\n')[0] ?? '';
    expect(header).toContain('job_number');
    expect(header).not.toContain('unit_price');
    expect(header).not.toContain('quote_revenue');
    expect(jobsFile.withMoney).toBe(false);
    await expect(exportStream(viewer, 'labor_rates')).rejects.toThrow(/money/);
    const paid = await exportStream(owner, 'paid_hours', { hideMoney: true });
    expect(paid.csv.split('\r\n')[0]).not.toContain('paid_amount');
    await expect(exportStream(owner, 'nonsense')).rejects.toThrow(/no kind of data/);
    await expect(exportStream(owner, 'costs', { from: '2026-12-01', to: '2026-11-01' })).rejects.toThrow(/before the start date/);
  });

  it('writes an audit row for every import, undo and export', async () => {
    const found = await org.query<{ verb: string; n: string }>("select verb, count(*) as n from pulse.activity where org_id = $1 and verb in ('import.committed', 'import.undone', 'export.run') group by verb", [org.orgId]);
    const byVerb = Object.fromEntries(found.map((row) => [row.verb, Number(row.n)]));
    expect(byVerb['import.committed']).toBeGreaterThan(30);
    expect(byVerb['import.undone']).toBeGreaterThanOrEqual(3);
    expect(byVerb['export.run']).toBeGreaterThan(17);
  });
});

describe.skipIf(!ready)('a large import', () => {
  let org: TestOrg;
  let owner: DomainContext;

  beforeAll(async () => {
    org = await createTestOrg('pulse-import-big');
    owner = await org.member('owner', 'Big Import Owner');
  });
  afterAll(async () => {
    await org?.destroy();
  });

  it('saves 5,000 production rows in one transaction, in time, and undoes them', async () => {
    for (const stream of ['clients', 'labor_rates', 'job_types', 'jobs'] as const) await commitImportBatch(owner, (await upload(owner, stream, templateCsv(stream))).id);
    const lines = ['work_date,job_number,shift,labor_class,units_good,people,hours_each'];
    // 200 days by 25 shifts: every row has its own key.
    for (let dayIndex = 0; dayIndex < 200; dayIndex += 1) {
      const date = new Date(Date.UTC(2026, 0, 1 + dayIndex)).toISOString().slice(0, 10);
      for (let shift = 0; shift < 25; shift += 1) lines.push(`${date},J-1042,s${shift},PACK,${100 + shift},2,${shift % 2 === 0 ? 8 : 7.5}`);
    }
    const started = Date.now();
    const checked = await upload(owner, 'production', lines.join('\n'));
    const checkMs = Date.now() - started;
    expect(checked.counts).toMatchObject({ create: 5000, error: 0 });
    const saveStart = Date.now();
    const saved = await commitImportBatch(owner, checked.id);
    const saveMs = Date.now() - saveStart;
    expect(saved.status).toBe('committed');
    const [job] = await org.query<{ id: string }>("select id from pulse.jobs where org_id = $1 and number = 'J-1042'", [org.orgId]);
    const profit = await getJobProfit(owner, job?.id ?? '');
    // 200 days x the sum of 100..124 units.
    expect(profit.unitsGood).toBe(`${200 * 2800}.000`);
    expect(profit.baseRevenueCents).toBe(200 * 2800 * 275);
    // The same file again: every row is already here.
    const again = await upload(owner, 'production', lines.join('\n'));
    expect(again.counts).toMatchObject({ create: 0, update: 0, unchanged: 5000 });
    await discardImportBatch(owner, again.id);
    const undoStart = Date.now();
    await undoImportBatch(owner, checked.id);
    const undoMs = Date.now() - undoStart;
    expect((await getJobProfit(owner, job?.id ?? '')).unitsGood).toBe('0.000');
    // Room to spare against the 300 second route limit for the 50,000 row ceiling.
    expect(checkMs).toBeLessThan(30_000);
    expect(saveMs).toBeLessThan(30_000);
    expect(undoMs).toBeLessThan(30_000);
    console.info(`5,000 rows: check ${checkMs} ms, save ${saveMs} ms, undo ${undoMs} ms`);
  }, 180_000);
});
