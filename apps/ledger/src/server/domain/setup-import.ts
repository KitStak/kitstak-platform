/**
 * CSV import of the five setup streams (docs/ledger/SPEC.md 7): read the file, map its headers
 * (names, aliases, QuickBooks export columns, near misses), check every row against Ledger and
 * keep the result as an import batch (`ledger.import_batches`, `ledger.import_rows`). Nothing is
 * saved until the person commits. The commit checks every row again from its raw text against
 * the database as it is then (server revalidation), and is all or nothing unless the person
 * chose to skip the rows with problems. Each record written makes its own activity row.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError, notFound } from '@/server/errors';
import { CSV_LIMITS, parseCsv } from '@/lib/csv/parse';
import { mapHeaders } from '@/lib/csv/headers';
import { toCsv } from '@/lib/csv/write';
import { planRows, type FileRow, type PlannedRow, type PlanAction } from '@/server/csv/plan';
import { KEY_COLUMN, STREAMS, type RowIssue, type SetupStream } from '@/server/csv/streams';
import { requireRight } from './access';
import { logActivity } from './activity';
import { applyPlannedRow, linkParents, loadLookups, loadStreamRecords, STREAM_WRITE_RIGHT } from './setup-csv';
import { actorUserId, isUuid, pgError, type DomainContext } from './_shared';
import { asDomainError } from './posting';

export interface HeaderUse {
  readonly header: string;
  /** The stream column this header feeds, or null when it is left out. */
  readonly column: string | null;
}

export interface ImportCounts {
  readonly create: number;
  readonly update: number;
  readonly unchanged: number;
  readonly error: number;
  readonly total: number;
}

export interface ImportRowView {
  readonly rowNumber: number;
  readonly key: string;
  readonly action: PlanAction | 'skip';
  readonly issues: readonly RowIssue[];
  readonly changes: readonly string[];
  readonly entityId: string | null;
}

export interface ImportBatchView {
  readonly id: string;
  readonly stream: SetupStream;
  readonly streamTitle: string;
  readonly fileName: string | null;
  readonly status: 'checked' | 'committed' | 'failed';
  readonly counts: ImportCounts;
  readonly headers: readonly HeaderUse[];
  readonly createdAt: Date;
  readonly createdByName: string | null;
  readonly committedAt: Date | null;
}

const MAX_FILE_CHARS = CSV_LIMITS.maxBytes;

function countsOf(rows: readonly Pick<PlannedRow, 'action'>[]): ImportCounts {
  const counts = { create: 0, update: 0, unchanged: 0, error: 0 };
  for (const row of rows) counts[row.action] += 1;
  return { ...counts, total: rows.length };
}

/** Reads a file into mapped rows. Throws a plain sentence when the file cannot be used at all. */
export function readImportFile(stream: SetupStream, text: string): { rows: FileRow[]; headers: HeaderUse[] } {
  if (text.length > MAX_FILE_CHARS) throw new DomainError('VALIDATION', 'This file is larger than 10 MB. Split it into smaller files.');
  const parsed = parseCsv(text);
  const fatal = parsed.problems.find((problem) => problem.level === 'error' && problem.row === null);
  if (fatal) throw new DomainError('VALIDATION', fatal.message);
  if (parsed.headers.length === 0 || parsed.rows.length === 0) throw new DomainError('VALIDATION', 'This file has no rows under its header row.');
  const def = STREAMS[stream];
  const mapping = mapHeaders(parsed.headers, def.columns);
  if (mapping.missingRequired.length > 0) {
    const labels = mapping.missingRequired.map((key) => def.columns.find((column) => column.key === key)?.key ?? key);
    throw new DomainError('VALIDATION', `This file needs the column${labels.length > 1 ? 's' : ''} ${labels.join(', ')}. Check the header row, or download the export to see the columns.`);
  }
  const rows = parsed.rows.map((cells, index) => {
    const out: Record<string, string> = {};
    mapping.columns.forEach((column, position) => {
      if (column) out[column] = cells[position] ?? '';
    });
    return { rowNumber: parsed.rowNumbers[index] ?? index + 2, cells: out };
  });
  return { rows, headers: parsed.headers.map((header, index) => ({ header, column: mapping.columns[index] ?? null })) };
}

