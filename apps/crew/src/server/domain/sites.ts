/**
 * Settings: General, Sites and areas (docs/crew/SPEC.md 5.1 and 6.1 `/settings`). Every write
 * needs `settings:manage`. Archive rules: the default site and a site or area that live people
 * still use cannot be archived; archived rows keep their history and free their code.
 */
import 'server-only';
import { and, asc, eq, isNull, ne, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { areas, people, settings, sites } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { isDefaultMemberRole } from '@kitstak/crew-bridge';
import { requireCrew } from './access';
import { assertVersion, cleanText, inTx, isValidTimezone, type DomainContext } from './_shared';
import { logActivity } from './activity';
import { loadSettings, type CrewSettings } from './settings';

/* General --------------------------------------------------------------------------------------- */

export interface GeneralSettingsInput {
  readonly weekStart: number;
  readonly pinLength: 4 | 6;
  readonly numberPrefixTemp: string;
  readonly defaultMemberRole: string;
  readonly defaultTimezone: string;
  readonly agencyLinks: boolean;
}

export const updateGeneralSettings = scoped(async function updateGeneralSettings(ctx: DomainContext, input: GeneralSettingsInput): Promise<CrewSettings> {
  await requireCrew(ctx, 'settings:manage');
  const fields: Record<string, string> = {};
  if (!Number.isInteger(input.weekStart) || input.weekStart < 0 || input.weekStart > 6) fields.weekStart = 'Pick a day.';
  if (input.pinLength !== 4 && input.pinLength !== 6) fields.pinLength = 'Pick 4 or 6 digits.';
  const prefix = input.numberPrefixTemp.trim();
  if (prefix.length > 8 || /\s/.test(prefix)) fields.numberPrefixTemp = 'Up to 8 letters, digits or marks, no spaces.';
  if (!isDefaultMemberRole(input.defaultMemberRole)) fields.defaultMemberRole = 'Pick supervisor, lead, viewer or no role.';
  if (!isValidTimezone(input.defaultTimezone)) fields.defaultTimezone = 'That time zone is not known.';
  if (Object.keys(fields).length > 0) throw invalid('Some fields need another look.', fields);
  return inTx(async (tx) => {
    const before = await loadSettings(ctx.orgId, tx);
    const [after] = await tx
      .update(settings)
      .set({ weekStart: input.weekStart, pinLength: input.pinLength, numberPrefixTemp: prefix, defaultMemberRole: input.defaultMemberRole, defaultTimezone: input.defaultTimezone, agencyLinks: input.agencyLinks, updatedAt: new Date() })
      .where(eq(settings.orgId, ctx.orgId))
      .returning();
    await logActivity(tx, ctx, {
      verb: 'settings.changed',
      entityType: 'settings',
      before: { weekStart: before.weekStart, pinLength: before.pinLength, numberPrefixTemp: before.numberPrefixTemp, defaultMemberRole: before.defaultMemberRole, defaultTimezone: before.defaultTimezone, agencyLinks: before.agencyLinks },
      after: { ...input, numberPrefixTemp: prefix },
    });
    return after!;
  });
});

/* Sites ----------------------------------------------------------------------------------------- */

export interface SiteRow {
  readonly id: string;
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
  readonly isDefault: boolean;
  readonly weekStart: number;
  readonly fenceRadiusM: number;
  readonly version: number;
  readonly peopleCount: number;
  readonly areas: readonly AreaRow[];
}

export interface AreaRow {
  readonly id: string;
  readonly siteId: string;
  readonly code: string;
  readonly name: string;
  readonly position: number;
  readonly peopleCount: number;
}

/** Live sites with their areas and how many current people use each. */
export const listSitesWithAreas = scoped(async function listSitesWithAreas(ctx: DomainContext): Promise<SiteRow[]> {
  await requireCrew(ctx, 'crew:read');
  const [siteRows, areaRows, siteCounts, areaCounts] = await Promise.all([
    db.select().from(sites).where(and(eq(sites.orgId, ctx.orgId), isNull(sites.deletedAt), isNull(sites.archivedAt))).orderBy(sql`${sites.isDefault} desc`, asc(sites.name)),
    db.select().from(areas).where(and(eq(areas.orgId, ctx.orgId), isNull(areas.deletedAt), isNull(areas.archivedAt))).orderBy(asc(areas.position), asc(areas.name)),
    db.select({ id: people.homeSiteId, n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), isNull(people.deletedAt), ne(people.status, 'ended'))).groupBy(people.homeSiteId),
    db.select({ id: people.usualAreaId, n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), isNull(people.deletedAt), ne(people.status, 'ended'))).groupBy(people.usualAreaId),
  ]);
  const bySite = new Map(siteCounts.map((row) => [row.id, row.n]));
  const byArea = new Map(areaCounts.map((row) => [row.id, row.n]));
  return siteRows.map((site) => ({
    id: site.id,
    code: site.code,
    name: site.name,
    timezone: site.timezone,
    isDefault: site.isDefault,
    weekStart: site.weekStart,
    fenceRadiusM: site.fenceRadiusM,
    version: site.version,
    peopleCount: bySite.get(site.id) ?? 0,
    areas: areaRows.filter((area) => area.siteId === site.id).map((area) => ({ id: area.id, siteId: area.siteId, code: area.code, name: area.name, position: area.position, peopleCount: byArea.get(area.id) ?? 0 })),
  }));
});

