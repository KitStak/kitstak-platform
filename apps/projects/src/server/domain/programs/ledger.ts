/**
 * The ledger writer (docs/programs/SPEC.md A13, 4.3.2). Posted fees live in `pm.program_ledger`;
 * this module is the only writer. It runs inside the transaction that changed an input, so the
 * ledger always matches the engine for open months. Locked rows are never written or removed.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { loadProgramMonthInputs } from '@kitstak/db/programs';
import { addDays, endOfMonth, firstDayOfMonth, lastDayOfMonth, monthOf, shiftMonth } from '@kitstak/programs-engine/calendar';
import { ledgerRows, monthCharges, type MonthResult } from '@kitstak/programs-engine/month';
import type { IsoDate, IsoMonth, LedgerRow } from '@kitstak/programs-engine/types';
import type { Executor } from '@/server/db';
import type { DomainContext } from '../_shared';
import { lockSettings, monthsOf, shared, todayInZone } from './_program';
import { isLocked, programLocks, type ProgramLocks } from './locks';
import { feePosting, resolvePostings } from './postings';

export interface RefreshInput {
  readonly programIds: readonly (string | null | undefined)[];
  readonly months?: readonly IsoMonth[];
  readonly dates?: readonly (IsoDate | null | undefined)[];
}

export interface RefreshResult {
  readonly written: number;
  readonly removed: number;
  readonly skippedLocked: number;
}

interface ProgramRow {
  id: string;
  key: string;
  timezone: string;
}

async function programRows(tx: Executor, ctx: DomainContext, ids: readonly string[]): Promise<ProgramRow[]> {
  if (ids.length === 0) return [];
  const list = sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `);
  const result = await tx.execute(
    sql`select p.id::text as id, p.key, ps.timezone from pm.projects p
          join pm.program_settings ps on ps.program_id = p.id
         where p.org_id = ${ctx.orgId}::uuid and p.id in (${list}) and p.kind = 'program'`,
  );
  return (result as unknown as { rows: ProgramRow[] }).rows;
}

/** Writes one month of posted fees for one program. */
async function writeMonth(tx: Executor, ctx: DomainContext, program: ProgramRow, month: IsoMonth, locks: ProgramLocks, fee: { posting: 'program' | 'program_job'; jobId: string | null }): Promise<RefreshResult> {
  const goesToJob = fee.posting === 'program_job';
  const monthStart = firstDayOfMonth(month);
  if (isLocked(locks, monthStart, { goesToJob })) return { written: 0, removed: 0, skippedLocked: 1 };
  const inputs = await loadProgramMonthInputs(shared(tx), ctx.orgId, program.id, month);
  const result = monthCharges({ ...inputs, asOf: todayInZone(program.timezone) });
  const rows = ledgerRows(result);
  // Locked rows keep their posting (4.3.3): a stored row is locked when its day is locked under
  // the posting it was written with (a month closed in Pulse stays closed for a program_job row
  // after the job is unlinked), or under the posting it would get now.
  const stored = await tx.execute(
    sql`select ref, charge_date::text as charge_date, posting from pm.program_ledger
         where org_id = ${ctx.orgId}::uuid and program_id = ${program.id}::uuid and month = ${monthStart}::date and deleted_at is null`,
  );
  const lockedRefs = new Set(
    (stored as unknown as { rows: { ref: string; charge_date: string; posting: string }[] }).rows
      .filter((row) => isLocked(locks, row.charge_date, { goesToJob: row.posting === 'program_job' }) || isLocked(locks, row.charge_date, { goesToJob }))
      .map((row) => row.ref),
  );
  let written = 0;
  let skippedLocked = 0;
  for (const row of rows) {
    if (lockedRefs.has(row.ref) || isLocked(locks, row.chargeDate, { goesToJob })) {
      skippedLocked += 1;
      continue;
    }
    await upsertRow(tx, ctx, program.id, row, fee);
    written += 1;
  }
  const untouchable = [...new Set([...rows.map((row) => row.ref), ...lockedRefs])];
  const keep = untouchable.length > 0 ? sql` and ref not in (${sql.join(untouchable.map((ref) => sql`${ref}`), sql`, `)})` : sql``;
  const removed = await tx.execute(
    sql`update pm.program_ledger set deleted_at = now(), updated_at = now()
         where org_id = ${ctx.orgId}::uuid and program_id = ${program.id}::uuid and month = ${monthStart}::date
           and deleted_at is null${keep}
         returning id`,
  );
  return { written, removed: (removed as unknown as { rows: unknown[] }).rows.length, skippedLocked };
}

