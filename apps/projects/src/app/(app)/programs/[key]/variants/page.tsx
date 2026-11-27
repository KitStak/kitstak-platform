import type { Metadata } from 'next';
import { sql } from 'drizzle-orm';
import { VariantsTab } from '@/features/programs/variants/variants-tab';
import { db } from '@/server/db';
import { registryOrgIds } from '@/server/integrations/customers';
import { pageContext } from '@/server/page';

type Params = Promise<{ key: string }>;

export const metadata: Metadata = { title: 'Variants' };

/** Kit items (core items marked as kits) for the Link kit picker. Never throws: no kits means an empty list. */
async function kitItems(ctx: Awaited<ReturnType<typeof pageContext>>['ctx']) {
  try {
    const orgIds = await registryOrgIds(ctx).catch(() => [ctx.orgId]);
    const result = await db.execute<{ id: string; customer_id: string | null; sku: string; name: string }>(sql`
      select id::text, customer_id::text, sku, name from core.items
       where org_id = any(${sql.param(orgIds)}::uuid[]) and is_kit = true and deleted_at is null
       order by sku limit 1000`);
    return result.rows.map((row) => ({ id: row.id, customerId: row.customer_id, sku: row.sku, name: row.name }));
  } catch {
    return [];
  }
}

/** Variants tab (docs/programs/SPEC.md 5.11). Variants come from the program layout's provider. */
export default async function Page({ params }: { readonly params: Params }) {
  const { key } = await params;
  const { ctx } = await pageContext(`/programs/${decodeURIComponent(key).toUpperCase()}/variants`);
  return <VariantsTab kitItems={await kitItems(ctx)} />;
}
