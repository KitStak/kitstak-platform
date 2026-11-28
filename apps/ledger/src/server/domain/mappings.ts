/**
 * Source mappings (docs/ledger/SPEC.md 5.2): which item a sibling row becomes on an invoice. The
 * six WMS operation types and the Programs fee kinds are always listed; Pulse services and job
 * types show once they have a row. Reading needs `money:read`; changes need `settings:manage`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError } from '@/server/errors';
import { requireRight } from './access';
import { logActivity } from './activity';
import { isUuid, type DomainContext } from './_shared';

export const MAPPING_SOURCES = ['wms_operation', 'program_fee_kind', 'pulse_service', 'pulse_job_type'] as const;
export type MappingSource = (typeof MAPPING_SOURCES)[number];

/** The keys every workspace sees, in this order (WMS operation types, then Programs fee kinds). */
export const KNOWN_MAPPING_KEYS: Readonly<Record<MappingSource, readonly string[]>> = {
  wms_operation: ['Receiving', 'Storage', 'Pick and Pack', 'Shipment', 'Work Order', 'VAS'],
  program_fee_kind: ['per_unit', 'batch', 'hourly', 'monthly', 'minimum'],
  pulse_service: [],
  pulse_job_type: [],
};

export interface MappingRow {
  readonly source: MappingSource;
  readonly key: string;
  readonly itemId: string | null;
  readonly itemLabel: string | null;
}

export const listMappings = scoped(async function listMappings(ctx: DomainContext): Promise<readonly MappingRow[]> {
  await requireRight(ctx, 'money:read');
  const result = await db.execute<{ source: MappingSource; key: string; item_id: string; item_label: string }>(
    sql`select m.source, m.key, m.item_id, i.code || ' ' || i.name as item_label
          from ledger.source_mappings m join ledger.items i on i.org_id = m.org_id and i.id = m.item_id
         where m.org_id = ${ctx.orgId}::uuid`,
  );
  const found = new Map(result.rows.map((row) => [`${row.source}:${row.key}`, row]));
  const rows: MappingRow[] = [];
  for (const source of MAPPING_SOURCES) {
    const keys = [...KNOWN_MAPPING_KEYS[source], ...result.rows.filter((row) => row.source === source && !KNOWN_MAPPING_KEYS[source].includes(row.key)).map((row) => row.key).sort()];
    for (const key of keys) {
      const row = found.get(`${source}:${key}`);
      rows.push({ source, key, itemId: row?.item_id ?? null, itemLabel: row?.item_label ?? null });
    }
  }
  return rows;
});

/** Points one source key at an item, or clears it (`itemId` null). */
export const setMapping = scoped(async function setMapping(ctx: DomainContext, source: MappingSource, key: string, itemId: string | null): Promise<void> {
  await requireRight(ctx, 'settings:manage');
  const cleanKey = key.trim();
  if (!(MAPPING_SOURCES as readonly string[]).includes(source) || cleanKey === '' || cleanKey.length > 80) throw new DomainError('VALIDATION', 'That mapping is not one Ledger knows.');
  await db.transaction(async (tx) => {
    if (itemId === null) {
      await tx.execute(sql`delete from ledger.source_mappings where org_id = ${ctx.orgId}::uuid and source = ${source} and key = ${cleanKey}`);
    } else {
      if (!isUuid(itemId)) throw new DomainError('VALIDATION', 'Pick an item from your list.', { itemId: 'Not found.' });
      const item = await tx.execute(sql`select 1 from ledger.items where org_id = ${ctx.orgId}::uuid and id = ${itemId}::uuid and archived_at is null`);
      if (!item.rows[0]) throw new DomainError('VALIDATION', 'Pick an item that is not archived.', { itemId: 'Not found.' });
      await tx.execute(sql`insert into ledger.source_mappings (org_id, source, key, item_id) values (${ctx.orgId}::uuid, ${source}, ${cleanKey}, ${itemId}::uuid)
                           on conflict (org_id, source, key) do update set item_id = excluded.item_id, updated_at = now()`);
    }
    await logActivity(tx, ctx, { verb: 'mapping.changed', entityType: 'source_mapping', after: { source, key: cleanKey, itemId } });
  });
});