export interface SiteInput {
  readonly code: string;
  readonly name: string;
  readonly timezone: string;
  readonly weekStart: number;
  readonly isDefault?: boolean;
}

function cleanSite(input: SiteInput): SiteInput {
  const code = cleanText(input.code)?.toUpperCase() ?? '';
  const name = cleanText(input.name) ?? '';
  const fields: Record<string, string> = {};
  if (!code || code.length > 20 || /\s/.test(code)) fields.code = 'Type a short code with no spaces, like MLT1.';
  if (!name || name.length > 80) fields.name = 'Type a name.';
  if (!isValidTimezone(input.timezone)) fields.timezone = 'That time zone is not known.';
  if (!Number.isInteger(input.weekStart) || input.weekStart < 0 || input.weekStart > 6) fields.weekStart = 'Pick a day.';
  if (Object.keys(fields).length > 0) throw invalid('Some fields need another look.', fields);
  return { ...input, code, name };
}

export const createSite = scoped(async function createSite(ctx: DomainContext, input: SiteInput): Promise<{ readonly id: string }> {
  await requireCrew(ctx, 'settings:manage');
  const clean = cleanSite(input);
  return inTx(async (tx) => {
    if (clean.isDefault) await tx.update(sites).set({ isDefault: false }).where(and(eq(sites.orgId, ctx.orgId), eq(sites.isDefault, true)));
    const [made] = await tx.insert(sites).values({ orgId: ctx.orgId, code: clean.code, name: clean.name, timezone: clean.timezone, weekStart: clean.weekStart, isDefault: clean.isDefault ?? false }).returning({ id: sites.id });
    await logActivity(tx, ctx, { verb: 'site.created', entityType: 'site', entityId: made!.id, after: { code: clean.code, name: clean.name, timezone: clean.timezone } });
    return { id: made!.id };
  });
});

export const updateSite = scoped(async function updateSite(ctx: DomainContext, siteId: string, version: number, input: SiteInput): Promise<void> {
  await requireCrew(ctx, 'settings:manage');
  const clean = cleanSite(input);
  await inTx(async (tx) => {
    const [current] = await tx.select().from(sites).where(and(eq(sites.orgId, ctx.orgId), eq(sites.id, siteId), isNull(sites.deletedAt), isNull(sites.archivedAt))).for('update');
    if (!current) throw notFound('That site');
    assertVersion(current.version, version);
    if (current.isDefault && clean.isDefault === false) throw conflict('Make another site the default first.');
    if (clean.isDefault && !current.isDefault) await tx.update(sites).set({ isDefault: false }).where(and(eq(sites.orgId, ctx.orgId), eq(sites.isDefault, true)));
    await tx
      .update(sites)
      .set({ code: clean.code, name: clean.name, timezone: clean.timezone, weekStart: clean.weekStart, isDefault: clean.isDefault ?? current.isDefault, updatedAt: new Date(), version: sql`${sites.version} + 1` })
      .where(and(eq(sites.orgId, ctx.orgId), eq(sites.id, siteId)));
    await logActivity(tx, ctx, { verb: 'site.updated', entityType: 'site', entityId: siteId, before: { code: current.code, name: current.name, timezone: current.timezone, weekStart: current.weekStart }, after: { code: clean.code, name: clean.name, timezone: clean.timezone, weekStart: clean.weekStart } });
  });
});

