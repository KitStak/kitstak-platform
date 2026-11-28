/**
 * People reads for sibling apps (docs/crew/SPEC.md 8.1). System reads: names, numbers and site
 * only, never pay, private details or attendance. Reads never throw and answer empty (or 0) when
 * Crew is not in this database.
 */
import { sql } from 'drizzle-orm';
import { crewAvailability, isUuid, query, queryOne, type BridgeExecutor } from './executor';
import type { CrewPersonRef } from './types';

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * People who count for the $4 price on `onDate` (SPEC 8.1 billing count): status active, not
 * removed, started on or before the date (or with no start date) and not ended before it. Temps count.
 */
export async function countBillablePeople(db: BridgeExecutor, input: { readonly orgId: string; readonly onDate: string }): Promise<number> {
  if (!isUuid(input.orgId) || !ISO_DATE.test(input.onDate)) return 0;
  try {
    if (!(await crewAvailability(db)).installed) return 0;
    const row = await queryOne<{ n: number | string }>(
      db,
      sql`select count(*)::int as n from crew.people
           where org_id = ${input.orgId} and deleted_at is null and is_sample = false and status = 'active'
             and (start_date is null or start_date <= ${input.onDate}::date)
             and (end_date is null or end_date >= ${input.onDate}::date)`,
    );
    return Number(row?.n ?? 0);
  } catch {
    return 0;
  }
}

interface PersonRow {
  readonly person_id: string;
  readonly number: string;
  readonly first_name: string;
  readonly last_name: string;
  readonly preferred_name: string | null;
  readonly kind: CrewPersonRef['kind'];
  readonly status: CrewPersonRef['status'];
  readonly site_id: string;
  readonly site_name: string;
  readonly wms_user_id: string | null;
}

/** Crew names and sites for WMS users (Labor Analytics, SPEC 8.4). Up to 500 ids. */
export async function getPeopleForWmsUsers(db: BridgeExecutor, input: { readonly orgId: string; readonly wmsUserIds: readonly string[] }): Promise<CrewPersonRef[]> {
  const ids = [...new Set(input.wmsUserIds.filter((value) => typeof value === 'string' && value.length > 0 && value.length <= 120))].slice(0, 500);
  if (!isUuid(input.orgId) || ids.length === 0) return [];
  try {
    if (!(await crewAvailability(db)).installed) return [];
    const rows = await query<PersonRow>(
      db,
      sql`select p.id as person_id, p.number, p.first_name, p.last_name, p.preferred_name, p.kind, p.status, p.home_site_id as site_id, s.name as site_name, p.wms_user_id
            from crew.people p
            join crew.sites s on s.org_id = p.org_id and s.id = p.home_site_id
           where p.org_id = ${input.orgId} and p.deleted_at is null
             and p.wms_user_id in (${sql.join(
               ids.map((value) => sql`${value}`),
               sql`, `,
             )})
           order by p.last_name, p.first_name`,
    );
    return rows.map((row) => ({
      personId: row.person_id,
      number: row.number,
      name: `${row.preferred_name?.trim() || row.first_name} ${row.last_name}`.trim(),
      kind: row.kind,
      status: row.status,
      siteId: row.site_id,
      siteName: row.site_name,
      wmsUserId: row.wms_user_id,
    }));
  } catch {
    return [];
  }
}