async function plan(tx: Transaction, ctx: DomainContext, stream: SetupStream, rows: readonly FileRow[]): Promise<{ planned: PlannedRow[]; lookups: Awaited<ReturnType<typeof loadLookups>> }> {
  const existing = await loadStreamRecords(tx, ctx, stream);
  const lookups = await loadLookups(tx, ctx);
  return { planned: planRows(stream, rows, existing, lookups), lookups };
}

async function assertMayImport(ctx: DomainContext, stream: SetupStream): Promise<void> {
  await requireRight(ctx, 'import:run');
  await requireRight(ctx, STREAM_WRITE_RIGHT[stream]);
}

/** The check step: reads the file, plans every row and keeps the batch. Saves no record. */
export const checkSetupImport = scoped(async function checkSetupImport(ctx: DomainContext, input: { readonly stream: SetupStream; readonly fileName: string | null; readonly text: string }): Promise<{ batchId: string; counts: ImportCounts }> {
  await assertMayImport(ctx, input.stream);
  const { rows, headers } = readImportFile(input.stream, input.text);
  return db.transaction(async (tx) => {
    const { planned } = await plan(tx, ctx, input.stream, rows);
    const counts = countsOf(planned);
    const fileHash = createHash('sha256').update(input.text).digest('hex');
    const batch = await tx.execute<{ id: string }>(
      sql`insert into ledger.import_batches (org_id, stream, file_name, file_size, file_hash, header, mapping, status, total_rows, create_count, update_count, unchanged_count, error_count, created_by)
          values (${ctx.orgId}::uuid, ${input.stream}, ${input.fileName?.slice(0, 200) ?? null}, ${input.text.length}, ${fileHash},
                  ${JSON.stringify(headers.map((use) => use.header))}::jsonb, ${JSON.stringify(headers.map((use) => use.column))}::jsonb, 'checked',
                  ${counts.total}, ${counts.create}, ${counts.update}, ${counts.unchanged}, ${counts.error}, ${actorUserId(ctx)}::uuid)
          returning id`,
    );
    const batchId = batch.rows[0]!.id;
    const byNumber = new Map(rows.map((row) => [row.rowNumber, row]));
    for (let start = 0; start < planned.length; start += 500) {
      const chunk = planned.slice(start, start + 500);
      await tx.execute(sql`insert into ledger.import_rows (org_id, batch_id, row_number, raw, parsed, action, messages, entity_id, before) values ${sql.join(
        chunk.map(
          (row) =>
            sql`(${ctx.orgId}::uuid, ${batchId}::uuid, ${row.rowNumber}, ${JSON.stringify(byNumber.get(row.rowNumber)?.cells ?? {})}::jsonb,
                 ${JSON.stringify({ key: row.key, after: row.after, changes: row.changes })}::jsonb, ${row.action}, ${JSON.stringify(row.issues)}::jsonb,
                 ${row.entityId}::uuid, ${row.before ? JSON.stringify(row.before) : null}::jsonb)`,
        ),
        sql`, `,
      )}`);
    }
    await logActivity(tx, ctx, { verb: 'import.checked', entityType: 'import_batch', entityId: batchId, meta: { stream: input.stream, ...counts } });
    return { batchId, counts };
  });
});

type BatchDbRow = {
  id: string;
  stream: SetupStream;
  file_name: string | null;
  status: 'checked' | 'committed' | 'failed';
  header: string[] | null;
  mapping: (string | null)[] | null;
  create_count: number;
  update_count: number;
  unchanged_count: number;
  error_count: number;
  total_rows: number;
  created_at: Date | string;
  committed_at: Date | string | null;
  created_by_name: string | null;
}

const BATCH_SELECT = sql`select b.id, b.stream, b.file_name, b.status, b.header, b.mapping, b.create_count, b.update_count, b.unchanged_count,
       b.error_count, b.total_rows, b.created_at, b.committed_at, u.name as created_by_name
  from ledger.import_batches b left join core."user" u on u.id = b.created_by`;

