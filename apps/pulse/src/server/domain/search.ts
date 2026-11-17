/** Search for the command palette and `/search`: jobs, clients and extra services. No extension needed (SPEC 5.2). */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import type { SearchHitDTO } from '@/lib/types';
import { cleanText, rows, type DomainContext } from './_shared';
import { requirePulse } from './access';

/** Job number prefix first, then a contains match on names, without case. Up to `limit` hits a kind. */
export async function searchAll(ctx: DomainContext, query: string, limit = 8): Promise<SearchHitDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  const q = cleanText(query)?.toLowerCase().replace(/[%_\\]/g, '');
  if (!q) return [];
  const cap = Math.min(Math.max(limit, 1), 25);
  const [jobs, clients, services] = await Promise.all([
    rows<{ id: string; number: string; name: string; client: string; status: string }>(
      db,
      sql`SELECT j.id, j.number, j.name, c.name AS client, j.status FROM pulse.jobs j JOIN pulse.clients c ON c.id = j.client_id
           WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND (lower(j.number) LIKE ${`${q}%`} OR lower(j.name) LIKE ${`%${q}%`} OR lower(coalesce(j.po_number, '')) LIKE ${`${q}%`} OR lower(coalesce(j.kit_sku, '')) LIKE ${`${q}%`})
           ORDER BY (lower(j.number) LIKE ${`${q}%`}) DESC, (j.status = 'active') DESC, j.created_at DESC LIMIT ${cap}`,
    ),
    rows<{ id: string; name: string; code: string }>(db, sql`SELECT id, name, code FROM pulse.clients WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND (lower(name) LIKE ${`%${q}%`} OR lower(code) LIKE ${`${q}%`}) ORDER BY lower(name) LIMIT ${cap}`),
    rows<{ id: string; name: string; code: string }>(db, sql`SELECT id, name, code FROM pulse.vas_services WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND (lower(name) LIKE ${`%${q}%`} OR lower(code) LIKE ${`${q}%`}) ORDER BY lower(name) LIMIT ${cap}`),
  ]);
  return [
    ...jobs.map((job): SearchHitDTO => ({ type: 'job', id: job.id, title: `${job.number} ${job.name}`, subtitle: job.client, href: `/jobs/${encodeURIComponent(job.number)}` })),
    ...clients.map((client): SearchHitDTO => ({ type: 'client', id: client.id, title: client.name, subtitle: client.code, href: `/clients/${client.id}` })),
    ...services.map((service): SearchHitDTO => ({ type: 'service', id: service.id, title: service.name, subtitle: service.code, href: `/services/${service.id}` })),
  ];
}
