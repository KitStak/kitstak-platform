/**
 * The people of a workspace as the People file sees them (docs/crew/SPEC.md section 7): one row of
 * template values per person, with codes and names instead of ids. The export writes these rows;
 * the import compares a file row with them, so an export imported back is all "unchanged".
 */
import 'server-only';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { vendors } from '@kitstak/db/schema';
import type { Executor } from '@/server/db';
import { areas, laborClasses, people, personPay, personPrivate, personWages, sites } from '@/server/db/schema';
import { centsToDecimal } from '@/lib/money';
import type { PeopleColumnKey } from '@/lib/csv/people';
import { todayInZone } from './_shared';
import { wageOn } from './people-dto';

export interface PersonFileRow {
  readonly id: string;
  readonly version: number;
  readonly homeSiteId: string;
  readonly agencyVendorId: string | null;
  readonly badgeHash: string | null;
  readonly usualAreaId: string | null;
  readonly laborClassId: string | null;
  /** Template values, keyed by column. Empty string for nothing. */
  readonly cells: Readonly<Record<PeopleColumnKey, string>>;
  readonly wageCents: number | null;
}

const leadPerson = alias(people, 'lead_person');

/** Every live person with their file values (pay and private filled in; callers drop what a reader may not see). */
export async function loadPeopleFile(executor: Executor, orgId: string): Promise<PersonFileRow[]> {
  const rows = await executor
    .select({
      p: people,
      siteCode: sites.code,
      timezone: sites.timezone,
      areaCode: areas.code,
      classCode: laborClasses.code,
      agencyName: vendors.name,
      leadNumber: leadPerson.number,
      emergencyName: personPrivate.emergencyName,
      emergencyPhone: personPrivate.emergencyPhone,
      payType: personPay.payType,
      overtimeExempt: personPay.overtimeExempt,
    })
    .from(people)
    .leftJoin(sites, and(eq(sites.orgId, people.orgId), eq(sites.id, people.homeSiteId)))
    .leftJoin(areas, and(eq(areas.orgId, people.orgId), eq(areas.id, people.usualAreaId)))
    .leftJoin(laborClasses, and(eq(laborClasses.orgId, people.orgId), eq(laborClasses.id, people.laborClassId)))
    .leftJoin(vendors, and(eq(vendors.orgId, people.orgId), eq(vendors.id, people.agencyVendorId)))
    .leftJoin(leadPerson, and(eq(leadPerson.orgId, people.orgId), eq(leadPerson.id, people.leadPersonId)))
    .leftJoin(personPrivate, and(eq(personPrivate.orgId, people.orgId), eq(personPrivate.personId, people.id)))
    .leftJoin(personPay, and(eq(personPay.orgId, people.orgId), eq(personPay.personId, people.id)))
    .where(and(eq(people.orgId, orgId), isNull(people.deletedAt)))
    .orderBy(asc(people.lastName), asc(people.firstName), asc(people.number));
  const wages = await executor.select({ personId: personWages.personId, effectiveFrom: personWages.effectiveFrom, wageCents: personWages.wageCents }).from(personWages).where(eq(personWages.orgId, orgId));
  const wagesBy = new Map<string, { effectiveFrom: string; wageCents: number }[]>();
  for (const wage of wages) wagesBy.set(wage.personId, [...(wagesBy.get(wage.personId) ?? []), wage]);
  return rows.map((row) => {
    const p = row.p;
    const wageCents = wageOn(wagesBy.get(p.id) ?? [], todayInZone(row.timezone ?? 'UTC'));
    return {
      id: p.id,
      version: p.version,
      homeSiteId: p.homeSiteId,
      agencyVendorId: p.agencyVendorId,
      badgeHash: p.badgeHash,
      usualAreaId: p.usualAreaId,
      laborClassId: p.laborClassId,
      wageCents,
      cells: {
        employee_number: p.number,
        first_name: p.firstName,
        last_name: p.lastName,
        preferred_name: p.preferredName ?? '',
        kind: p.kind,
        status: p.status,
        site_code: row.siteCode ?? '',
        area_code: row.areaCode ?? '',
        labor_class: row.classCode ?? '',
        agency: row.agencyName ?? '',
        agency_person_id: p.agencyRef ?? '',
        start_date: p.startDate ?? '',
        end_date: p.endDate ?? '',
        email: p.email ?? '',
        phone: p.phone ?? '',
        language: p.language,
        lead_employee_number: row.leadNumber ?? '',
        badge: '',
        emergency_name: row.emergencyName ?? '',
        emergency_phone: row.emergencyPhone ?? '',
        pay_type: row.payType ?? 'hourly',
        overtime_exempt: row.overtimeExempt ? 'yes' : 'no',
        wage_per_hour: wageCents === null ? '' : centsToDecimal(wageCents),
      },
    };
  });
}
