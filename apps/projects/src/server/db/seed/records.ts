/**
 * Finds the real CRM / WMS / customer records a seed links to. Records are picked by a stable
 * name or code, with a sensible fallback (another deal at the same stage, the client's newest
 * order…) so the seed keeps working when a sibling app re-seeds with different ids. Returns null
 * when nothing fits (e.g. WMS tables absent); the builder then skips that link.
 */
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import type { IntegrationTargetType } from '@/lib/constants';
import type { LinkPick } from './types';

export interface PickedRecord {
  readonly type: IntegrationTargetType;
  readonly id: string;
  readonly label: string;
}

async function exists(table: string): Promise<boolean> {
  const result = await db.execute<{ ok: boolean }>(sql`select to_regclass(${table}) is not null as ok`);
  return Boolean(result.rows[0]?.ok);
}

const WMS_TABLES = {
  wms_order: 'wms.shipment_orders',
  wms_work_order: 'wms.work_orders',
  wms_receipt: 'wms.purchase_orders',
  wms_count: 'wms.count_plans',
} as const;

export class RecordPicker {
  private readonly cache = new Map<string, PickedRecord | null>();
  private readonly used = new Map<string, Set<string>>();

  constructor(private readonly orgId: string) {}

  async customerId(code: string): Promise<string | null> {
    const found = await this.pick({ type: 'core_customer', code });
    return found?.id ?? null;
  }

  async pick(choice: LinkPick): Promise<PickedRecord | null> {
    const key = JSON.stringify(choice);
    if (this.cache.has(key)) return this.cache.get(key) ?? null;
    const found = await this.lookup(choice).catch((error: unknown) => {
      process.stderr.write(`  ! could not look up ${key}: ${error instanceof Error ? error.message : String(error)}\n`);
      return null;
    });
    this.cache.set(key, found);
    return found;
  }

  /** Remembers ids already used for "nth" picks so different tasks get different records. */
  private markUsed(type: string, id: string): void {
    const set = this.used.get(type) ?? new Set<string>();
    set.add(id);
    this.used.set(type, set);
  }

  private async lookup(choice: LinkPick): Promise<PickedRecord | null> {
    switch (choice.type) {
      case 'core_customer': {
        const result = await db.execute<{ id: string; name: string }>(
          sql`select id::text, name from core.customers where org_id = ${this.orgId} and code = ${choice.code} limit 1`,
        );
        const row = result.rows[0];
        return row ? { type: 'core_customer', id: row.id, label: row.name } : null;
      }
      case 'crm_item':
      case 'crm_account': {
        if (!(await exists('crm.items'))) return null;
        const kind = choice.type === 'crm_item' ? 'deals' : 'accounts';
        const name = choice.type === 'crm_item' ? choice.deal : choice.account;
        const exact = await db.execute<{ id: string; name: string }>(sql`
          select i.id::text, i.name from crm.items i join crm.boards b on b.id = i.board_id
          where i.org_id = ${this.orgId} and b.kind = ${kind} and i.deleted_at is null and i.parent_item_id is null and replace(i.name, ' ' || chr(8212) || ' ', ' · ') = replace(${name}, ' ' || chr(8212) || ' ', ' · ')
          order by i.created_at limit 1`);
        let row = exact.rows[0];
        if (!row && choice.type === 'crm_item' && choice.fallbackStage) {
          const used = [...(this.used.get('crm_item') ?? [])];
          const fallback = await db.execute<{ id: string; name: string }>(sql`
            select i.id::text, i.name from crm.items i join crm.boards b on b.id = i.board_id
            where i.org_id = ${this.orgId} and b.kind = 'deals' and i.deleted_at is null and i.archived_at is null
              and i.parent_item_id is null and i.values #>> '{stage,labelId}' = ${choice.fallbackStage}
              and not (i.id::text = any(string_to_array(${used.join(',')}, ',')))
            order by i.name limit 1`);
          row = fallback.rows[0];
        }
        if (!row) return null;
        this.markUsed(choice.type, row.id);
        return { type: choice.type, id: row.id, label: row.name };
      }
      case 'wms_order':
      case 'wms_work_order':
      case 'wms_receipt':
      case 'wms_count': {
        const table = WMS_TABLES[choice.type];
        if (!(await exists(table))) return null;
        if (choice.code) {
          const result = await db.execute<{ id: string; code: string }>(sql`select id, code from ${sql.raw(table)} where code = ${choice.code} limit 1`);
          const row = result.rows[0];
          if (row) {
            this.markUsed(choice.type, row.id);
            return { type: choice.type, id: row.id, label: row.code };
          }
        }
        const client = 'client' in choice ? choice.client : undefined;
        const status = choice.type === 'wms_order' ? choice.status : undefined;
        const clientId = client ? await this.customerId(client) : null;
        if (client && !clientId) return null;
        const used = [...(this.used.get(choice.type) ?? [])];
        const nth = choice.nth ?? 0;
        const filters = [
          clientId && choice.type !== 'wms_count' ? sql`client_id = ${clientId}` : sql`true`,
          status ? sql`status = ${status}` : sql`true`,
          sql`not (id = any(string_to_array(${used.join(',')}, ',')))`,
        ];
        const result = await db.execute<{ id: string; code: string }>(
          sql`select id, code from ${sql.raw(table)} where ${sql.join(filters, sql` and `)} order by code desc offset ${nth} limit 1`,
        );
        const row = result.rows[0];
        if (!row) return null;
        this.markUsed(choice.type, row.id);
        return { type: choice.type, id: row.id, label: row.code };
      }
    }
  }
}
