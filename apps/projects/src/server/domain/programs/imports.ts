/**
 * Imports (docs/programs/SPEC.md 4.2 `imports.ts`, B.2): output CSVs and plan CSVs or pastes.
 * The preview reads the file with the engine parsers and returns a token that holds the parsed
 * rows; the commit runs them through `logOutput` (making a build per day and variant when none
 * exists, `planned_from = 'import'`) or `createBuilds`, respecting locks and reporting refused days.
 */
import 'server-only';
import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { parseOutputCsv, parsePlanCsv, parsePlanPaste, type VariantMatch } from '@kitstak/programs-engine/import';
import { fromScaled, quantityToScaled, ZERO } from '@kitstak/programs-engine/money';
import { db } from '@/server/db';
import { programVariants } from '@/server/db/schema';
import { invalid } from '@/server/errors';
import { env } from '@/server/env';
import type { ImportPreviewDTO, IsoDate } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { requireProgram } from './access';
import { createBuilds, insertBuild } from './builds';
import { isLocked, lockMessage, programLocks } from './locks';
import { logOutput } from './output';
import { todayInZone } from './_program';

const MAX_TEXT = 2 * 1024 * 1024;

interface TokenBody {
  readonly kind: 'output' | 'plan';
  readonly programId: string;
  readonly rows: readonly { date: IsoDate; variantId: string; qty: string; scrapQty: string | null }[];
}

function sign(body: string): string {
  return createHash('sha256').update(`${env.BETTER_AUTH_SECRET}:${body}`).digest('base64url').slice(0, 32);
}

function encode(body: TokenBody): string {
  const json = Buffer.from(JSON.stringify(body), 'utf8').toString('base64url');
  return `${json}.${sign(json)}`;
}

function decode(token: string, kind: 'output' | 'plan', programId: string): TokenBody {
  const [json, signature] = token.split('.');
  if (!json || !signature || sign(json) !== signature) throw invalid('This preview has expired. Upload the file again.');
  const body = JSON.parse(Buffer.from(json, 'base64url').toString('utf8')) as TokenBody;
  if (body.kind !== kind || body.programId !== programId) throw invalid('This preview is for another import. Upload the file again.');
  return body;
}

async function variantsOf(programId: string): Promise<{ list: VariantMatch[]; names: Map<string, string> }> {
  const rows = await db.select().from(programVariants).where(and(eq(programVariants.programId, programId), isNull(programVariants.deletedAt)));
  return { list: rows.map((row) => ({ id: row.id, key: row.key, name: row.name, sku: row.sku })), names: new Map(rows.map((row) => [row.id, row.name])) };
}

function unmatchedOf(report: { unmatched: readonly { line: number; raw: string; why: string }[] }): ImportPreviewDTO['unmatched'] {
  const byWhy = new Map<string, { token: string; lines: number[]; message: string }>();
  for (const item of report.unmatched) {
    const entry = byWhy.get(item.why) ?? { token: item.raw, lines: [], message: item.why };
    entry.lines.push(item.line);
    byWhy.set(item.why, entry);
  }
  return [...byWhy.values()];
}

export async function previewOutputImport(ctx: DomainContext, key: string, text: string): Promise<ImportPreviewDTO> {
  if (text.length > MAX_TEXT) throw invalid('This file is too large. Split it into smaller files.');
  const access = await requireProgram(ctx, key, 'output:log');
  const { list, names } = await variantsOf(access.program.id);
  const parsed = parseOutputCsv({ text, variants: list });
  const locks = await programLocks(ctx, access.program);
  const today = todayInZone(access.settings.timezone);
  const existing = await db.execute(sql`select variant_id::text as variant_id, build_date::text as date from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null where b.program_id = ${access.program.id}::uuid`);
  const has = new Set((existing as unknown as { rows: { variant_id: string; date: string }[] }).rows.map((row) => `${row.variant_id}|${row.date}`));
  const refused = new Map<string, string>();
  const rows = parsed.rows.map((row, index) => {
    const lockedDay = isLocked(locks, row.workDate, { goesToJob: true });
    const future = row.workDate > today;
    if (lockedDay) refused.set(row.workDate, lockMessage(locks, row.workDate, 'program'));
    if (future) refused.set(row.workDate, 'Output can be logged for today or earlier.');
    return {
      line: index + 1,
      date: row.workDate,
      variantId: row.variantId,
      variantName: names.get(row.variantId) ?? 'Variant',
      qty: row.qty,
      scrapQty: row.scrapQty,
      action: lockedDay || future ? ('refused' as const) : has.has(`${row.variantId}|${row.workDate}`) ? ('log' as const) : ('create_and_log' as const),
      note: lockedDay || future ? (refused.get(row.workDate) ?? null) : null,
    };
  });
  const accepted = rows.filter((row) => row.action !== 'refused');
  return {
    kind: 'output',
    token: encode({ kind: 'output', programId: access.program.id, rows: accepted.map((row) => ({ date: row.date, variantId: row.variantId, qty: row.qty, scrapQty: row.scrapQty })) }),
    rows,
    unmatched: unmatchedOf(parsed),
    problems: parsed.notes.map((note) => ({ line: note.line ?? 0, message: note.text })),
    refusedDays: [...refused.entries()].map(([date, reason]) => ({ date, reason })),
    totals: { rows: accepted.length, units: fromScaled(accepted.reduce((sum, row) => sum + quantityToScaled(row.qty), ZERO), 3), builds: accepted.filter((row) => row.action === 'create_and_log').length },
  };
}

