/**
 * Looks up the record a detail URL names (`/invoices/INV-1042`, `/bills/<id>`, `/customers/<id>`),
 * by number or id, in the person's workspace. Unknown refs answer null and the page shows the
 * helpful not found page (SPEC 9.9). One small reader for every detail route.
 */
import 'server-only';
import { sql, type SQL } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { isUuid, type DomainContext } from './_shared';

export const RECORD_KINDS = ['invoice', 'recurring', 'customer', 'payment', 'bill', 'vendor', 'expense', 'bank_account', 'journal', 'import'] as const;
export type RecordKind = (typeof RECORD_KINDS)[number];

export interface RecordSummary {
  readonly id: string;
  /** What a person calls it: the number, or the name. */
  readonly label: string;
  readonly status: string | null;
}

/** The SQL that finds one record of a kind by `ref` (id or number). Numbers are matched without case. */
function lookup(kind: RecordKind, orgId: string, ref: string): SQL {
  const byId = isUuid(ref);
  switch (kind) {
    case 'invoice':
      return sql`select id, coalesce(number, 'Draft') as label, status from ledger.invoices where org_id = ${orgId}::uuid and deleted_at is null and ${byId ? sql`id = ${ref}::uuid` : sql`lower(number) = lower(${ref})`} limit 1`;
    case 'bill':
      return sql`select id, coalesce(number, 'Draft') as label, status from ledger.bills where org_id = ${orgId}::uuid and deleted_at is null and ${byId ? sql`id = ${ref}::uuid` : sql`lower(number) = lower(${ref})`} limit 1`;
    case 'payment':
      return sql`select id, coalesce(number, 'Payment') as label, kind as status from ledger.payments where org_id = ${orgId}::uuid and ${byId ? sql`id = ${ref}::uuid` : sql`lower(number) = lower(${ref})`} limit 1`;
    case 'expense':
      return sql`select id, coalesce(number, 'Draft') as label, status from ledger.expenses where org_id = ${orgId}::uuid and deleted_at is null and ${byId ? sql`id = ${ref}::uuid` : sql`lower(number) = lower(${ref})`} limit 1`;
    case 'journal':
      return sql`select id, coalesce(number, 'Entry') as label, source_type as status from ledger.journal_entries where org_id = ${orgId}::uuid and ${byId ? sql`id = ${ref}::uuid` : sql`lower(number) = lower(${ref})`} limit 1`;
    case 'recurring':
      return byId ? sql`select id, name as label, case when active then 'active' else 'paused' end as status from ledger.recurring_invoices where org_id = ${orgId}::uuid and id = ${ref}::uuid` : sql`select null where false`;
    case 'bank_account':
      return byId ? sql`select id, name as label, kind as status from ledger.bank_accounts where org_id = ${orgId}::uuid and id = ${ref}::uuid and archived_at is null` : sql`select null where false`;
    case 'import':
      return byId ? sql`select id, coalesce(file_name, stream) as label, status from ledger.import_batches where org_id = ${orgId}::uuid and id = ${ref}::uuid` : sql`select null where false`;
    case 'customer':
      return byId ? sql`select id, name as label, status from core.customers where org_id = ${orgId}::uuid and id = ${ref}::uuid and deleted_at is null` : sql`select null where false`;
    case 'vendor':
      return byId ? sql`select id, name as label, null::text as status from core.vendors where org_id = ${orgId}::uuid and id = ${ref}::uuid and deleted_at is null` : sql`select null where false`;
  }
}

export const findRecord = scoped(async function findRecord(ctx: DomainContext, kind: RecordKind, ref: string): Promise<RecordSummary | null> {
  const trimmed = ref.trim();
  if (trimmed.length === 0 || trimmed.length > 80) return null;
  const result = await db.execute<{ id: string; label: string; status: string | null }>(lookup(kind, ctx.orgId, trimmed));
  const row = result.rows[0];
  return row?.id ? { id: row.id, label: row.label, status: row.status } : null;
});

/** `/customers/by-link?coreCustomerId=` or `?crmAccountItemId=`: the core customer id, or null. */
export const customerByLink = scoped(async function customerByLink(ctx: DomainContext, link: { readonly coreCustomerId?: string | null; readonly crmAccountItemId?: string | null }): Promise<string | null> {
  if (link.coreCustomerId && isUuid(link.coreCustomerId)) return (await findRecord(ctx, 'customer', link.coreCustomerId))?.id ?? null;
  if (link.crmAccountItemId && isUuid(link.crmAccountItemId)) {
    const result = await db.execute<{ id: string }>(
      sql`select customer_id as id from ledger.customer_profiles where org_id = ${ctx.orgId}::uuid and crm_account_item_id = ${link.crmAccountItemId}::uuid limit 1`,
    );
    return result.rows[0]?.id ?? null;
  }
  return null;
});
