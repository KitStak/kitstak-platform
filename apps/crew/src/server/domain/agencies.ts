/**
 * Agencies and agency links (docs/crew/SPEC.md 5.2, 6.1 `/people/agencies`). An agency is a row of
 * the shared `core.vendors` whose kinds hold `temp_agency`; Crew writes it only through
 * `upsertVendorKind`, edits name and contact, and archives it only when `temp_agency` is its one
 * kind (Ledger may pay the same company as a supplier). An agency link lets the agency type in
 * its own people; each submission waits until a supervisor accepts it, and then becomes a person.
 */
import 'server-only';
import { and, asc, desc, eq, inArray, isNull, ne, sql } from 'drizzle-orm';
import { vendors, type Vendor } from '@kitstak/db/schema';
import { db } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { agencyLinks, agencySubmissions, people, sites } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { canCrew } from '@/lib/permissions';
import { accessDenied, crewAccessFor } from './access';
import { cleanText, inTx, isUuid, type DomainContext } from './_shared';
import { logActivity } from './activity';
import { newLinkToken } from './pins';
import { siteInScope, writePerson } from './people';
import { upsertVendorKind } from './vendors';

export const LINK_DAYS_DEFAULT = 14;

async function requireManage(ctx: DomainContext) {
  const access = await crewAccessFor(ctx);
  if (!canCrew(access.role, 'person:manage')) throw accessDenied(access.role);
  return access;
}

export interface AgencyRow {
  readonly id: string;
  readonly name: string;
  readonly email: string | null;
  readonly phone: string | null;
  readonly kinds: readonly string[];
  readonly activePeople: number;
  readonly pendingSubmissions: number;
}

const agencyWhere = (orgId: string) => and(eq(vendors.orgId, orgId), sql`'temp_agency' = any(${vendors.kinds})`, isNull(vendors.archivedAt), isNull(vendors.deletedAt));

export const listAgencies = scoped(async function listAgencies(ctx: DomainContext): Promise<AgencyRow[]> {
  await requireManage(ctx);
  const [rows, counts, pending] = await Promise.all([
    db.select().from(vendors).where(agencyWhere(ctx.orgId)).orderBy(asc(vendors.name)),
    db.select({ id: people.agencyVendorId, n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), isNull(people.deletedAt), eq(people.status, 'active'))).groupBy(people.agencyVendorId),
    db
      .select({ id: agencyLinks.vendorId, n: sql<number>`count(*)::int` })
      .from(agencySubmissions)
      .innerJoin(agencyLinks, and(eq(agencyLinks.orgId, agencySubmissions.orgId), eq(agencyLinks.id, agencySubmissions.linkId)))
      .where(and(eq(agencySubmissions.orgId, ctx.orgId), eq(agencySubmissions.status, 'pending')))
      .groupBy(agencyLinks.vendorId),
  ]);
  const active = new Map(counts.map((row) => [row.id, row.n]));
  const waiting = new Map(pending.map((row) => [row.id, row.n]));
  return rows.map((row) => ({ id: row.id, name: row.name, email: row.email, phone: row.phone, kinds: row.kinds, activePeople: active.get(row.id) ?? 0, pendingSubmissions: waiting.get(row.id) ?? 0 }));
});

export interface AgencyLinkRow {
  readonly id: string;
  readonly prefix: string | null;
  readonly siteId: string;
  readonly siteName: string;
  readonly expiresAt: string;
  readonly maxPeople: number;
  readonly used: number;
  readonly state: 'open' | 'expired' | 'revoked';
  readonly createdAt: string;
}

export interface SubmissionRow {
  readonly id: string;
  readonly linkPrefix: string | null;
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly agencyRef: string | null;
  readonly startDate: string | null;
  readonly language: string;
  readonly status: string;
  readonly personId: string | null;
  readonly createdAt: string;
}

export interface AgencyDetail {
  readonly agency: AgencyRow & { readonly notes: string | null; readonly canArchive: boolean; readonly sharedWith: readonly string[] };
  readonly people: readonly { readonly id: string; readonly number: string; readonly name: string; readonly status: string; readonly siteName: string | null; readonly agencyRef: string | null; readonly startDate: string | null }[];
  readonly links: readonly AgencyLinkRow[];
  readonly submissions: readonly SubmissionRow[];
  readonly sites: readonly { readonly value: string; readonly label: string }[];
}

async function loadAgency(executor: typeof db | Parameters<Parameters<typeof inTx>[0]>[0], orgId: string, vendorId: string): Promise<Vendor> {
  const [found] = await executor.select().from(vendors).where(and(agencyWhere(orgId), eq(vendors.id, vendorId)));
  if (!found) throw notFound('That agency');
  return found;
}

