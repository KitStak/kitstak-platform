/** Small shared helpers for soft deleted, org scoped rows. Table names come from a fixed list, never from input. */
import 'server-only';
import { sql } from 'drizzle-orm';
import type { Executor } from '@/server/db';
import { notFound } from '@/server/errors';
import { rows } from './_shared';
import { scoped } from '@/server/db/scope';

export type SoftTable =
  | 'sites'
  | 'clients'
  | 'job_types'
  | 'labor_classes'
  | 'labor_rates'
  | 'items'
  | 'vas_services'
  | 'standards'
  | 'targets'
  | 'jobs'
  | 'production_entries'
  | 'indirect_entries'
  | 'paid_hours'
  | 'material_usage'
  | 'cost_entries'
  | 'revenue_entries'
  | 'vas_entries'
  | 'alert_rules'
  | 'saved_views';

/** Marks a live row deleted. Throws NOT_FOUND when there is no live row. */
export const softDeleteRow = scoped(async function softDeleteRow(executor: Executor, orgId: string, table: SoftTable, id: string, what: string): Promise<void> {
  const found = await rows(executor, sql`UPDATE pulse.${sql.raw(table)} SET deleted_at = now(), updated_at = now() WHERE org_id = ${orgId} AND id = ${id} AND deleted_at IS NULL RETURNING id`);
  if (found.length === 0) throw notFound(what);
}, 1);

/** Brings a deleted row back. Throws NOT_FOUND when there is no deleted row. */
export const restoreRow = scoped(async function restoreRow(executor: Executor, orgId: string, table: SoftTable, id: string, what: string): Promise<void> {
  const found = await rows(executor, sql`UPDATE pulse.${sql.raw(table)} SET deleted_at = NULL, updated_at = now() WHERE org_id = ${orgId} AND id = ${id} AND deleted_at IS NOT NULL RETURNING id`);
  if (found.length === 0) throw notFound(what);
}, 1);

/** A short code from a name: "Acme Foods, Inc." gives "ACME-FOODS-INC". */
export function codeFromName(name: string, max = 16): string {
  const code = name
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, max)
    .replace(/-+$/g, '');
  return code.length > 0 ? code : 'ITEM';
}

/** First free code for a table with a live unique `lower(code)` key: CODE, CODE-2, CODE-3. */
export const freeCode = scoped(async function freeCode(executor: Executor, orgId: string, table: 'clients' | 'job_types' | 'labor_classes' | 'vas_services' | 'sites', wanted: string): Promise<string> {
  const taken = new Set(
    (await rows<{ code: string }>(executor, sql`SELECT lower(code) AS code FROM pulse.${sql.raw(table)} WHERE org_id = ${orgId} AND deleted_at IS NULL AND lower(code) LIKE ${`${wanted.toLowerCase()}%`}`)).map((row) => row.code),
  );
  if (!taken.has(wanted.toLowerCase())) return wanted;
  for (let n = 2; n < 10_000; n += 1) {
    const candidate = `${wanted}-${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
  return `${wanted}-${Date.now()}`;
}, 1);
