/**
 * Labor classes (docs/crew/SPEC.md 5.1 and 8.2). Standalone, Crew owns them. Rows with
 * `source = 'pulse'` are a mirror of Pulse (the Phase 8 sync makes them): read only here, edited in
 * Pulse. One class can be the default for new people.
 */
import 'server-only';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { laborClasses, people } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { requireCrew } from './access';
import { cleanText, inTx, type DomainContext } from './_shared';
import { logActivity } from './activity';

export const LABOR_CLASS_KINDS = ['employee', 'temp_agency'] as const;
export type LaborClassKind = (typeof LABOR_CLASS_KINDS)[number];

export interface LaborClassRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly kind: LaborClassKind;
  readonly isDefault: boolean;
  /** Mirrored from Pulse: read only in Crew. */
  readonly fromPulse: boolean;
  readonly peopleCount: number;
}

export const listLaborClasses = scoped(async function listLaborClasses(ctx: DomainContext): Promise<LaborClassRow[]> {
  await requireCrew(ctx, 'crew:read');
  const [rows, counts] = await Promise.all([
    db.select().from(laborClasses).where(and(eq(laborClasses.orgId, ctx.orgId), isNull(laborClasses.deletedAt), isNull(laborClasses.archivedAt))).orderBy(asc(laborClasses.name)),
    db.select({ id: people.laborClassId, n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), isNull(people.deletedAt), ne(people.status, 'ended'))).groupBy(people.laborClassId),
  ]);
  const byClass = new Map(counts.map((row) => [row.id, row.n]));
  return rows.map((row) => ({ id: row.id, code: row.code, name: row.name, kind: row.kind as LaborClassKind, isDefault: row.isDefault, fromPulse: row.source === 'pulse', peopleCount: byClass.get(row.id) ?? 0 }));
});

export interface LaborClassInput {
  readonly code: string;
  readonly name: string;
  readonly kind: LaborClassKind;
  readonly isDefault?: boolean;
}

function clean(input: LaborClassInput): LaborClassInput {
  const code = cleanText(input.code)?.toUpperCase() ?? '';
  const name = cleanText(input.name) ?? '';
  const fields: Record<string, string> = {};
  if (!code || code.length > 20 || /\s/.test(code)) fields.code = 'Type a short code with no spaces, like TEMP.';
  if (!name || name.length > 80) fields.name = 'Type a name.';
  if (!(LABOR_CLASS_KINDS as readonly string[]).includes(input.kind)) fields.kind = 'Pick employee or temp agency.';
  if (Object.keys(fields).length > 0) throw invalid('Some fields need another look.', fields);
  return { ...input, code, name };
}

export const createLaborClass = scoped(async function createLaborClass(ctx: DomainContext, input: LaborClassInput): Promise<{ readonly id: string }> {
  await requireCrew(ctx, 'settings:manage');
  const row = clean(input);
  return inTx(async (tx) => {
    if (row.isDefault) await tx.update(laborClasses).set({ isDefault: false }).where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.isDefault, true)));
    const [made] = await tx
      .insert(laborClasses)
      .values({ orgId: ctx.orgId, code: row.code, name: row.name, kind: row.kind, isDefault: row.isDefault ?? false, createdBy: ctx.userId, updatedBy: ctx.userId })
      .returning({ id: laborClasses.id });
    await logActivity(tx, ctx, { verb: 'labor_class.created', entityType: 'labor_class', entityId: made!.id, after: { code: row.code, name: row.name, kind: row.kind } });
    return { id: made!.id };
  });
});

async function editable(tx: Parameters<Parameters<typeof inTx>[0]>[0], ctx: DomainContext, id: string) {
  const [current] = await tx.select().from(laborClasses).where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.id, id), isNull(laborClasses.deletedAt))).for('update');
  if (!current) throw notFound('That labor class');
  if (current.source === 'pulse') throw conflict('This labor class comes from Pulse. Edit it in Pulse.');
  return current;
}

export const updateLaborClass = scoped(async function updateLaborClass(ctx: DomainContext, id: string, input: LaborClassInput): Promise<void> {
  await requireCrew(ctx, 'settings:manage');
  const row = clean(input);
  await inTx(async (tx) => {
    const current = await editable(tx, ctx, id);
    if (row.isDefault && !current.isDefault) await tx.update(laborClasses).set({ isDefault: false }).where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.isDefault, true)));
    await tx
      .update(laborClasses)
      .set({ code: row.code, name: row.name, kind: row.kind, isDefault: row.isDefault ?? current.isDefault, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.id, id)));
    await logActivity(tx, ctx, { verb: 'labor_class.updated', entityType: 'labor_class', entityId: id, before: { code: current.code, name: current.name, kind: current.kind }, after: { code: row.code, name: row.name, kind: row.kind } });
  });
});

export const archiveLaborClass = scoped(async function archiveLaborClass(ctx: DomainContext, id: string): Promise<void> {
  await requireCrew(ctx, 'settings:manage');
  await inTx(async (tx) => {
    const current = await editable(tx, ctx, id);
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.laborClassId, id), isNull(people.deletedAt), ne(people.status, 'ended')));
    if ((used?.n ?? 0) > 0) throw conflict(`${used!.n} ${used!.n === 1 ? 'person is' : 'people are'} in this labor class. Move them first.`);
    await tx.update(laborClasses).set({ archivedAt: new Date(), deletedAt: new Date(), isDefault: false, updatedAt: new Date() }).where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.id, id)));
    await logActivity(tx, ctx, { verb: 'labor_class.archived', entityType: 'labor_class', entityId: id, before: { code: current.code, name: current.name } });
  });
});