export const getAgency = scoped(async function getAgency(ctx: DomainContext, vendorId: string): Promise<AgencyDetail> {
  const access = await requireManage(ctx);
  if (!isUuid(vendorId)) throw notFound('That agency');
  const agency = await loadAgency(db, ctx.orgId, vendorId);
  const [personRows, linkRows, submissionRows, siteRows] = await Promise.all([
    db
      .select({ id: people.id, number: people.number, firstName: people.firstName, lastName: people.lastName, preferredName: people.preferredName, status: people.status, siteName: sites.name, homeSiteId: people.homeSiteId, agencyRef: people.agencyRef, startDate: people.startDate })
      .from(people)
      .leftJoin(sites, and(eq(sites.orgId, people.orgId), eq(sites.id, people.homeSiteId)))
      .where(and(eq(people.orgId, ctx.orgId), eq(people.agencyVendorId, vendorId), isNull(people.deletedAt)))
      .orderBy(asc(people.lastName), asc(people.firstName)),
    db
      .select({ link: agencyLinks, siteName: sites.name, used: sql<number>`(select count(*)::int from crew.agency_submissions s where s.org_id = ${agencyLinks.orgId} and s.link_id = ${agencyLinks.id} and s.status <> 'rejected')` })
      .from(agencyLinks)
      .innerJoin(sites, and(eq(sites.orgId, agencyLinks.orgId), eq(sites.id, agencyLinks.siteId)))
      .where(and(eq(agencyLinks.orgId, ctx.orgId), eq(agencyLinks.vendorId, vendorId), isNull(agencyLinks.deletedAt)))
      .orderBy(desc(agencyLinks.createdAt)),
    db
      .select({ row: agencySubmissions, prefix: agencyLinks.tokenPrefix })
      .from(agencySubmissions)
      .innerJoin(agencyLinks, and(eq(agencyLinks.orgId, agencySubmissions.orgId), eq(agencyLinks.id, agencySubmissions.linkId)))
      .where(and(eq(agencySubmissions.orgId, ctx.orgId), eq(agencyLinks.vendorId, vendorId), ne(agencySubmissions.status, 'rejected')))
      .orderBy(desc(agencySubmissions.createdAt))
      .limit(500),
    db.select({ id: sites.id, name: sites.name, code: sites.code }).from(sites).where(and(eq(sites.orgId, ctx.orgId), isNull(sites.deletedAt), isNull(sites.archivedAt))).orderBy(sql`${sites.isDefault} desc`, asc(sites.name)),
  ]);
  const now = new Date();
  const active = personRows.filter((row) => row.status === 'active').length;
  const pending = submissionRows.filter((entry) => entry.row.status === 'pending').length;
  return {
    agency: {
      id: agency.id,
      name: agency.name,
      email: agency.email,
      phone: agency.phone,
      notes: agency.notes,
      kinds: agency.kinds,
      activePeople: active,
      pendingSubmissions: pending,
      canArchive: agency.kinds.length === 1 && agency.kinds[0] === 'temp_agency',
      sharedWith: agency.kinds.filter((kind) => kind !== 'temp_agency'),
    },
    people: personRows.filter((row) => siteInScope(access, row.homeSiteId)).map((row) => ({ id: row.id, number: row.number, name: `${row.preferredName?.trim() || row.firstName} ${row.lastName}`, status: row.status, siteName: row.siteName, agencyRef: row.agencyRef, startDate: row.startDate })),
    links: linkRows.map(({ link, siteName, used }) => ({
      id: link.id,
      prefix: link.tokenPrefix,
      siteId: link.siteId,
      siteName,
      expiresAt: link.expiresAt.toISOString(),
      maxPeople: link.maxPeople,
      used,
      state: link.revokedAt ? 'revoked' : link.expiresAt <= now ? 'expired' : 'open',
      createdAt: link.createdAt.toISOString(),
    })),
    submissions: submissionRows.map(({ row, prefix }) => ({ id: row.id, linkPrefix: prefix, firstName: row.firstName, lastName: row.lastName, phone: row.phone, email: row.email, agencyRef: row.agencyRef, startDate: row.startDate, language: row.language, status: row.status, personId: row.personId, createdAt: row.createdAt.toISOString() })),
    sites: siteRows.filter((site) => siteInScope(access, site.id)).map((site) => ({ value: site.id, label: `${site.name} (${site.code})` })),
  };
});

export interface AgencyInput {
  readonly name: string;
  readonly email?: string | null;
  readonly phone?: string | null;
  readonly notes?: string | null;
}

