/**
 * Wizard drafts (docs/programs/SPEC.md A11, 2.2.15): private to their author, saved between steps.
 */
import 'server-only';
import { and, desc, eq } from 'drizzle-orm';
import { db } from '@/server/db';
import { wizardDrafts, type WizardDraft } from '@/server/db/schema';
import { invalid, notFound } from '@/server/errors';
import type { WizardDraftDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { versionConflict } from './_program';

const MAX_DRAFT_BYTES = 512 * 1024;

function toDTO(row: WizardDraft): WizardDraftDTO {
  return { id: row.id, title: row.title, step: row.step, payload: row.payload, version: row.version, updatedAt: row.updatedAt.toISOString() };
}

export async function listDrafts(ctx: DomainContext): Promise<WizardDraftDTO[]> {
  const rows = await db.select().from(wizardDrafts).where(and(eq(wizardDrafts.orgId, ctx.orgId), eq(wizardDrafts.userId, ctx.userId))).orderBy(desc(wizardDrafts.updatedAt)).limit(50);
  return rows.map(toDTO);
}

export async function getDraft(ctx: DomainContext, id: string): Promise<WizardDraftDTO> {
  const [row] = await db.select().from(wizardDrafts).where(and(eq(wizardDrafts.id, id), eq(wizardDrafts.orgId, ctx.orgId), eq(wizardDrafts.userId, ctx.userId)));
  if (!row) throw notFound('That draft');
  return toDTO(row);
}

export async function saveDraft(ctx: DomainContext, input: { readonly id?: string; readonly title: string; readonly step: number; readonly payload: Record<string, unknown> }, expectedVersion?: number): Promise<{ id: string; version: number; savedAt: string }> {
  if (JSON.stringify(input.payload).length > MAX_DRAFT_BYTES) throw invalid('This draft is too large to save.');
  const title = input.title.trim().slice(0, 120) || 'Untitled program';
  const step = Math.max(0, Math.min(6, Math.floor(input.step)));
  if (input.id) {
    const [row] = await db.select().from(wizardDrafts).where(and(eq(wizardDrafts.id, input.id), eq(wizardDrafts.orgId, ctx.orgId), eq(wizardDrafts.userId, ctx.userId)));
    if (!row) throw notFound('That draft');
    if (expectedVersion !== undefined && row.version !== expectedVersion) throw versionConflict();
    const [updated] = await db
      .update(wizardDrafts)
      .set({ title, step, payload: input.payload, version: row.version + 1, updatedAt: new Date() })
      .where(and(eq(wizardDrafts.id, row.id), eq(wizardDrafts.version, row.version)))
      .returning();
    if (!updated) throw versionConflict();
    return { id: updated.id, version: updated.version, savedAt: updated.updatedAt.toISOString() };
  }
  const [created] = await db.insert(wizardDrafts).values({ orgId: ctx.orgId, userId: ctx.userId, kind: 'program', title, step, payload: input.payload }).returning();
  return { id: created!.id, version: created!.version, savedAt: created!.updatedAt.toISOString() };
}

export async function deleteDraft(ctx: DomainContext, id: string): Promise<void> {
  await db.delete(wizardDrafts).where(and(eq(wizardDrafts.id, id), eq(wizardDrafts.orgId, ctx.orgId), eq(wizardDrafts.userId, ctx.userId)));
}