export async function commitOutputImport(ctx: DomainContext, key: string, token: string): Promise<{ created: number; logged: number; refused: number }> {
  const access = await requireProgram(ctx, key, 'output:log');
  const body = decode(token, 'output', access.program.id);
  const byDate = new Map<IsoDate, TokenBody['rows'][number][]>();
  for (const row of body.rows) byDate.set(row.date, [...(byDate.get(row.date) ?? []), row]);
  let created = 0;
  let logged = 0;
  let refused = 0;
  for (const [date, rows] of [...byDate.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    const container = { project: access.program, settings: access.settings, programId: access.program.id, seesMoney: access.caps.seesMoney, timezone: access.settings.timezone };
    const existing = await db.execute(
      sql`select distinct on (b.variant_id) b.task_id::text as id, b.variant_id::text as variant_id from pm.builds b join pm.tasks t on t.id = b.task_id and t.deleted_at is null join pm.statuses s on s.id = t.status_id
           where b.program_id = ${access.program.id}::uuid and b.build_date = ${date}::date and s.category <> 'cancelled' order by b.variant_id, t.position`,
    );
    const buildOf = new Map((existing as unknown as { rows: { id: string; variant_id: string }[] }).rows.map((row) => [row.variant_id, row.id]));
    try {
      for (const row of rows) {
        if (buildOf.has(row.variantId)) continue;
        const build = await db.transaction((tx) => insertBuild(tx, ctx, container, { variantId: row.variantId, buildDate: date, plannedQty: row.qty, plannedFrom: 'import' }));
        buildOf.set(row.variantId, build.taskId);
        created += 1;
      }
      await logOutput(ctx, access.program.key, { date, entries: rows.map((row) => ({ buildId: buildOf.get(row.variantId)!, mode: 'add' as const, qty: row.qty, scrapQty: row.scrapQty ?? undefined })) });
      logged += rows.length;
    } catch {
      refused += rows.length;
    }
  }
  return { created, logged, refused };
}

export async function previewPlanImport(ctx: DomainContext, key: string, text: string, options: { readonly dates?: readonly IsoDate[] } = {}): Promise<ImportPreviewDTO> {
  if (text.length > MAX_TEXT) throw invalid('This file is too large. Split it into smaller files.');
  const access = await requireProgram(ctx, key, 'build:plan');
  const { list, names } = await variantsOf(access.program.id);
  const parsed = options.dates?.length ? parsePlanPaste({ text, variants: list, dates: options.dates }) : parsePlanCsv({ text, variants: list });
  const cells = 'cells' in parsed ? parsed.cells.map((c) => ({ date: c.date, variantId: c.variantId, qty: c.qty })) : parsed.rows.map((r) => ({ date: r.buildDate, variantId: r.variantId, qty: r.qty }));
  const locks = await programLocks(ctx, access.program);
  const refused = new Map<string, string>();
  const rows = cells.map((cell, index) => {
    const lockedDay = isLocked(locks, cell.date, { goesToJob: false });
    if (lockedDay) refused.set(cell.date, lockMessage(locks, cell.date, 'program'));
    return { line: index + 1, date: cell.date, variantId: cell.variantId, variantName: names.get(cell.variantId) ?? 'Variant', qty: cell.qty, scrapQty: null, action: lockedDay ? ('refused' as const) : ('create' as const), note: lockedDay ? (refused.get(cell.date) ?? null) : null };
  });
  const accepted = rows.filter((row) => row.action !== 'refused');
  return {
    kind: 'plan',
    token: encode({ kind: 'plan', programId: access.program.id, rows: accepted.map((row) => ({ date: row.date, variantId: row.variantId, qty: row.qty, scrapQty: null })) }),
    rows,
    unmatched: unmatchedOf(parsed),
    problems: parsed.notes.map((note) => ({ line: note.line ?? 0, message: note.text })),
    refusedDays: [...refused.entries()].map(([date, reason]) => ({ date, reason })),
    totals: { rows: accepted.length, units: fromScaled(accepted.reduce((sum, row) => sum + quantityToScaled(row.qty), ZERO), 3), builds: accepted.length },
  };
}

export async function commitPlanImport(ctx: DomainContext, key: string, token: string): Promise<{ created: number; logged: number; refused: number; createdIds: string[] }> {
  const access = await requireProgram(ctx, key, 'build:plan');
  const body = decode(token, 'plan', access.program.id);
  const result = await createBuilds(ctx, access.program.key, body.rows.map((row) => ({ variantId: row.variantId, buildDate: row.date, plannedQty: row.qty })), { plannedFrom: 'import' });
  return { created: result.createdIds.length, logged: 0, refused: result.skipped.length, createdIds: result.createdIds };
}