async function upsertRow(tx: Executor, ctx: DomainContext, programId: string, row: LedgerRow, fee: { posting: 'program' | 'program_job'; jobId: string | null }): Promise<void> {
  const month = firstDayOfMonth(monthOf(row.chargeDate));
  await tx.execute(
    sql`insert into pm.program_ledger
          (org_id, program_id, ref, kind, charge_date, month, cents, quantity, unit_price, variant_id, build_id, version_id,
           line_id, one_time_id, label, counts_toward_minimum, posting, pulse_job_id, computed_at)
        values (${ctx.orgId}::uuid, ${programId}::uuid, ${row.ref}, ${row.kind}, ${row.chargeDate}::date, ${month}::date,
                ${row.cents.toString()}::bigint, ${row.quantity}::numeric, ${row.unitPrice}::numeric,
                ${row.variantId}::uuid, ${row.buildId}::uuid, ${row.versionId}::uuid, ${row.lineId}::uuid, ${row.oneTimeId}::uuid,
                ${row.label}, ${row.countsTowardMinimum}, ${fee.posting}, ${fee.jobId}::uuid, now())
        on conflict (org_id, ref) where deleted_at is null do update set
          kind = excluded.kind, charge_date = excluded.charge_date, month = excluded.month, cents = excluded.cents,
          quantity = excluded.quantity, unit_price = excluded.unit_price, variant_id = excluded.variant_id,
          build_id = excluded.build_id, version_id = excluded.version_id, line_id = excluded.line_id,
          one_time_id = excluded.one_time_id, label = excluded.label, counts_toward_minimum = excluded.counts_toward_minimum,
          posting = excluded.posting, pulse_job_id = excluded.pulse_job_id, computed_at = now(), updated_at = now()
        where (program_ledger.cents, program_ledger.quantity, program_ledger.unit_price, program_ledger.label, program_ledger.posting,
               program_ledger.pulse_job_id, program_ledger.charge_date, program_ledger.counts_toward_minimum)
              is distinct from (excluded.cents, excluded.quantity, excluded.unit_price, excluded.label, excluded.posting,
               excluded.pulse_job_id, excluded.charge_date, excluded.counts_toward_minimum)`,
  );
}

/**
 * Recomputes the posted fees of the given programs for the touched months (each month that has
 * an open day), in the caller's transaction (4.3.2). Settings rows are locked `FOR UPDATE` in
 * program id order first, the one lock order of every money writer.
 */
export async function refreshLedgerFor(tx: Executor, ctx: DomainContext, input: RefreshInput): Promise<RefreshResult> {
  const ids = [...new Set(input.programIds.filter((id): id is string => Boolean(id)))].sort();
  if (ids.length === 0) return { written: 0, removed: 0, skippedLocked: 0 };
  await lockSettings(tx, ids, 'update');
  const months = [...new Set([...(input.months ?? []), ...monthsOf(input.dates ?? [])])].sort();
  if (months.length === 0) return { written: 0, removed: 0, skippedLocked: 0 };
  const total = { written: 0, removed: 0, skippedLocked: 0 };
  for (const program of await programRows(tx, ctx, ids)) {
    const locks = await programLocks(ctx, program, tx);
    const fee = feePosting(await resolvePostings(tx, ctx, { programId: program.id, buildIds: [] }));
    for (const month of months) {
      const result = await writeMonth(tx, ctx, program, month, locks, fee);
      total.written += result.written;
      total.removed += result.removed;
      total.skippedLocked += result.skippedLocked;
    }
  }
  return total;
}

/** Every month from `from` (inclusive) through the current month of the program, at most 36. */
export function monthsFrom(from: IsoDate, today: IsoDate): IsoMonth[] {
  const out: IsoMonth[] = [];
  let month = monthOf(from < today ? from : today);
  const last = monthOf(today);
  while (month <= last && out.length < 36) {
    out.push(month);
    month = shiftMonth(month, 1);
  }
  if (from > today) out.push(...monthsOf([from]).filter((m) => !out.includes(m)));
  return out;
}

/**
 * The sweep step (4.3.2, 4.9): refreshes the current month (monthly fee on the first active day,
 * setup fees and adjustments that came due) and every month that ended since `settled_through`
 * (the minimum top up), then moves `settled_through` to the last ended month. Locked months are
 * skipped and still count as settled.
 */
export async function settleDue(tx: Executor, ctx: DomainContext, programId: string): Promise<{ settledThrough: IsoDate | null; months: IsoMonth[] }> {
  await lockSettings(tx, [programId], 'update');
  const facts = await tx.execute(
    sql`select ps.timezone, ps.settled_through::text as settled_through, p.start_date::text as start_date, p.due_date::text as due_date
          from pm.program_settings ps join pm.projects p on p.id = ps.program_id
         where ps.program_id = ${programId}::uuid and p.org_id = ${ctx.orgId}::uuid and p.deleted_at is null`,
  );
  const row = (facts as unknown as { rows: { timezone: string; settled_through: string | null; start_date: string | null; due_date: string | null }[] }).rows[0];
  if (!row) return { settledThrough: null, months: [] };
  const today = todayInZone(row.timezone);
  const current = monthOf(today);
  const lastEnded = endOfMonth(firstDayOfMonth(shiftMonth(current, -1)));
  const firstMonth = row.settled_through
    ? monthOf(addDays(row.settled_through, 1))
    : monthOf(row.start_date && row.start_date < today ? row.start_date : today);
  const months: IsoMonth[] = [];
  for (let month = firstMonth; month <= current && months.length < 36; month = shiftMonth(month, 1)) months.push(month);
  if (!months.includes(current)) months.push(current);
  await refreshLedgerFor(tx, ctx, { programIds: [programId], months });
  const startMonth = row.start_date ? monthOf(row.start_date) : null;
  const settled = startMonth && startMonth > monthOf(lastEnded) ? row.settled_through : lastEnded;
  if (settled && settled !== row.settled_through) {
    await tx.execute(sql`update pm.program_settings set settled_through = ${settled}::date, updated_at = now() where program_id = ${programId}::uuid`);
  }
  return { settledThrough: settled ?? null, months };
}

/** The engine's view of one program month, on the program clock (summaries and previews). */
export async function computeMonth(executor: Executor, ctx: DomainContext, programId: string, month: IsoMonth, timezone: string): Promise<MonthResult> {
  const inputs = await loadProgramMonthInputs(shared(executor), ctx.orgId, programId, month);
  return monthCharges({ ...inputs, asOf: todayInZone(timezone) });
}

export { lastDayOfMonth };
