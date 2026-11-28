/**
 * People (docs/crew/SPEC.md 4 and 5.2): the list, one person, the form, and every write on a
 * person. Reads need `crew:read` and are narrowed to the reader's scope (3.2): a supervisor with
 * sites sees people whose home site is one of them, a lead sees their crew (people whose lead is
 * the lead's own linked person). Writes need `person:manage` inside that scope; pay needs
 * `pay:manage`. Pay and private details leave the server only through `people-dto.ts`.
 */
import 'server-only';
import { and, asc, desc, eq, ilike, inArray, isNull, ne, or, sql, type SQL } from 'drizzle-orm';
import { alias } from 'drizzle-orm/pg-core';
import { member, user, vendors } from '@kitstak/db/schema';
import { db, type Executor, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { activity, areas, laborClasses, people, personPay, personPrivate, personWages, settings, sites } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { canCrew, type CrewAction } from '@/lib/permissions';
import { isRealDate } from '@/lib/dates';
import { LANGUAGES, PAY_TYPES, PERSON_KINDS, PERSON_STATUSES, type Language, type PayType, type PersonKind, type PersonStatus } from '@/lib/csv/people';
import { accessDenied, crewAccessFor, type CrewAccess } from './access';
import { assertVersion, cleanText, inTx, isUuid, todayInZone, type DomainContext } from './_shared';
import { logActivity } from './activity';
import { generatePin, hashBadge, hashPin, type PinLength } from './pins';
import {
  toActivityDto,
  toPersonDto,
  toPersonListItem,
  type ActivityDto,
  type PayRecord,
  type PersonDto,
  type PersonListItemDto,
  type PersonRecord,
  type PrivateRecord,
  type Sight,
} from './people-dto';

/* Scope ----------------------------------------------------------------------------------------- */

export const sightOf = (access: CrewAccess): Sight => ({ canSeePay: access.canSeePay, canSeePrivate: access.canSeePrivate });

/** Which people a reader may see, as a WHERE part (SPEC 3.2). */
export function peopleScope(access: CrewAccess): SQL | undefined {
  if (access.role === 'lead') return access.linkedPersonId ? eq(people.leadPersonId, access.linkedPersonId) : sql`false`;
  if (access.role === 'supervisor' && access.siteIds) return access.siteIds.length > 0 ? inArray(people.homeSiteId, [...access.siteIds]) : sql`false`;
  return undefined;
}

/** May this reader act on a person at `siteId`? Supervisors only inside their sites. */
export function siteInScope(access: CrewAccess, siteId: string): boolean {
  if (access.role === 'supervisor' && access.siteIds) return access.siteIds.includes(siteId);
  return true;
}

async function requireAction(ctx: DomainContext, action: CrewAction): Promise<CrewAccess> {
  const access = await crewAccessFor(ctx);
  if (!canCrew(access.role, action)) throw accessDenied(access.role);
  return access;
}

function requireSite(access: CrewAccess, siteId: string): void {
  if (!siteInScope(access, siteId)) throw accessDenied(access.role);
}

/* Reading --------------------------------------------------------------------------------------- */

const lead = alias(people, 'lead');

function recordQuery(executor: Executor) {
  return executor
    .select({
      person: people,
      homeSiteName: sites.name,
      usualAreaName: areas.name,
      laborClassName: laborClasses.name,
      leadFirst: lead.firstName,
      leadLast: lead.lastName,
      leadPreferred: lead.preferredName,
      agencyName: vendors.name,
      userName: user.name,
    })
    .from(people)
    .leftJoin(sites, and(eq(sites.orgId, people.orgId), eq(sites.id, people.homeSiteId)))
    .leftJoin(areas, and(eq(areas.orgId, people.orgId), eq(areas.id, people.usualAreaId)))
    .leftJoin(laborClasses, and(eq(laborClasses.orgId, people.orgId), eq(laborClasses.id, people.laborClassId)))
    .leftJoin(lead, and(eq(lead.orgId, people.orgId), eq(lead.id, people.leadPersonId)))
    .leftJoin(vendors, and(eq(vendors.orgId, people.orgId), eq(vendors.id, people.agencyVendorId)))
    .leftJoin(user, eq(user.id, people.userId));
}

type RecordRow = Awaited<ReturnType<ReturnType<typeof recordQuery>['where']>>[number];

function toRecord(row: RecordRow): PersonRecord {
  const p = row.person;
  return {
    id: p.id,
    number: p.number,
    firstName: p.firstName,
    lastName: p.lastName,
    preferredName: p.preferredName,
    kind: p.kind,
    status: p.status,
    homeSiteId: p.homeSiteId,
    homeSiteName: row.homeSiteName,
    usualAreaId: p.usualAreaId,
    usualAreaName: row.usualAreaName,
    laborClassId: p.laborClassId,
    laborClassName: row.laborClassName,
    leadPersonId: p.leadPersonId,
    leadName: row.leadFirst ? `${row.leadPreferred?.trim() || row.leadFirst} ${row.leadLast ?? ''}`.trim() : null,
    agencyVendorId: p.agencyVendorId,
    agencyName: row.agencyName,
    agencyRef: p.agencyRef,
    startDate: p.startDate,
    endDate: p.endDate,
    userId: p.userId,
    userName: row.userName,
    wmsUserId: p.wmsUserId,
    email: p.email,
    phone: p.phone,
    language: p.language,
    badgeHash: p.badgeHash,
    pinHash: p.pinHash,
    pinSetAt: p.pinSetAt,
    pinLockedUntil: p.pinLockedUntil,
    notifyEmail: p.notifyEmail,
    notes: p.notes,
    source: p.source,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export interface PeopleFilters {
  readonly q?: string | null;
  readonly siteId?: string | null;
  readonly kind?: PersonKind | null;
  /** `current` (default): active and on leave. `all`: every status. */
  readonly status?: PersonStatus | 'current' | 'all' | null;
  readonly agencyId?: string | null;
  readonly laborClassId?: string | null;
  readonly ids?: readonly string[] | null;
  readonly limit?: number;
}

function filterWhere(ctx: DomainContext, access: CrewAccess, filters: PeopleFilters): SQL {
  const parts: (SQL | undefined)[] = [eq(people.orgId, ctx.orgId), isNull(people.deletedAt), peopleScope(access)];
  const q = cleanText(filters.q);
  if (q) {
    const like = `%${q.replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
    parts.push(or(ilike(people.firstName, like), ilike(people.lastName, like), ilike(people.preferredName, like), ilike(people.number, like), ilike(people.agencyRef, like)));
  }
  if (filters.siteId) parts.push(eq(people.homeSiteId, filters.siteId));
  if (filters.kind) parts.push(eq(people.kind, filters.kind));
  const status = filters.status ?? 'current';
  if (status === 'current') parts.push(ne(people.status, 'ended'));
  else if (status !== 'all') parts.push(eq(people.status, status));
  if (filters.agencyId) parts.push(eq(people.agencyVendorId, filters.agencyId));
  if (filters.laborClassId) parts.push(eq(people.laborClassId, filters.laborClassId));
  if (filters.ids) parts.push(filters.ids.length > 0 ? inArray(people.id, [...filters.ids]) : sql`false`);
  return and(...parts)!;
}

/** Raw records in scope, for the list, the export and bulk actions. */
export const listPersonRecords = scoped(async function listPersonRecords(ctx: DomainContext, access: CrewAccess, filters: PeopleFilters = {}, executor: Executor = db): Promise<PersonRecord[]> {
  const found = await recordQuery(executor)
    .where(filterWhere(ctx, access, filters))
    .orderBy(asc(people.lastName), asc(people.firstName), asc(people.number))
    .limit(Math.min(filters.limit ?? 2000, 5000));
  return found.map(toRecord);
});

export interface PeopleList {
  readonly items: PersonListItemDto[];
  readonly privateHidden: boolean;
}

export const listPeople = scoped(async function listPeople(ctx: DomainContext, filters: PeopleFilters = {}): Promise<PeopleList> {
  const access = await requireAction(ctx, 'crew:read');
  const records = await listPersonRecords(ctx, access, filters);
  const sight = sightOf(access);
  return { items: records.map((record) => toPersonListItem(record, sight)), privateHidden: !sight.canSeePrivate };
});

async function loadRecord(executor: Executor, ctx: DomainContext, access: CrewAccess, personId: string): Promise<PersonRecord> {
  const [found] = await recordQuery(executor).where(and(filterWhere(ctx, access, { status: 'all' }), eq(people.id, personId)));
  if (!found) throw notFound('That person');
  return toRecord(found);
}

async function loadPrivate(executor: Executor, orgId: string, personId: string): Promise<PrivateRecord | null> {
  const [found] = await executor.select().from(personPrivate).where(and(eq(personPrivate.orgId, orgId), eq(personPrivate.personId, personId)));
  return found ? { emergencyName: found.emergencyName, emergencyPhone: found.emergencyPhone, emergencyRelation: found.emergencyRelation, homeAddress: found.homeAddress, privateNotes: found.privateNotes } : null;
}

async function loadPay(executor: Executor, orgId: string, personId: string): Promise<PayRecord> {
  const [pay] = await executor.select().from(personPay).where(and(eq(personPay.orgId, orgId), eq(personPay.personId, personId)));
  const wages = await executor.select().from(personWages).where(and(eq(personWages.orgId, orgId), eq(personWages.personId, personId))).orderBy(desc(personWages.effectiveFrom));
  return {
    payType: pay?.payType ?? 'hourly',
    overtimeExempt: pay?.overtimeExempt ?? false,
    wages: wages.map((wage) => ({ id: wage.id, effectiveFrom: wage.effectiveFrom, wageCents: wage.wageCents, note: wage.note, sentToPulseAt: wage.sentToPulseAt })),
  };
}

async function siteToday(executor: Executor, orgId: string, siteId: string): Promise<string> {
  const [site] = await executor.select({ timezone: sites.timezone }).from(sites).where(and(eq(sites.orgId, orgId), eq(sites.id, siteId)));
  return todayInZone(site?.timezone ?? 'UTC');
}

export interface PersonDetail {
  readonly person: PersonDto;
  readonly activity: ActivityDto[];
}

/** One person as the reader may see them, with their activity (redacted per reader). */
export const getPerson = scoped(async function getPerson(ctx: DomainContext, personId: string): Promise<PersonDetail> {
  const access = await requireAction(ctx, 'crew:read');
  if (!isUuid(personId)) throw notFound('That person');
  const record = await loadRecord(db, ctx, access, personId);
  const sight = sightOf(access);
  const [priv, pay, today] = await Promise.all([
    sight.canSeePrivate ? loadPrivate(db, ctx.orgId, personId) : Promise.resolve(null),
    sight.canSeePay ? loadPay(db, ctx.orgId, personId) : Promise.resolve(null),
    siteToday(db, ctx.orgId, record.homeSiteId),
  ]);
  const log = await db
    .select({ row: activity, actorName: user.name })
    .from(activity)
    .leftJoin(user, eq(user.id, activity.actorId))
    .where(and(eq(activity.orgId, ctx.orgId), eq(activity.entityId, personId)))
    .orderBy(desc(activity.createdAt))
    .limit(100);
  const entries: ActivityDto[] = [];
  for (const entry of log) {
    const dto = toActivityDto({ id: entry.row.id, verb: entry.row.verb, entityType: entry.row.entityType, entityId: entry.row.entityId, actorName: entry.actorName, actorKind: entry.row.actorKind, before: entry.row.before as Record<string, unknown> | null, after: entry.row.after as Record<string, unknown> | null, createdAt: entry.row.createdAt }, sight);
    if (dto) entries.push(dto);
  }
  return { person: toPersonDto(record, { private: priv, pay, today }, sight), activity: entries };
});

export interface Option {
  readonly value: string;
  readonly label: string;
}

export interface PersonFormOptions {
  readonly sites: readonly (Option & { readonly isDefault: boolean })[];
  readonly areas: readonly (Option & { readonly siteId: string })[];
  readonly laborClasses: readonly (Option & { readonly kind: string; readonly isDefault: boolean })[];
  readonly agencies: readonly Option[];
  readonly leads: readonly Option[];
  /** Org members who can be linked as the person's login. */
  readonly members: readonly (Option & { readonly email: string })[];
  readonly pinLength: PinLength;
  readonly numberPrefix: string;
}

/** Everything the person form and the filters need, inside the reader's scope. */
export const personFormOptions = scoped(async function personFormOptions(ctx: DomainContext): Promise<PersonFormOptions> {
  const access = await requireAction(ctx, 'crew:read');
  const [siteRows, areaRows, classRows, agencyRows, leadRows, memberRows, settingsRows] = await Promise.all([
    db.select().from(sites).where(and(eq(sites.orgId, ctx.orgId), isNull(sites.deletedAt), isNull(sites.archivedAt))).orderBy(sql`${sites.isDefault} desc`, asc(sites.name)),
    db.select().from(areas).where(and(eq(areas.orgId, ctx.orgId), isNull(areas.deletedAt), isNull(areas.archivedAt))).orderBy(asc(areas.position), asc(areas.name)),
    db.select().from(laborClasses).where(and(eq(laborClasses.orgId, ctx.orgId), isNull(laborClasses.deletedAt), isNull(laborClasses.archivedAt))).orderBy(asc(laborClasses.name)),
    db.select({ id: vendors.id, name: vendors.name }).from(vendors).where(and(eq(vendors.orgId, ctx.orgId), sql`'temp_agency' = any(${vendors.kinds})`, isNull(vendors.archivedAt), isNull(vendors.deletedAt))).orderBy(asc(vendors.name)),
    db.select({ id: people.id, number: people.number, firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName }).from(people).where(and(eq(people.orgId, ctx.orgId), isNull(people.deletedAt), ne(people.status, 'ended'))).orderBy(asc(people.lastName), asc(people.firstName)),
    canCrew(access.role, 'person:manage')
      ? db.select({ id: user.id, name: user.name, email: user.email }).from(member).innerJoin(user, eq(user.id, member.userId)).where(eq(member.organizationId, ctx.orgId)).orderBy(asc(user.name))
      : Promise.resolve([] as { id: string; name: string; email: string }[]),
    db.select().from(settings).where(eq(settings.orgId, ctx.orgId)),
  ]);
  const visibleSites = siteRows.filter((site) => siteInScope(access, site.id));
  const siteIds = new Set(visibleSites.map((site) => site.id));
  const set = settingsRows[0];
  return {
    sites: visibleSites.map((site) => ({ value: site.id, label: `${site.name} (${site.code})`, isDefault: site.isDefault })),
    areas: areaRows.filter((area) => siteIds.has(area.siteId)).map((area) => ({ value: area.id, label: area.name, siteId: area.siteId })),
    laborClasses: classRows.map((row) => ({ value: row.id, label: row.name, kind: row.kind, isDefault: row.isDefault })),
    agencies: agencyRows.map((row) => ({ value: row.id, label: row.name })),
    leads: leadRows.map((row) => ({ value: row.id, label: `${row.preferredName?.trim() || row.firstName} ${row.lastName} (${row.number})` })),
    members: memberRows.map((row) => ({ value: row.id, label: row.name, email: row.email })),
    pinLength: (set?.pinLength === 6 ? 6 : 4) as PinLength,
    numberPrefix: set?.numberPrefixTemp ?? 'T-',
  };
});

/* Writing --------------------------------------------------------------------------------------- */

export interface PersonInput {
  readonly number?: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName?: string | null;
  readonly kind?: PersonKind;
  readonly status?: PersonStatus;
  readonly homeSiteId?: string | null;
  readonly usualAreaId?: string | null;
  readonly laborClassId?: string | null;
  readonly leadPersonId?: string | null;
  readonly agencyVendorId?: string | null;
  readonly agencyRef?: string | null;
  readonly startDate?: string | null;
  readonly endDate?: string | null;
  readonly language?: Language;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly notes?: string | null;
  readonly userId?: string | null;
  readonly notifyEmail?: boolean;
  /** A badge value to set (only its hash is kept). Undefined keeps the badge. */
  readonly badge?: string | null;
}

export interface PrivateInput {
  readonly emergencyName?: string | null;
  readonly emergencyPhone?: string | null;
  readonly emergencyRelation?: string | null;
  readonly privateNotes?: string | null;
}

export interface PayInput {
  readonly payType?: PayType;
  readonly overtimeExempt?: boolean;
  /** A wage in force from today (in the home site's zone). */
  readonly wageCents?: number | null;
}

export interface WriteOptions {
  readonly source?: string;
  readonly sourceRef?: string | null;
  readonly importBatchId?: string | null;
}

/** The next made number: the temp prefix and `settings.number_seq + 1`, skipping numbers in use. */
export async function nextPersonNumber(tx: Executor, orgId: string): Promise<string> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const [row] = await tx
      .update(settings)
      .set({ numberSeq: sql`${settings.numberSeq} + 1` })
      .where(eq(settings.orgId, orgId))
      .returning({ seq: settings.numberSeq, prefix: settings.numberPrefixTemp });
    if (!row) throw new Error('Crew settings are missing.');
    const number = `${row.prefix}${row.seq}`;
    const [taken] = await tx.select({ id: people.id }).from(people).where(and(eq(people.orgId, orgId), sql`lower(${people.number}) = lower(${number})`, isNull(people.deletedAt)));
    if (!taken) return number;
  }
  throw conflict('Crew could not make a free number. Type one instead.');
}

function checkDate(value: string | null | undefined, field: string): string | null {
  if (value === null || value === undefined || value === '') return null;
  if (!isRealDate(value)) throw invalid('That date is not real.', { [field]: 'Use a date like 2026-11-03.' });
  return value;
}

interface CleanPerson {
  readonly number: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly preferredName: string | null;
  readonly kind: PersonKind;
  readonly status: PersonStatus;
  readonly homeSiteId: string;
  readonly usualAreaId: string | null;
  readonly laborClassId: string | null;
  readonly leadPersonId: string | null;
  readonly agencyVendorId: string | null;
  readonly agencyRef: string | null;
  readonly startDate: string | null;
  readonly endDate: string | null;
  readonly language: Language;
  readonly email: string | null;
  readonly phone: string | null;
  readonly notes: string | null;
  readonly userId: string | null;
  readonly notifyEmail: boolean;
}

/** Checks a person against the rules of SPEC 5.2 and the rows it points at. Throws VALIDATION with field messages. */
async function cleanPerson(tx: Executor, ctx: DomainContext, input: PersonInput, personId: string | null, defaultSiteId: string): Promise<CleanPerson> {
  const fields: Record<string, string> = {};
  const firstName = cleanText(input.firstName);
  const lastName = cleanText(input.lastName);
  if (!firstName) fields.firstName = 'Type a first name.';
  if (!lastName) fields.lastName = 'Type a last name.';
  const agencyVendorId = cleanText(input.agencyVendorId);
  const kind: PersonKind = input.kind ?? (agencyVendorId ? 'temp' : 'employee');
  if (!(PERSON_KINDS as readonly string[]).includes(kind)) fields.kind = 'Pick employee, temp or seasonal.';
  const status: PersonStatus = input.status ?? 'active';
  if (!(PERSON_STATUSES as readonly string[]).includes(status)) fields.status = 'Pick a status.';
  const language: Language = input.language ?? 'en';
  if (!(LANGUAGES as readonly string[]).includes(language)) fields.language = 'Pick English or Spanish.';
  const startDate = checkDate(input.startDate, 'startDate');
  const endDate = checkDate(input.endDate, 'endDate');
  if (startDate && endDate && endDate < startDate) fields.endDate = 'The end date is before the start date.';
  if (status === 'ended' && !endDate) fields.endDate = 'An ended person needs an end date.';
  if (agencyVendorId && kind !== 'temp') fields.agencyVendorId = 'Only temps come from an agency.';
  const homeSiteId = cleanText(input.homeSiteId) ?? defaultSiteId;
  const usualAreaId = cleanText(input.usualAreaId);
  const laborClassId = cleanText(input.laborClassId);
  const leadPersonId = cleanText(input.leadPersonId);
  const userId = cleanText(input.userId);
  const email = cleanText(input.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields.email = 'That is not an email address.';
  if (Object.keys(fields).length > 0) throw invalid('Some fields need another look.', fields);

  const [site] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.orgId, ctx.orgId), eq(sites.id, homeSiteId), isNull(sites.deletedAt), isNull(sites.archivedAt)));
  if (!site) throw invalid('Pick a site.', { homeSiteId: 'That site is not open.' });
  if (usualAreaId) {
    const [area] = await tx.select({ siteId: areas.siteId }).from(areas).where(and(eq(areas.orgId, ctx.orgId), eq(areas.id, usualAreaId), isNull(areas.deletedAt), isNull(areas.archivedAt)));
    if (!area || area.siteId !== homeSiteId) throw invalid('Pick an area at the home site.', { usualAreaId: 'That area is not at this site.' });
  }
  if (laborClassId) {
    const [found] = await tx.select({ id: laborClasses.id }).from(laborClasses).where(and(eq(laborClasses.orgId, ctx.orgId), eq(laborClasses.id, laborClassId), isNull(laborClasses.deletedAt), isNull(laborClasses.archivedAt)));
    if (!found) throw invalid('Pick a labor class.', { laborClassId: 'That labor class is not open.' });
  }
  if (leadPersonId) {
    if (leadPersonId === personId) throw invalid('A person cannot lead themselves.', { leadPersonId: 'Pick someone else.' });
    const [found] = await tx.select({ id: people.id }).from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.id, leadPersonId), isNull(people.deletedAt), ne(people.status, 'ended')));
    if (!found) throw invalid('Pick a lead who still works here.', { leadPersonId: 'That person is not here.' });
  }
  if (agencyVendorId) {
    const [found] = await tx.select({ id: vendors.id }).from(vendors).where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.id, agencyVendorId), sql`'temp_agency' = any(${vendors.kinds})`, isNull(vendors.archivedAt), isNull(vendors.deletedAt)));
    if (!found) throw invalid('Pick an agency.', { agencyVendorId: 'That agency is not open.' });
  }
  if (userId) {
    const [found] = await tx.select({ id: member.userId }).from(member).where(and(eq(member.organizationId, ctx.orgId), eq(member.userId, userId)));
    if (!found) throw invalid('Pick someone in this workspace.', { userId: 'That login is not in this workspace.' });
  }
  return {
    number: cleanText(input.number),
    firstName: firstName!,
    lastName: lastName!,
    preferredName: cleanText(input.preferredName),
    kind,
    status,
    homeSiteId,
    usualAreaId,
    laborClassId,
    leadPersonId,
    agencyVendorId,
    agencyRef: cleanText(input.agencyRef),
    startDate,
    endDate,
    language,
    email,
    phone: cleanText(input.phone),
    notes: cleanText(input.notes),
    userId,
    notifyEmail: input.notifyEmail ?? true,
  };
}

async function defaultSiteId(tx: Executor, orgId: string): Promise<string> {
  const [site] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.orgId, orgId), eq(sites.isDefault, true), isNull(sites.deletedAt)));
  if (!site) throw invalid('Crew has no default site yet. Open Getting started first.');
  return site.id;
}

/** The parts of a person that activity keeps (pay is logged under person_pay, never here). */
function activityView(person: CleanPerson & { readonly number: string }): Record<string, unknown> {
  return {
    number: person.number,
    name: `${person.firstName} ${person.lastName}`,
    kind: person.kind,
    status: person.status,
    homeSiteId: person.homeSiteId,
    usualAreaId: person.usualAreaId,
    laborClassId: person.laborClassId,
    leadPersonId: person.leadPersonId,
    agencyVendorId: person.agencyVendorId,
    startDate: person.startDate,
    endDate: person.endDate,
    userId: person.userId,
    email: person.email,
    phone: person.phone,
  };
}

function cleanPrivate(input: PrivateInput): PrivateInput {
  return { emergencyName: cleanText(input.emergencyName), emergencyPhone: cleanText(input.emergencyPhone), emergencyRelation: cleanText(input.emergencyRelation), privateNotes: cleanText(input.privateNotes) };
}

async function writePrivate(tx: Transaction, ctx: DomainContext, personId: string, input: PrivateInput): Promise<void> {
  const clean = cleanPrivate(input);
  const set: Record<string, string | null> = {};
  for (const [key, value] of Object.entries(clean)) if (input[key as keyof PrivateInput] !== undefined) set[key] = value ?? null;
  if (Object.keys(set).length === 0) return;
  await tx
    .insert(personPrivate)
    .values({ orgId: ctx.orgId, personId, ...set })
    .onConflictDoUpdate({ target: [personPrivate.orgId, personPrivate.personId], set: { ...set, updatedAt: new Date() } });
  await logActivity(tx, ctx, { verb: 'person.private_changed', entityType: 'person_private', entityId: personId, after: set });
}

async function writePay(tx: Transaction, ctx: DomainContext, personId: string, homeSiteId: string, input: PayInput): Promise<void> {
  if (input.payType !== undefined && !(PAY_TYPES as readonly string[]).includes(input.payType)) throw invalid('Pick hourly or salary.', { payType: 'Pick hourly or salary.' });
  if (input.payType !== undefined || input.overtimeExempt !== undefined) {
    const set = { ...(input.payType !== undefined ? { payType: input.payType } : {}), ...(input.overtimeExempt !== undefined ? { overtimeExempt: input.overtimeExempt } : {}), updatedBy: ctx.actorKind === 'user' ? ctx.userId : null };
    await tx.insert(personPay).values({ orgId: ctx.orgId, personId, ...set }).onConflictDoUpdate({ target: [personPay.orgId, personPay.personId], set: { ...set, updatedAt: new Date() } });
    await logActivity(tx, ctx, { verb: 'person.pay_changed', entityType: 'person_pay', entityId: personId, after: { payType: input.payType, overtimeExempt: input.overtimeExempt } });
  }
  if (input.wageCents !== undefined && input.wageCents !== null) {
    await setWageRow(tx, ctx, personId, await siteToday(tx, ctx.orgId, homeSiteId), input.wageCents, null);
  }
}

async function setWageRow(tx: Transaction, ctx: DomainContext, personId: string, effectiveFrom: string, wageCents: number, note: string | null): Promise<void> {
  if (!Number.isInteger(wageCents) || wageCents < 0 || wageCents > 1_000_000) throw invalid('That wage is outside what Crew can store.', { wageCents: 'Use dollars per hour, like 19.50.' });
  if (!isRealDate(effectiveFrom)) throw invalid('Pick the date the wage starts.', { effectiveFrom: 'Use a date like 2026-11-03.' });
  await tx
    .insert(personWages)
    .values({ orgId: ctx.orgId, personId, effectiveFrom, wageCents, note, createdBy: ctx.actorKind === 'user' ? ctx.userId : null })
    .onConflictDoUpdate({ target: [personWages.orgId, personWages.personId, personWages.effectiveFrom], set: { wageCents, note, updatedAt: new Date(), version: sql`${personWages.version} + 1` } });
  await logActivity(tx, ctx, { verb: 'person.wage_set', entityType: 'person_wage', entityId: personId, after: { effectiveFrom, wageCents } });
}

export interface WriteResult {
  readonly id: string;
  readonly number: string;
  readonly created: boolean;
}

/**
 * Makes or changes one person inside a transaction, with no permission check of its own. Callers
 * (the actions below, the import commit, agency acceptance and the seed) check rights first.
 */
export async function writePerson(
  tx: Transaction,
  ctx: DomainContext,
  existing: { readonly id: string; readonly version: number } | null,
  input: PersonInput,
  extra: { readonly private?: PrivateInput; readonly pay?: PayInput; readonly expectedVersion?: number | null; readonly options?: WriteOptions } = {},
): Promise<WriteResult> {
  const fallbackSite = await defaultSiteId(tx, ctx.orgId);
  const clean = await cleanPerson(tx, ctx, input, existing?.id ?? null, fallbackSite);
  const actor = ctx.actorKind === 'user' ? ctx.userId : null;
  const badgeHash = input.badge === undefined ? undefined : hashBadge(input.badge);
  let id: string;
  let number: string;
  if (existing) {
    const [current] = await tx.select().from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.id, existing.id), isNull(people.deletedAt))).for('update');
    if (!current) throw notFound('That person');
    assertVersion(current.version, extra.expectedVersion);
    number = clean.number ?? current.number;
    const { number: _ignored, ...rest } = clean;
    void _ignored;
    await tx
      .update(people)
      .set({ ...rest, number, ...(badgeHash !== undefined ? { badgeHash } : {}), updatedBy: actor, updatedAt: new Date(), version: sql`${people.version} + 1` })
      .where(and(eq(people.orgId, ctx.orgId), eq(people.id, existing.id)));
    id = existing.id;
    const before = { number: current.number, name: `${current.firstName} ${current.lastName}`, kind: current.kind, status: current.status, homeSiteId: current.homeSiteId, usualAreaId: current.usualAreaId, laborClassId: current.laborClassId, leadPersonId: current.leadPersonId, agencyVendorId: current.agencyVendorId, startDate: current.startDate, endDate: current.endDate, userId: current.userId, email: current.email, phone: current.phone };
    await logActivity(tx, ctx, { verb: 'person.updated', entityType: 'person', entityId: id, before, after: activityView({ ...clean, number }) });
  } else {
    number = clean.number ?? (await nextPersonNumber(tx, ctx.orgId));
    const [made] = await tx
      .insert(people)
      .values({
        orgId: ctx.orgId,
        ...clean,
        number,
        badgeHash: badgeHash ?? null,
        source: extra.options?.source ?? 'manual',
        sourceRef: extra.options?.sourceRef ?? null,
        importBatchId: extra.options?.importBatchId ?? null,
        createdBy: actor,
        updatedBy: actor,
      })
      .returning({ id: people.id });
    id = made!.id;
    await logActivity(tx, ctx, { verb: 'person.created', entityType: 'person', entityId: id, after: activityView({ ...clean, number }), meta: { source: extra.options?.source ?? 'manual' } });
  }
  if (extra.private) await writePrivate(tx, ctx, id, extra.private);
  if (extra.pay) await writePay(tx, ctx, id, clean.homeSiteId, extra.pay);
  return { id, number, created: !existing };
}

function checkRights(access: CrewAccess, extra: { readonly private?: PrivateInput; readonly pay?: PayInput }): void {
  if (extra.pay && !canCrew(access.role, 'pay:manage')) throw accessDenied(access.role);
  if (extra.private && !canCrew(access.role, 'person:private_read')) throw accessDenied(access.role);
}

export const createPerson = scoped(async function createPerson(ctx: DomainContext, input: PersonInput, extra: { readonly private?: PrivateInput; readonly pay?: PayInput } = {}): Promise<WriteResult> {
  const access = await requireAction(ctx, 'person:manage');
  checkRights(access, extra);
  return inTx(async (tx) => {
    const siteId = cleanText(input.homeSiteId) ?? (await defaultSiteId(tx, ctx.orgId));
    requireSite(access, siteId);
    return writePerson(tx, ctx, null, { ...input, homeSiteId: siteId }, extra);
  });
});

/** Loads a live person the actor may manage, for a write. */
async function managed(tx: Executor, ctx: DomainContext, access: CrewAccess, personId: string): Promise<typeof people.$inferSelect> {
  const [found] = await tx.select().from(people).where(and(filterWhere(ctx, access, { status: 'all' }), eq(people.id, personId)));
  if (!found) throw notFound('That person');
  requireSite(access, found.homeSiteId);
  return found;
}

export const updatePerson = scoped(async function updatePerson(ctx: DomainContext, personId: string, version: number, input: PersonInput, extra: { readonly private?: PrivateInput; readonly pay?: PayInput } = {}): Promise<WriteResult> {
  const access = await requireAction(ctx, 'person:manage');
  checkRights(access, extra);
  return inTx(async (tx) => {
    const current = await managed(tx, ctx, access, personId);
    const siteId = cleanText(input.homeSiteId) ?? current.homeSiteId;
    requireSite(access, siteId);
    // Fields left out of the input keep what Crew has (a form never wipes what it did not show).
    const merged: PersonInput = {
      ...input,
      homeSiteId: siteId,
      email: input.email === undefined ? current.email : input.email,
      phone: input.phone === undefined ? current.phone : input.phone,
      notes: input.notes === undefined ? current.notes : input.notes,
      userId: input.userId === undefined ? current.userId : input.userId,
    };
    return writePerson(tx, ctx, { id: current.id, version: current.version }, merged, { ...extra, expectedVersion: version });
  });
});

export const setPersonPrivate = scoped(async function setPersonPrivate(ctx: DomainContext, personId: string, input: PrivateInput): Promise<void> {
  const access = await requireAction(ctx, 'person:manage');
  if (!canCrew(access.role, 'person:private_read')) throw accessDenied(access.role);
  await inTx(async (tx) => {
    await managed(tx, ctx, access, personId);
    await writePrivate(tx, ctx, personId, input);
  });
});

export const setPersonPay = scoped(async function setPersonPay(ctx: DomainContext, personId: string, input: { readonly payType?: PayType; readonly overtimeExempt?: boolean }): Promise<void> {
  const access = await requireAction(ctx, 'pay:manage');
  await inTx(async (tx) => {
    const person = await managed(tx, ctx, access, personId);
    await writePay(tx, ctx, personId, person.homeSiteId, input);
  });
});

export const setWage = scoped(async function setWage(ctx: DomainContext, personId: string, input: { readonly effectiveFrom: string; readonly wageCents: number; readonly note?: string | null }): Promise<void> {
  const access = await requireAction(ctx, 'pay:manage');
  await inTx(async (tx) => {
    await managed(tx, ctx, access, personId);
    await setWageRow(tx, ctx, personId, input.effectiveFrom, input.wageCents, cleanText(input.note));
  });
});

export const removeWage = scoped(async function removeWage(ctx: DomainContext, personId: string, wageId: string): Promise<void> {
  const access = await requireAction(ctx, 'pay:manage');
  await inTx(async (tx) => {
    await managed(tx, ctx, access, personId);
    const [gone] = await tx.delete(personWages).where(and(eq(personWages.orgId, ctx.orgId), eq(personWages.personId, personId), eq(personWages.id, wageId))).returning();
    if (!gone) throw notFound('That wage');
    if (gone.sentToPulseAt) throw conflict('This wage was already sent to Pulse. Change it in Pulse.');
    await logActivity(tx, ctx, { verb: 'person.wage_removed', entityType: 'person_wage', entityId: personId, before: { effectiveFrom: gone.effectiveFrom, wageCents: gone.wageCents } });
  });
});

/** Soft delete for a person added by mistake. People who worked are ended, never removed. */
export const removePerson = scoped(async function removePerson(ctx: DomainContext, personId: string): Promise<void> {
  const access = await requireAction(ctx, 'person:manage');
  await inTx(async (tx) => {
    const person = await managed(tx, ctx, access, personId);
    const [led] = await tx.select({ n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.leadPersonId, personId), isNull(people.deletedAt)));
    if ((led?.n ?? 0) > 0) throw conflict('This person leads other people. Pick a new lead for them first.');
    await tx.update(people).set({ deletedAt: new Date(), userId: null, badgeHash: null, updatedAt: new Date(), version: sql`${people.version} + 1` }).where(and(eq(people.orgId, ctx.orgId), eq(people.id, personId)));
    await logActivity(tx, ctx, { verb: 'person.removed', entityType: 'person', entityId: personId, before: { number: person.number, name: `${person.firstName} ${person.lastName}` } });
  });
});

/* PINs and badges ------------------------------------------------------------------------------- */

export interface PinSlip {
  readonly personId: string;
  readonly number: string;
  readonly name: string;
  readonly siteName: string | null;
  /** Shown once, on the slip. Only its hash is kept. */
  readonly pin: string;
}

/**
 * A new random starting PIN for each person (SPEC 7: a file never sets a PIN). The PINs come back
 * once, for the print view, and are never shown again. Also clears a PIN lock.
 */
export const issuePinSlips = scoped(async function issuePinSlips(ctx: DomainContext, personIds: readonly string[]): Promise<PinSlip[]> {
  const access = await requireAction(ctx, 'person:manage');
  const unique = [...new Set(personIds)];
  if (unique.length === 0) throw invalid('Pick at least one person.');
  if (unique.length > 500) throw invalid('Print up to 500 slips at a time.');
  return inTx(async (tx) => {
    const [set] = await tx.select({ pinLength: settings.pinLength }).from(settings).where(eq(settings.orgId, ctx.orgId));
    const length = (set?.pinLength === 6 ? 6 : 4) as PinLength;
    const records = await listPersonRecords(ctx, access, { ids: unique, status: 'current' }, tx);
    if (records.length !== unique.length) throw notFound('One of those people');
    const slips: PinSlip[] = [];
    for (const record of records) {
      requireSite(access, record.homeSiteId);
      const pin = generatePin(length);
      await tx.update(people).set({ pinHash: hashPin(pin), pinSetAt: new Date(), pinFails: 0, pinLockedUntil: null, updatedAt: new Date() }).where(and(eq(people.orgId, ctx.orgId), eq(people.id, record.id)));
      await logActivity(tx, ctx, { verb: 'person.pin_reset', entityType: 'person', entityId: record.id });
      slips.push({ personId: record.id, number: record.number, name: `${record.preferredName?.trim() || record.firstName} ${record.lastName}`, siteName: record.homeSiteName, pin });
    }
    return slips;
  });
});

/** Sets or clears a badge (only the hash is kept). */
export const setBadge = scoped(async function setBadge(ctx: DomainContext, personId: string, badge: string | null): Promise<{ readonly hasBadge: boolean }> {
  const access = await requireAction(ctx, 'person:manage');
  return inTx(async (tx) => {
    await managed(tx, ctx, access, personId);
    const badgeHash = hashBadge(badge);
    await tx.update(people).set({ badgeHash, updatedAt: new Date(), version: sql`${people.version} + 1` }).where(and(eq(people.orgId, ctx.orgId), eq(people.id, personId)));
    await logActivity(tx, ctx, { verb: badgeHash ? 'person.badge_set' : 'person.badge_cleared', entityType: 'person', entityId: personId });
    return { hasBadge: badgeHash !== null };
  });
});

/* Bulk ------------------------------------------------------------------------------------------ */

export interface BulkPatch {
  readonly homeSiteId?: string;
  readonly leadPersonId?: string | null;
  readonly status?: PersonStatus;
  /** Needed when the status is ended. */
  readonly endDate?: string | null;
}

export const bulkUpdatePeople = scoped(async function bulkUpdatePeople(ctx: DomainContext, personIds: readonly string[], patch: BulkPatch): Promise<{ readonly updated: number }> {
  const access = await requireAction(ctx, 'person:manage');
  const unique = [...new Set(personIds)];
  if (unique.length === 0) throw invalid('Pick at least one person.');
  return inTx(async (tx) => {
    let updated = 0;
    for (const personId of unique) {
      const current = await managed(tx, ctx, access, personId);
      const input: PersonInput = {
        number: current.number,
        firstName: current.firstName,
        lastName: current.lastName,
        preferredName: current.preferredName,
        kind: current.kind as PersonKind,
        status: patch.status ?? (current.status as PersonStatus),
        homeSiteId: patch.homeSiteId ?? current.homeSiteId,
        usualAreaId: patch.homeSiteId && patch.homeSiteId !== current.homeSiteId ? null : current.usualAreaId,
        laborClassId: current.laborClassId,
        leadPersonId: patch.leadPersonId !== undefined ? patch.leadPersonId : current.leadPersonId,
        agencyVendorId: current.agencyVendorId,
        agencyRef: current.agencyRef,
        startDate: current.startDate,
        endDate: patch.status === 'ended' ? (patch.endDate ?? current.endDate) : current.endDate,
        language: current.language as Language,
        email: current.email,
        phone: current.phone,
        notes: current.notes,
        userId: current.userId,
        notifyEmail: current.notifyEmail,
      };
      if (input.homeSiteId) requireSite(access, input.homeSiteId);
      await writePerson(tx, ctx, { id: current.id, version: current.version }, input);
      updated += 1;
    }
    return { updated };
  });
});
