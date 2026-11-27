/**
 * Setup fees and adjustments (docs/programs/SPEC.md D6, 4.2 `one-time.ts`): dated charges outside
 * the versioned card. Setup fees need `pricing:manage`; adjustments need `pricing:propose`. Every
 * write checks the lock of its day and refreshes the ledger in the same transaction.
 */
import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { firstDayOfMonth, lastDayOfMonth, monthOf } from '@kitstak/programs-engine/calendar';
import { db } from '@/server/db';
import { programOneTimeCharges, type ProgramOneTimeCharge } from '@/server/db/schema';
import { forbidden, invalid, notFound } from '@/server/errors';
import type { IsoDate, IsoMonth, OneTimeChargeDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { logActivity } from '../activity';
import { centsOut, lockSettings, versionConflict } from './_program';
import { requireProgram, type ProgramAccess } from './access';
import { emitProgramChanged } from './events';
import { refreshLedgerFor } from './ledger';
import { assertOpen, isLocked, programLocks, type ProgramLocks } from './locks';
import { programJobId } from './postings';

const CENTS = /^-?\d{1,13}$/;

export interface OneTimeInput {
  readonly kind: 'setup' | 'adjustment';
  readonly chargeOn: IsoDate;
  readonly amountCents: string;
  readonly label: string;
  readonly reason?: string | null;
  readonly variantId?: string | null;
  readonly countsTowardMinimum?: boolean;
}

export function toOneTimeDTO(row: ProgramOneTimeCharge, hidden: boolean, locks: ProgramLocks | null, goesToJob: boolean): OneTimeChargeDTO {
  return {
    id: row.id,
    kind: row.kind,
    chargeOn: row.chargeOn,
    amountCents: centsOut(row.amountCents, hidden),
    label: row.label,
    reason: row.reason,
    variantId: row.variantId,
    countsTowardMinimum: row.countsTowardMinimum,
    locked: Boolean(locks && isLocked(locks, row.chargeOn, { goesToJob })),
    version: row.version,
  };
}

export async function listOneTimeCharges(ctx: DomainContext, key: string, options: { readonly month?: IsoMonth } = {}): Promise<OneTimeChargeDTO[]> {
  const access = await requireProgram(ctx, key);
  const conditions = [eq(programOneTimeCharges.programId, access.program.id), isNull(programOneTimeCharges.deletedAt)];
  if (options.month) conditions.push(sql`${programOneTimeCharges.chargeOn} between ${firstDayOfMonth(options.month)}::date and ${lastDayOfMonth(options.month)}::date`);
  const rows = await db.select().from(programOneTimeCharges).where(and(...conditions)).orderBy(asc(programOneTimeCharges.chargeOn));
  const locks = await programLocks(ctx, access.program);
  const goesToJob = Boolean(await programJobId(db, ctx, access.program.id));
  return rows.map((row) => toOneTimeDTO(row, !access.caps.seesMoney, locks, goesToJob));
}

function assertInput(input: OneTimeInput): void {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.chargeOn)) throw invalid('Pick a valid date.', { chargeOn: 'Pick a valid date.' });
  if (!CENTS.test(input.amountCents) || input.amountCents === '0' || input.amountCents === '-0') throw invalid('Enter an amount.', { amountCents: 'Enter an amount.' });
  if (input.kind === 'setup' && input.amountCents.startsWith('-')) throw invalid('A setup fee cannot be below $0. Add an adjustment for a credit.', { amountCents: 'Use a positive amount.' });
  if (!input.label.trim()) throw invalid('Give the charge a name.', { label: 'Give the charge a name.' });
  if (input.label.trim().length > 80) throw invalid('Use up to 80 characters for the name.', { label: 'Use up to 80 characters.' });
  if (input.kind === 'adjustment' && !input.reason?.trim()) throw invalid('Say why you are adjusting the bill.', { reason: 'Say why you are adjusting the bill.' });
  if ((input.reason?.trim().length ?? 0) > 500) throw invalid('Use up to 500 characters for the reason.', { reason: 'Use up to 500 characters.' });
  if (input.kind === 'setup' && input.variantId) throw invalid('Only adjustments can name a variant.');
}

function assertPermission(access: ProgramAccess, kind: 'setup' | 'adjustment'): void {
  if (kind === 'setup' && !access.caps.canPrice) throw forbidden('Only program owners can add setup fees.');
  if (kind === 'adjustment' && !access.caps.canPropose) throw forbidden('Only program editors can add adjustments.');
}