function toView(row: BatchDbRow): ImportBatchView {
  const headers = (row.header ?? []).map((header, index) => ({ header, column: row.mapping?.[index] ?? null }));
  return {
    id: row.id,
    stream: row.stream,
    streamTitle: STREAMS[row.stream]?.title ?? row.stream,
    fileName: row.file_name,
    status: row.status,
    counts: { create: row.create_count, update: row.update_count, unchanged: row.unchanged_count, error: row.error_count, total: row.total_rows },
    headers,
    createdAt: new Date(row.created_at),
    createdByName: row.created_by_name,
    committedAt: row.committed_at ? new Date(row.committed_at) : null,
  };
}

export const listImportBatches = scoped(async function listImportBatches(ctx: DomainContext): Promise<readonly ImportBatchView[]> {
  await requireRight(ctx, 'import:run');
  const result = await db.execute<BatchDbRow>(sql`${BATCH_SELECT} where b.org_id = ${ctx.orgId}::uuid order by b.created_at desc limit 50`);
  return result.rows.filter((row) => row.stream in STREAMS).map(toView);
});

export const getImportBatch = scoped(async function getImportBatch(ctx: DomainContext, batchId: string): Promise<{ batch: ImportBatchView; rows: readonly ImportRowView[] }> {
  await requireRight(ctx, 'import:run');
  if (!isUuid(batchId)) throw notFound('That import');
  const found = await db.execute<BatchDbRow>(sql`${BATCH_SELECT} where b.org_id = ${ctx.orgId}::uuid and b.id = ${batchId}::uuid`);
  const row = found.rows[0];
  if (!row || !(row.stream in STREAMS)) throw notFound('That import');
  const rows = await db.execute<{ row_number: number; action: PlanAction | 'skip'; messages: RowIssue[]; parsed: { key?: string; changes?: string[]; after?: Record<string, string> } | null; entity_id: string | null }>(
    sql`select row_number, action, messages, parsed, entity_id from ledger.import_rows where org_id = ${ctx.orgId}::uuid and batch_id = ${batchId}::uuid
         order by (action = 'error') desc, row_number limit 2000`,
  );
  return {
    batch: toView(row),
    rows: rows.rows.map((item) => ({ rowNumber: item.row_number, key: item.parsed?.after?.[KEY_COLUMN[row.stream]] || item.parsed?.key || '', action: item.action, issues: item.messages ?? [], changes: item.parsed?.changes ?? [], entityId: item.entity_id })),
  };
});

/** The rows with problems as a CSV file: row number, column, problem, then the row's own cells. */
export const importErrorReport = scoped(async function importErrorReport(ctx: DomainContext, batchId: string): Promise<{ fileName: string; csv: string }> {
  const { batch } = await getImportBatch(ctx, batchId);
  const rows = await db.execute<{ row_number: number; messages: RowIssue[]; raw: Record<string, string> | null }>(
    sql`select row_number, messages, raw from ledger.import_rows where org_id = ${ctx.orgId}::uuid and batch_id = ${batchId}::uuid and action = 'error' order by row_number`,
  );
  const columns = STREAMS[batch.stream].columns.map((column) => column.key);
  const lines = rows.rows.flatMap((row) =>
    (row.messages.length > 0 ? row.messages : [{ column: null, message: 'This row has a problem.' }]).map((issue) => [row.row_number, issue.column ?? '', issue.message, ...columns.map((column) => row.raw?.[column] ?? '')]),
  );
  return { fileName: `ledger-${batch.stream}-problems.csv`, csv: toCsv(['row', 'column', 'problem', ...columns], lines) };
});

/**
 * The commit: plans the batch again from its raw rows against the database as it is now, then
 * writes every new and changed row. All or nothing by default; with `skipBadRows` a row with a
 * problem (at check or while writing) is left out and the rest go in.
 */
