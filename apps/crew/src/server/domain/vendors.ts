/**
 * Crew's one way to write the shared vendor list (core.vendors, docs/crew/SPEC.md 5.2). Adding an
 * agency whose name matches a live vendor adds `temp_agency` to its kinds instead of making a
 * second row, so Crew, Ledger and later WMS all name the same company.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { isVendorKind, vendors, type Vendor, type VendorKind } from '@kitstak/db/schema';
import type { Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { invalid } from '@/server/errors';
import { cleanText, type DomainContext } from './_shared';
import { logActivity } from './activity';

export interface VendorInput {
  readonly name: string;
  readonly kind: VendorKind;
  readonly email?: string | null;
  readonly phone?: string | null;
}

/** The kinds after adding one, in a stable order. Pure. */
export function withKind(kinds: readonly string[], kind: VendorKind): VendorKind[] {
  const set = new Set(kinds.filter(isVendorKind));
  set.add(kind);
  return [...set].sort();
}

export const upsertVendorKind = scoped(async function upsertVendorKind(executor: Executor, ctx: DomainContext, input: VendorInput): Promise<{ vendor: Vendor; created: boolean }> {
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the agency a name.', { name: 'Type a name.' });
  if (!isVendorKind(input.kind)) throw invalid('That is not a kind of vendor Crew knows.');
  const [found] = await executor
    .select()
    .from(vendors)
    .where(and(eq(vendors.orgId, ctx.orgId), sql`lower(${vendors.name}) = lower(${name})`, isNull(vendors.archivedAt), isNull(vendors.deletedAt)))
    .limit(1);
  if (found) {
    if (found.kinds.includes(input.kind)) return { vendor: found, created: false };
    const kinds = withKind(found.kinds, input.kind);
    const [updated] = await executor
      .update(vendors)
      .set({ kinds, updatedBy: ctx.actorKind === 'user' ? ctx.userId : null, updatedAt: new Date(), version: sql`${vendors.version} + 1` })
      .where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.id, found.id)))
      .returning();
    await logActivity(executor, ctx, { verb: 'vendor.kind_added', entityType: 'vendor', entityId: found.id, before: { kinds: found.kinds }, after: { kinds } });
    return { vendor: updated!, created: false };
  }
  const [made] = await executor
    .insert(vendors)
    .values({
      orgId: ctx.orgId,
      name,
      kinds: [input.kind],
      email: cleanText(input.email),
      phone: cleanText(input.phone),
      createdBy: ctx.actorKind === 'user' ? ctx.userId : null,
      updatedBy: ctx.actorKind === 'user' ? ctx.userId : null,
    })
    .returning();
  await logActivity(executor, ctx, { verb: 'vendor.created', entityType: 'vendor', entityId: made!.id, after: { name, kinds: [input.kind] } });
  return { vendor: made!, created: true };
}, 1);