export const createAgency = scoped(async function createAgency(ctx: DomainContext, input: AgencyInput): Promise<{ readonly id: string; readonly created: boolean }> {
  await requireManage(ctx);
  return inTx(async (tx) => {
    const { vendor, created } = await upsertVendorKind(tx, ctx, { name: input.name, kind: 'temp_agency', email: input.email, phone: input.phone });
    if (!created && (cleanText(input.email) || cleanText(input.phone) || cleanText(input.notes))) {
      await tx
        .update(vendors)
        .set({ email: vendor.email ?? cleanText(input.email), phone: vendor.phone ?? cleanText(input.phone), notes: vendor.notes ?? cleanText(input.notes), updatedAt: new Date() })
        .where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.id, vendor.id)));
    } else if (created && cleanText(input.notes)) {
      await tx.update(vendors).set({ notes: cleanText(input.notes) }).where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.id, vendor.id)));
    }
    return { id: vendor.id, created };
  });
});

export const updateAgency = scoped(async function updateAgency(ctx: DomainContext, vendorId: string, input: AgencyInput): Promise<void> {
  await requireManage(ctx);
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the agency a name.', { name: 'Type a name.' });
  const email = cleanText(input.email)?.toLowerCase() ?? null;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw invalid('That is not an email address.', { email: 'That is not an email address.' });
  await inTx(async (tx) => {
    const before = await loadAgency(tx, ctx.orgId, vendorId);
    await tx
      .update(vendors)
      .set({ name, email, phone: cleanText(input.phone), notes: cleanText(input.notes), updatedBy: ctx.userId, updatedAt: new Date(), version: sql`${vendors.version} + 1` })
      .where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.id, vendorId)));
    await logActivity(tx, ctx, { verb: 'vendor.updated', entityType: 'vendor', entityId: vendorId, before: { name: before.name, email: before.email, phone: before.phone }, after: { name, email, phone: cleanText(input.phone) } });
  });
});

/** Archives an agency only when Crew is its one user (kinds = {temp_agency}) and nobody active is from it. */
export const archiveAgency = scoped(async function archiveAgency(ctx: DomainContext, vendorId: string): Promise<void> {
  await requireManage(ctx);
  await inTx(async (tx) => {
    const agency = await loadAgency(tx, ctx.orgId, vendorId);
    if (!(agency.kinds.length === 1 && agency.kinds[0] === 'temp_agency')) {
      throw conflict('This company is also used outside Crew, so it stays. Ledger may still pay it.');
    }
    const [busy] = await tx.select({ n: sql<number>`count(*)::int` }).from(people).where(and(eq(people.orgId, ctx.orgId), eq(people.agencyVendorId, vendorId), isNull(people.deletedAt), ne(people.status, 'ended')));
    if ((busy?.n ?? 0) > 0) throw conflict(`${busy!.n} ${busy!.n === 1 ? 'person from this agency still works' : 'people from this agency still work'} here. End them first.`);
    await tx.update(vendors).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(vendors.orgId, ctx.orgId), eq(vendors.id, vendorId)));
    await tx.update(agencyLinks).set({ revokedAt: new Date() }).where(and(eq(agencyLinks.orgId, ctx.orgId), eq(agencyLinks.vendorId, vendorId), isNull(agencyLinks.revokedAt)));
    await logActivity(tx, ctx, { verb: 'vendor.archived', entityType: 'vendor', entityId: vendorId, before: { name: agency.name } });
  });
});

/* Links ----------------------------------------------------------------------------------------- */

export interface NewLink {
  readonly id: string;
  /** Shown once. Only its hash is kept. */
  readonly token: string;
  readonly expiresAt: string;
}

export const createAgencyLink = scoped(async function createAgencyLink(ctx: DomainContext, vendorId: string, input: { readonly siteId: string; readonly days?: number; readonly maxPeople?: number }): Promise<NewLink> {
  const access = await requireManage(ctx);
  const days = input.days ?? LINK_DAYS_DEFAULT;
  const maxPeople = input.maxPeople ?? 50;
  if (!Number.isInteger(days) || days < 1 || days > 60) throw invalid('A link lasts 1 to 60 days.', { days: 'Pick 1 to 60 days.' });
  if (!Number.isInteger(maxPeople) || maxPeople < 1 || maxPeople > 500) throw invalid('A link takes 1 to 500 people.', { maxPeople: 'Pick 1 to 500.' });
  if (!siteInScope(access, input.siteId)) throw accessDenied(access.role);
  return inTx(async (tx) => {
    await loadAgency(tx, ctx.orgId, vendorId);
    const [site] = await tx.select({ id: sites.id }).from(sites).where(and(eq(sites.orgId, ctx.orgId), eq(sites.id, input.siteId), isNull(sites.deletedAt)));
    if (!site) throw invalid('Pick a site.', { siteId: 'That site is not open.' });
    const { token, hash, prefix } = newLinkToken();
    const expiresAt = new Date(Date.now() + days * 86_400_000);
    const [made] = await tx.insert(agencyLinks).values({ orgId: ctx.orgId, vendorId, siteId: input.siteId, tokenHash: hash, tokenPrefix: prefix, expiresAt, maxPeople, createdBy: ctx.userId }).returning({ id: agencyLinks.id });
    await logActivity(tx, ctx, { verb: 'agency_link.created', entityType: 'agency_link', entityId: made!.id, after: { vendorId, siteId: input.siteId, days, maxPeople } });
    return { id: made!.id, token, expiresAt: expiresAt.toISOString() };
  });
});