export const commitSetupImport = scoped(async function commitSetupImport(ctx: DomainContext, batchId: string, options: { readonly skipBadRows: boolean }): Promise<ImportCounts> {
  if (!isUuid(batchId)) throw notFound('That import');
  const head = await db.execute<{ stream: SetupStream; status: string }>(sql`select stream, status from ledger.import_batches where org_id = ${ctx.orgId}::uuid and id = ${batchId}::uuid`);
  const found = head.rows[0];
  if (!found || !(found.stream in STREAMS)) throw notFound('That import');
  await assertMayImport(ctx, found.stream);
  const stream = found.stream;
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${`ledger:import:${ctx.orgId}:${stream}`}))`);
    const locked = await tx.execute<{ status: string }>(sql`select status from ledger.import_batches where org_id = ${ctx.orgId}::uuid and id = ${batchId}::uuid for update`);
    if (locked.rows[0]?.status !== 'checked') throw new DomainError('CONFLICT', 'This import is already done. Start a new one to bring the file in again.');
    const raw = await tx.execute<{ row_number: number; raw: Record<string, string> }>(
      sql`select row_number, raw from ledger.import_rows where org_id = ${ctx.orgId}::uuid and batch_id = ${batchId}::uuid order by row_number`,
    );
    const { planned, lookups } = await plan(tx, ctx, stream, raw.rows.map((row) => ({ rowNumber: row.row_number, cells: row.raw ?? {} })));
    const bad = planned.filter((row) => row.action === 'error');
    if (bad.length > 0 && !options.skipBadRows) {
      throw new DomainError('VALIDATION', `${bad.length} row${bad.length === 1 ? ' has' : 's have'} a problem, so nothing was saved. Fix the file, or choose to skip those rows.`);
    }
    const meta = { importBatchId: batchId };
    const results = new Map<number, { action: PlanAction | 'skip'; issues: readonly RowIssue[]; entityId: string | null }>();
    const parentsLater: { number: string; parentNumber: string }[] = [];
    for (const row of planned) {
      if (row.action === 'error' || row.action === 'unchanged') {
        results.set(row.rowNumber, { action: row.action === 'error' ? 'skip' : 'unchanged', issues: row.issues, entityId: row.entityId });
        continue;
      }
      try {
        const entityId = await tx.transaction((savepoint) => applyPlannedRow(savepoint, ctx, stream, row, lookups, meta));
        results.set(row.rowNumber, { action: row.action, issues: [], entityId });
        if (stream === 'accounts' && row.after.parent_number && !lookups.accountIds.has(row.after.parent_number.toLowerCase())) {
          parentsLater.push({ number: row.after.account_number ?? '', parentNumber: row.after.parent_number });
        }
      } catch (error) {
        const mapped = asDomainError(error);
        if (!options.skipBadRows) throw mapped;
        const message = mapped instanceof DomainError ? mapped.message : pgError(error).code ? 'The database refused this row.' : 'This row could not be saved.';
        results.set(row.rowNumber, { action: 'skip', issues: [{ column: null, message }], entityId: row.entityId });
      }
    }
    if (parentsLater.length > 0) await linkParents(tx, ctx, parentsLater);
    for (const [rowNumber, result] of results) {
      await tx.execute(sql`update ledger.import_rows set action = ${result.action}, messages = ${JSON.stringify(result.issues)}::jsonb, entity_id = ${result.entityId}::uuid, updated_at = now()
                            where org_id = ${ctx.orgId}::uuid and batch_id = ${batchId}::uuid and row_number = ${rowNumber}`);
    }
    const tally = { create: 0, update: 0, unchanged: 0, error: 0 };
    for (const result of results.values()) {
      if (result.action === 'skip') tally.error += 1;
      else tally[result.action] += 1;
    }
    const counts = { ...tally, total: planned.length };
    await tx.execute(sql`update ledger.import_batches set status = 'committed', committed_at = now(), create_count = ${counts.create}, update_count = ${counts.update},
                                unchanged_count = ${counts.unchanged}, skip_count = ${counts.error}, error_count = ${counts.error}, updated_at = now()
                          where org_id = ${ctx.orgId}::uuid and id = ${batchId}::uuid`);
    await logActivity(tx, ctx, { verb: 'import.committed', entityType: 'import_batch', entityId: batchId, meta: { stream, ...counts } });
    return counts;
  });
});