export async function addOneTimeCharge(ctx: DomainContext, key: string, input: OneTimeInput): Promise<OneTimeChargeDTO> {
  const access = await requireProgram(ctx, key, 'pricing:propose');
  assertPermission(access, input.kind);
  assertInput(input);
  const row = await db.transaction(async (tx) => {
    await lockSettings(tx, [access.program.id], 'update');
    const locks = await programLocks(ctx, access.program, tx);
    const goesToJob = Boolean(await programJobId(tx, ctx, access.program.id));
    assertOpen(locks, input.chargeOn, { goesToJob });
    const [created] = await tx
      .insert(programOneTimeCharges)
      .values({
        orgId: ctx.orgId,
        programId: access.program.id,
        kind: input.kind,
        chargeOn: input.chargeOn,
        amountCents: BigInt(input.amountCents),
        label: input.label.trim().slice(0, 80),
        reason: input.reason?.trim() || null,
        variantId: input.variantId ?? null,
        countsTowardMinimum: input.kind === 'adjustment' ? Boolean(input.countsTowardMinimum) : false,
        createdBy: ctx.actorKind === 'user' ? ctx.userId : null,
      })
      .returning();
    await refreshLedgerFor(tx, ctx, { programIds: [access.program.id], dates: [input.chargeOn] });
    await logActivity(tx, ctx, { verb: 'one_time.added', entityType: 'one_time_charge', entityId: created!.id, projectId: access.program.id, after: { kind: input.kind, label: created!.label, chargeOn: input.chargeOn, money: { amountCents: input.amountCents } } });
    await emitProgramChanged(tx, ctx, access.program.id);
    return created!;
  });
  return toOneTimeDTO(row, !access.caps.seesMoney, null, false);
}

async function loadCharge(ctx: DomainContext, id: string) {
  const [row] = await db.select().from(programOneTimeCharges).where(and(eq(programOneTimeCharges.id, id), eq(programOneTimeCharges.orgId, ctx.orgId), isNull(programOneTimeCharges.deletedAt)));
  if (!row) throw notFound('That charge');
  const access = await requireProgram(ctx, { id: row.programId }, 'pricing:propose');
  assertPermission(access, row.kind);
  return { row, access };
}

export async function updateOneTimeCharge(ctx: DomainContext, id: string, patch: Partial<OneTimeInput>, expectedVersion: number): Promise<OneTimeChargeDTO> {
  const { row, access } = await loadCharge(ctx, id);
  if (row.version !== expectedVersion) throw versionConflict();
  const next: OneTimeInput = {
    kind: row.kind,
    chargeOn: patch.chargeOn ?? row.chargeOn,
    amountCents: patch.amountCents ?? row.amountCents.toString(),
    label: patch.label ?? row.label,
    reason: patch.reason !== undefined ? patch.reason : row.reason,
    variantId: patch.variantId !== undefined ? patch.variantId : row.variantId,
    countsTowardMinimum: patch.countsTowardMinimum ?? row.countsTowardMinimum,
  };
  assertInput(next);
  const updated = await db.transaction(async (tx) => {
    await lockSettings(tx, [access.program.id], 'update');
    const locks = await programLocks(ctx, access.program, tx);
    const goesToJob = Boolean(await programJobId(tx, ctx, access.program.id));
    assertOpen(locks, row.chargeOn, { goesToJob });
    assertOpen(locks, next.chargeOn, { goesToJob });
    const rows = await tx
      .update(programOneTimeCharges)
      .set({
        chargeOn: next.chargeOn,
        amountCents: BigInt(next.amountCents),
        label: next.label.trim().slice(0, 80),
        reason: next.reason?.trim() || null,
        variantId: next.variantId ?? null,
        countsTowardMinimum: row.kind === 'adjustment' ? Boolean(next.countsTowardMinimum) : false,
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(programOneTimeCharges.id, id), eq(programOneTimeCharges.version, expectedVersion)))
      .returning();
    if (rows.length === 0) throw versionConflict();
    await refreshLedgerFor(tx, ctx, { programIds: [access.program.id], months: [monthOf(row.chargeOn), monthOf(next.chargeOn)] });
    await logActivity(tx, ctx, { verb: 'one_time.updated', entityType: 'one_time_charge', entityId: id, projectId: access.program.id, before: { chargeOn: row.chargeOn, money: { amountCents: row.amountCents.toString() } }, after: { chargeOn: next.chargeOn, money: { amountCents: next.amountCents } } });
    await emitProgramChanged(tx, ctx, access.program.id);
    return rows[0]!;
  });
  return toOneTimeDTO(updated, !access.caps.seesMoney, null, false);
}

export async function deleteOneTimeCharge(ctx: DomainContext, id: string): Promise<void> {
  const { row, access } = await loadCharge(ctx, id);
  await db.transaction(async (tx) => {
    await lockSettings(tx, [access.program.id], 'update');
    const locks = await programLocks(ctx, access.program, tx);
    assertOpen(locks, row.chargeOn, { goesToJob: Boolean(await programJobId(tx, ctx, access.program.id)) });
    await tx.update(programOneTimeCharges).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(programOneTimeCharges.id, id));
    await refreshLedgerFor(tx, ctx, { programIds: [access.program.id], dates: [row.chargeOn] });
    await logActivity(tx, ctx, { verb: 'one_time.deleted', entityType: 'one_time_charge', entityId: id, projectId: access.program.id, before: { label: row.label, chargeOn: row.chargeOn, money: { amountCents: row.amountCents.toString() } } });
    await emitProgramChanged(tx, ctx, access.program.id);
  });
}