export const revokeAgencyLink = scoped(async function revokeAgencyLink(ctx: DomainContext, linkId: string): Promise<void> {
  await requireManage(ctx);
  await inTx(async (tx) => {
    const [gone] = await tx.update(agencyLinks).set({ revokedAt: new Date(), updatedAt: new Date() }).where(and(eq(agencyLinks.orgId, ctx.orgId), eq(agencyLinks.id, linkId), isNull(agencyLinks.revokedAt))).returning({ id: agencyLinks.id });
    if (!gone) throw notFound('That link');
    await logActivity(tx, ctx, { verb: 'agency_link.revoked', entityType: 'agency_link', entityId: linkId });
  });
});

/* Submissions ----------------------------------------------------------------------------------- */

export interface DecideResult {
  readonly accepted: number;
  readonly rejected: number;
  readonly personIds: readonly string[];
}

/** Accepts pending submissions: each becomes a temp person from the link's agency, at the link's site. */
export const acceptSubmissions = scoped(async function acceptSubmissions(ctx: DomainContext, submissionIds: readonly string[]): Promise<DecideResult> {
  const access = await requireManage(ctx);
  const ids = [...new Set(submissionIds)];
  if (ids.length === 0) throw invalid('Pick at least one person to accept.');
  return inTx(async (tx) => {
    const found = await tx
      .select({ row: agencySubmissions, vendorId: agencyLinks.vendorId, siteId: agencyLinks.siteId })
      .from(agencySubmissions)
      .innerJoin(agencyLinks, and(eq(agencyLinks.orgId, agencySubmissions.orgId), eq(agencyLinks.id, agencySubmissions.linkId)))
      .where(and(eq(agencySubmissions.orgId, ctx.orgId), inArray(agencySubmissions.id, ids)))
      .for('update');
    if (found.length !== ids.length) throw notFound('One of those people');
    const personIds: string[] = [];
    for (const { row, vendorId, siteId } of found) {
      if (row.status !== 'pending') throw conflict(`${row.firstName} ${row.lastName} was already ${row.status}.`);
      if (!siteInScope(access, siteId)) throw accessDenied(access.role);
      const result = await writePerson(
        tx,
        ctx,
        null,
        { firstName: row.firstName, lastName: row.lastName, kind: 'temp', homeSiteId: siteId, agencyVendorId: vendorId, agencyRef: row.agencyRef, startDate: row.startDate, language: row.language === 'es' ? 'es' : 'en', email: row.email, phone: row.phone },
        { options: { source: 'agency_link', sourceRef: `agency_submission:${row.id}` } },
      );
      await tx.update(agencySubmissions).set({ status: 'accepted', personId: result.id, decidedBy: ctx.userId, decidedAt: new Date(), updatedAt: new Date() }).where(and(eq(agencySubmissions.orgId, ctx.orgId), eq(agencySubmissions.id, row.id)));
      personIds.push(result.id);
    }
    await logActivity(tx, ctx, { verb: 'agency_submission.accepted', entityType: 'agency_submission', after: { count: ids.length } });
    return { accepted: ids.length, rejected: 0, personIds };
  });
});

export const rejectSubmissions = scoped(async function rejectSubmissions(ctx: DomainContext, submissionIds: readonly string[]): Promise<DecideResult> {
  await requireManage(ctx);
  const ids = [...new Set(submissionIds)];
  if (ids.length === 0) throw invalid('Pick at least one person to reject.');
  return inTx(async (tx) => {
    const done = await tx
      .update(agencySubmissions)
      .set({ status: 'rejected', decidedBy: ctx.userId, decidedAt: new Date(), updatedAt: new Date() })
      .where(and(eq(agencySubmissions.orgId, ctx.orgId), inArray(agencySubmissions.id, ids), eq(agencySubmissions.status, 'pending')))
      .returning({ id: agencySubmissions.id });
    if (done.length === 0) throw notFound('Those people');
    await logActivity(tx, ctx, { verb: 'agency_submission.rejected', entityType: 'agency_submission', after: { count: done.length } });
    return { accepted: 0, rejected: done.length, personIds: [] };
  });
});
