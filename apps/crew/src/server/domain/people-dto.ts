/**
 * People DTOs and the sight rule on the server (docs/crew/SPEC.md 3.3): every builder takes
 * `canSeePay` and `canSeePrivate`. Hidden fields are `null` and the DTO says `payHidden` or
 * `privateHidden`. Activity rows and import rows are redacted the same way. Pure module (no
 * database), so `people-dto.test.ts` walks every DTO as every role.
 */
import { PEOPLE_COLUMN_BY_KEY, type PeopleColumnKey } from '@/lib/csv/people';

export interface Sight {
  readonly canSeePay: boolean;
  readonly canSeePrivate: boolean;
}

/** A person row as read from `crew.people` with its joins (domain/people.ts builds it). */
export interface PersonRecord {
  readonly id: string;
  readonly number: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName: string | null;
  readonly kind: string;
  readonly status: string;
  readonly homeSiteId: string;
  readonly homeSiteName: string | null;
  readonly usualAreaId: string | null;
  readonly usualAreaName: string | null;
  readonly laborClassId: string | null;
  readonly laborClassName: string | null;
  readonly leadPersonId: string | null;
  readonly leadName: string | null;
  readonly agencyVendorId: string | null;
  readonly agencyName: string | null;
  readonly agencyRef: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly userId: string | null;
  readonly userName: string | null;
  readonly wmsUserId: string | null;
  readonly email: string | null;
  readonly phone: string | null;
  readonly language: string;
  readonly badgeHash: string | null;
  readonly pinHash: string | null;
  readonly pinSetAt: Date | null;
  readonly pinLockedUntil: Date | null;
  readonly notifyEmail: boolean;
  readonly notes: string | null;
  readonly source: string;
  readonly version: number;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

export interface PrivateRecord {
  readonly emergencyName: string | null;
  readonly emergencyPhone: string | null;
  readonly emergencyRelation: string | null;
  readonly homeAddress: Readonly<Record<string, string>> | null;
  readonly privateNotes: string | null;
}

export interface WageRecord {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly wageCents: number;
  readonly note: string | null;
  readonly sentToPulseAt: Date | null;
}

export interface PayRecord {
  readonly payType: string;
  readonly overtimeExempt: boolean;
  readonly wages: readonly WageRecord[];
}

export interface WageDto {
  readonly id: string;
  readonly effectiveFrom: string;
  readonly wageCents: number;
  readonly note: string | null;
  readonly sentToPulseAt: string | null;
}

/** The fields every reader of a person may see. */
interface PersonPublic {
  readonly id: string;
  readonly number: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName: string | null;
  readonly displayName: string;
  readonly kind: string;
  readonly status: string;
  readonly homeSiteId: string;
  readonly homeSiteName: string | null;
  readonly usualAreaId: string | null;
  readonly usualAreaName: string | null;
  readonly laborClassId: string | null;
  readonly laborClassName: string | null;
  readonly leadPersonId: string | null;
  readonly leadName: string | null;
  readonly agencyVendorId: string | null;
  readonly agencyName: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly hasLogin: boolean;
}

export interface PersonListItemDto extends PersonPublic {
  readonly phone: string | null;
  readonly email: string | null;
  readonly hasPin: boolean;
  readonly hasBadge: boolean;
  readonly privateHidden: boolean;
}

export interface PersonDto extends PersonPublic {
  readonly agencyRef: string | null;
  readonly userId: string | null;
  readonly userName: string | null;
  readonly wmsUserId: string | null;
  readonly language: string;
  readonly hasBadge: boolean;
  readonly hasPin: boolean;
  readonly pinSetAt: string | null;
  readonly pinLocked: boolean;
  readonly notifyEmail: boolean;
  readonly source: string;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  /** Private details (SPEC 3.2): null unless the reader may see them. */
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly emergencyName: string | null;
  readonly emergencyPhone: string | null;
  readonly emergencyRelation: string | null;
  readonly homeAddress: Readonly<Record<string, string>> | null;
  readonly privateNotes: string | null;
  readonly privateHidden: boolean;
  /** Pay (SPEC 3.2): null unless the reader has pay rights. */
  readonly payType: string | null;
  readonly overtimeExempt: boolean | null;
  readonly wageCents: number | null;
  readonly wages: readonly WageDto[] | null;
  readonly payHidden: boolean;
}

export function displayName(person: Pick<PersonRecord, 'firstName' | 'lastName' | 'preferredName'>): string {
  return `${person.preferredName?.trim() || person.firstName} ${person.lastName}`.trim();
}

function publicPart(row: PersonRecord): PersonPublic {
  return {
    id: row.id,
    number: row.number,
    firstName: row.firstName,
    lastName: row.lastName,
    preferredName: row.preferredName,
    displayName: displayName(row),
    kind: row.kind,
    status: row.status,
    homeSiteId: row.homeSiteId,
    homeSiteName: row.homeSiteName,
    usualAreaId: row.usualAreaId,
    usualAreaName: row.usualAreaName,
    laborClassId: row.laborClassId,
    laborClassName: row.laborClassName,
    leadPersonId: row.leadPersonId,
    leadName: row.leadName,
    agencyVendorId: row.agencyVendorId,
    agencyName: row.agencyName,
    startDate: row.startDate,
    endDate: row.endDate,
    hasLogin: row.userId !== null,
  };
}

export function toPersonListItem(row: PersonRecord, sight: Sight): PersonListItemDto {
  return {
    ...publicPart(row),
    phone: sight.canSeePrivate ? row.phone : null,
    email: sight.canSeePrivate ? row.email : null,
    hasPin: row.pinHash !== null,
    hasBadge: row.badgeHash !== null,
    privateHidden: !sight.canSeePrivate,
  };
}

/** The wage in force on `onDate` (the latest dated on or before it), or null. */
export function wageOn(wages: readonly Pick<WageRecord, 'effectiveFrom' | 'wageCents'>[], onDate: string): number | null {
  let best: Pick<WageRecord, 'effectiveFrom' | 'wageCents'> | null = null;
  for (const wage of wages) if (wage.effectiveFrom <= onDate && (!best || wage.effectiveFrom > best.effectiveFrom)) best = wage;
  return best?.wageCents ?? null;
}

export function toPersonDto(row: PersonRecord, extra: { readonly private: PrivateRecord | null; readonly pay: PayRecord | null; readonly today: string; readonly now?: Date }, sight: Sight): PersonDto {
  const now = extra.now ?? new Date();
  const priv = sight.canSeePrivate ? extra.private : null;
  const pay = sight.canSeePay ? extra.pay : null;
  return {
    ...publicPart(row),
    agencyRef: row.agencyRef,
    userId: row.userId,
    userName: row.userName,
    wmsUserId: row.wmsUserId,
    language: row.language,
    hasBadge: row.badgeHash !== null,
    hasPin: row.pinHash !== null,
    pinSetAt: row.pinSetAt?.toISOString() ?? null,
    pinLocked: row.pinLockedUntil !== null && row.pinLockedUntil > now,
    notifyEmail: row.notifyEmail,
    source: row.source,
    version: row.version,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    email: sight.canSeePrivate ? row.email : null,
    phone: sight.canSeePrivate ? row.phone : null,
    notes: sight.canSeePrivate ? row.notes : null,
    emergencyName: priv?.emergencyName ?? null,
    emergencyPhone: priv?.emergencyPhone ?? null,
    emergencyRelation: priv?.emergencyRelation ?? null,
    homeAddress: priv?.homeAddress ?? null,
    privateNotes: priv?.privateNotes ?? null,
    privateHidden: !sight.canSeePrivate,
    payType: sight.canSeePay ? (pay?.payType ?? 'hourly') : null,
    overtimeExempt: sight.canSeePay ? (pay?.overtimeExempt ?? false) : null,
    wageCents: sight.canSeePay ? wageOn(pay?.wages ?? [], extra.today) : null,
    wages: sight.canSeePay ? (pay?.wages ?? []).map((wage) => ({ id: wage.id, effectiveFrom: wage.effectiveFrom, wageCents: wage.wageCents, note: wage.note, sentToPulseAt: wage.sentToPulseAt?.toISOString() ?? null })) : null,
    payHidden: !sight.canSeePay,
  };
}

/* Activity -------------------------------------------------------------------------------------- */

/** Keys that hold private details anywhere in an activity row (camel and snake case). */
export const PRIVATE_KEYS: ReadonlySet<string> = new Set([
  'email', 'phone', 'notes', 'emergencyName', 'emergencyPhone', 'emergencyRelation', 'homeAddress', 'privateNotes',
  'emergency_name', 'emergency_phone', 'emergency_relation', 'home_address', 'private_notes',
]);
/** Keys that hold pay anywhere in an activity row. */
export const PAY_KEYS: ReadonlySet<string> = new Set(['payType', 'overtimeExempt', 'wageCents', 'wages', 'wage', 'pay_type', 'overtime_exempt', 'wage_per_hour', 'wage_cents']);
/** Entity types that are pay or private as a whole. */
const PAY_ENTITIES: ReadonlySet<string> = new Set(['person_pay', 'person_wage']);
const PRIVATE_ENTITIES: ReadonlySet<string> = new Set(['person_private']);

export interface ActivityRecord {
  readonly id: string;
  readonly verb: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorName: string | null;
  readonly actorKind: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly createdAt: Date;
}

export interface ActivityDto {
  readonly id: string;
  readonly verb: string;
  readonly entityType: string;
  readonly entityId: string | null;
  readonly actorName: string | null;
  readonly actorKind: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
  readonly createdAt: string;
  /** Some fields were left out because the reader may not see them. */
  readonly redacted: boolean;
}

function redactObject(value: Record<string, unknown> | null, sight: Sight): { value: Record<string, unknown> | null; redacted: boolean } {
  if (!value) return { value: null, redacted: false };
  let redacted = false;
  const out: Record<string, unknown> = {};
  for (const [key, inner] of Object.entries(value)) {
    if ((!sight.canSeePay && PAY_KEYS.has(key)) || (!sight.canSeePrivate && PRIVATE_KEYS.has(key))) {
      redacted = true;
      continue;
    }
    out[key] = inner;
  }
  return { value: out, redacted };
}

/** Null when the whole row is hidden from this reader. */
export function toActivityDto(row: ActivityRecord, sight: Sight): ActivityDto | null {
  if (!sight.canSeePay && PAY_ENTITIES.has(row.entityType)) return null;
  if (!sight.canSeePrivate && PRIVATE_ENTITIES.has(row.entityType)) return null;
  const before = redactObject(row.before, sight);
  const after = redactObject(row.after, sight);
  return {
    id: row.id,
    verb: row.verb,
    entityType: row.entityType,
    entityId: row.entityId,
    actorName: row.actorName,
    actorKind: row.actorKind,
    before: before.value,
    after: after.value,
    createdAt: row.createdAt.toISOString(),
    redacted: before.redacted || after.redacted,
  };
}

/* Import rows ----------------------------------------------------------------------------------- */

/** Cells of an import row with the pay and private columns blanked for a reader without the right. */
export function redactCells(cells: Readonly<Record<string, string>>, sight: Sight): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [key, value] of Object.entries(cells)) {
    const column = PEOPLE_COLUMN_BY_KEY[key as PeopleColumnKey];
    if (column?.right === 'pay' && !sight.canSeePay) continue;
    if (column?.right === 'private' && !sight.canSeePrivate) continue;
    out[key] = value;
  }
  return out;
}