export const archiveSite = scoped(async function archiveSite(ctx: DomainContext, siteId: string): Promise<void> {
  await requireCrew(ctx, 'settings:manage');
  await inTx(async (tx) => {
    const [current] = await tx.select().from(sites).where(and(eq(sites.orgId, ctx.orgId), eq(sites.id, siteId), isNull(sites.deletedAt), isNull(sites.archivedAt))).for('update');
    if (!current) throw notFound('That site');
    if (current.isDefault) throw conflict('The default site cannot be archived. Make another site the default first.');
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.homeSiteId, siteId), isNull(people.deletedAt), ne(people.status, 'ended')));
    if ((used?.n ?? 0) > 0) throw conflict(`${used!.n} ${used!.n === 1 ? 'person has' : 'people have'} this as their home site. Move them first.`);
    // Archived rows free their code: the live code key ignores deleted rows, so mark both.
    await tx.update(sites).set({ archivedAt: new Date(), deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(sites.orgId, ctx.orgId), eq(sites.id, siteId)));
    await logActivity(tx, ctx, { verb: 'site.archived', entityType: 'site', entityId: siteId, before: { code: current.code, name: current.name } });
  });
});

/* Areas ----------------------------------------------------------------------------------------- */

export interface AreaInput {
  readonly siteId: string;
  readonly code: string;
  readonly name: string;
  readonly position?: number;
}

function cleanArea(input: AreaInput): AreaInput {
  const code = cleanText(input.code)?.toUpperCase() ?? '';
  const name = cleanText(input.name) ?? '';
  const fields: Record<string, string> = {};
  if (!code || code.length > 20 || /\s/.test(code)) fields.code = 'Type a short code with no spaces, like KIT1.';
  if (!name || name.length > 80) fields.name = 'Type a name.';
  if (Object.keys(fields).length > 0) throw invalid('Some fields need another look.', fields);
  return { ...input, code, name };
}

export const createArea = scoped(async function createArea(ctx: DomainContext, input: AreaInput): Promise<{ readonly id: string }> {
  await requireCrew(ctx, 'settings:manage');
  const clean = cleanArea(input);
  return inTx(async (tx) => {
    const [site] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.orgId, ctx.orgId), eq(sites.id, clean.siteId), isNull(sites.deletedAt)));
    if (!site) throw notFound('That site');
    const [last] = await tx.select({ max: sql<number>`coalesce(max(${areas.position}), -1)::int` }).from(areas).where(and(eq(areas.orgId, ctx.orgId), eq(areas.siteId, clean.siteId), isNull(areas.deletedAt)));
    const [made] = await tx.insert(areas).values({ orgId: ctx.orgId, siteId: clean.siteId, code: clean.code, name: clean.name, position: clean.position ?? (last?.max ?? -1) + 1 }).returning({ id: areas.id });
    await logActivity(tx, ctx, { verb: 'area.created', entityType: 'area', entityId: made!.id, after: { siteId: clean.siteId, code: clean.code, name: clean.name } });
    return { id: made!.id };
  });
});

export const updateArea = scoped(async function updateArea(ctx: DomainContext, areaId: string, input: Omit<AreaInput, 'siteId'>): Promise<void> {
  await requireCrew(ctx, 'settings:manage');
  await inTx(async (tx) => {
    const [current] = await tx.select().from(areas).where(and(eq(areas.orgId, ctx.orgId), eq(areas.id, areaId), isNull(areas.deletedAt)));
    if (!current) throw notFound('That area');
    const clean = cleanArea({ ...input, siteId: current.siteId });
    await tx.update(areas).set({ code: clean.code, name: clean.name, position: clean.position ?? current.position, updatedAt: new Date() }).where(and(eq(areas.orgId, ctx.orgId), eq(areas.id, areaId)));
    await logActivity(tx, ctx, { verb: 'area.updated', entityType: 'area', entityId: areaId, before: { code: current.code, name: current.name }, after: { code: clean.code, name: clean.name } });
  });
});

export const archiveArea = scoped(async function archiveArea(ctx: DomainContext, areaId: string): Promise<void> {
  await requireCrew(ctx, 'settings:manage');
  await inTx(async (tx) => {
    const [current] = await tx.select().from(areas).where(and(eq(areas.orgId, ctx.orgId), eq(areas.id, areaId), isNull(areas.deletedAt)));
    if (!current) throw notFound('That area');
    const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.usualAreaId, areaId), isNull(people.deletedAt), ne(people.status, 'ended')));
    if ((used?.n ?? 0) > 0) throw conflict(`${used!.n} ${used!.n === 1 ? 'person works' : 'people work'} in this area. Pick another usual area for them first.`);
    await tx.update(areas).set({ archivedAt: new Date(), deletedAt: new Date(), updatedAt: new Date() }).where(and(eq(areas.orgId, ctx.orgId), eq(areas.id, areaId)));
    await logActivity(tx, ctx, { verb: 'area.archived', entityType: 'area', entityId: areaId, before: { code: current.code, name: current.name } });
  });
});
