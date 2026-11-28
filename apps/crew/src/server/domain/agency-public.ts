/**
 * The public agency link (docs/crew/SPEC.md 6.1 `/join/a/[token]`, 8.8 `POST /api/v1/agency/[token]`).
 * No login: the token is the key. Finding the workspace from a token is cross workspace by design,
 * so that one lookup runs `asSystem`; everything after it runs inside the link's workspace. A link
 * that is revoked, expired, full, turned off in Settings, or from a workspace outside the preview
 * answers "This link is not active." and says nothing else. The page shows only the site name and
 * the agency name. Rate limited per link and per sender.
 */
import 'server-only';
import { and, eq, gt, isNull, ne, sql } from 'drizzle-orm';
import { organization, vendors } from '@kitstak/db/schema';
import { db } from '@/server/db';
import { asSystem, withOrg } from '@/server/db/scope';
import { agencyLinks, agencySubmissions, settings, sites } from '@/server/db/schema';
import { orgCrewAccess } from '@/server/entitlements';
import { DomainError, invalid } from '@/server/errors';
import { isRealDate } from '@/lib/dates';
import { cleanText } from './_shared';
import { sha256 } from './pins';

/** Rows one request may send (SPEC 8.8). */
export const AGENCY_ROWS_PER_REQUEST = 50;
/** Rows one sender may send to one link in an hour. */
export const AGENCY_ROWS_PER_HOUR = 200;

export const LINK_NOT_ACTIVE = 'This link is not active.';

export interface PublicLink {
  readonly siteName: string;
  readonly agencyName: string;
  /** How many more people this link takes. */
  readonly remaining: number;
}

interface FoundLink {
  readonly id: string;
  readonly orgId: string;
  readonly orgSlug: string;
  readonly siteName: string;
  readonly agencyName: string;
  readonly maxPeople: number;
}

const notActive = (): DomainError => new DomainError('NOT_FOUND', LINK_NOT_ACTIVE);

async function findLink(token: string): Promise<FoundLink | null> {
  if (!/^[A-Za-z0-9_-]{20,100}$/.test(token)) return null;
  const hash = sha256(token);
  const [row] = await asSystem('agency link: find the workspace of a token', () =>
    db
      .select({ id: agencyLinks.id, orgId: agencyLinks.orgId, orgSlug: organization.slug, siteName: sites.name, agencyName: vendors.name, maxPeople: agencyLinks.maxPeople, agencyLinksOn: settings.agencyLinks })
      .from(agencyLinks)
      .innerJoin(organization, eq(organization.id, agencyLinks.orgId))
      .innerJoin(sites, and(eq(sites.orgId, agencyLinks.orgId), eq(sites.id, agencyLinks.siteId), isNull(sites.deletedAt)))
      .innerJoin(vendors, and(eq(vendors.id, agencyLinks.vendorId), isNull(vendors.archivedAt), isNull(vendors.deletedAt)))
      .leftJoin(settings, eq(settings.orgId, agencyLinks.orgId))
      .where(and(eq(agencyLinks.tokenHash, hash), isNull(agencyLinks.revokedAt), isNull(agencyLinks.deletedAt), gt(agencyLinks.expiresAt, sql`now()`)))
      .limit(1),
  );
  if (!row || row.agencyLinksOn === false) return null;
  if ((await orgCrewAccess({ id: row.orgId, slug: row.orgSlug })) === 'locked') return null;
  return { id: row.id, orgId: row.orgId, orgSlug: row.orgSlug, siteName: row.siteName, agencyName: row.agencyName, maxPeople: row.maxPeople };
}

async function usedCount(link: FoundLink): Promise<number> {
  const [row] = await withOrg(link.orgId, () =>
    db.select({ n: sql<number>`count(*)::int` }).from(agencySubmissions).where(and(eq(agencySubmissions.orgId, link.orgId), eq(agencySubmissions.linkId, link.id), ne(agencySubmissions.status, 'rejected'))),
  );
  return row?.n ?? 0;
}

/** What the public page shows, or null when the link is not active. Never throws. */
export async function readPublicLink(token: string): Promise<PublicLink | null> {
  try {
    const link = await findLink(token);
    if (!link) return null;
    const remaining = Math.max(0, link.maxPeople - (await usedCount(link)));
    if (remaining === 0) return null;
    return { siteName: link.siteName, agencyName: link.agencyName, remaining };
  } catch (error) {
    console.error('[crew] agency link read failed', error);
    return null;
  }
}

export interface AgencyRowInput {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone?: string | null;
  readonly email?: string | null;
  readonly agencyRef?: string | null;
  readonly startDate?: string | null;
  readonly language?: string | null;
}

/** Checks the rows of one submit. Returns the clean rows, or throws VALIDATION with a message per row. Pure. */
export interface CleanAgencyRow {
  readonly firstName: string;
  readonly lastName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly agencyRef: string | null;
  readonly startDate: string | null;
  readonly language: string;
}

export function cleanAgencyRows(rows: readonly AgencyRowInput[]): CleanAgencyRow[] {
  if (rows.length === 0) throw invalid('Add at least one person.');
  if (rows.length > AGENCY_ROWS_PER_REQUEST) throw invalid(`Send up to ${AGENCY_ROWS_PER_REQUEST} people at a time.`);
  const fields: Record<string, string> = {};
  const out = rows.map((row, index): CleanAgencyRow => {
    const at = `rows.${index}`;
    const firstName = cleanText(row.firstName);
    const lastName = cleanText(row.lastName);
    const email = cleanText(row.email)?.toLowerCase() ?? null;
    const startDate = cleanText(row.startDate);
    const language = cleanText(row.language)?.toLowerCase() ?? 'en';
    if (!firstName || firstName.length > 80) fields[`${at}.firstName`] = `Row ${index + 1}: type a first name.`;
    if (!lastName || lastName.length > 80) fields[`${at}.lastName`] = `Row ${index + 1}: type a last name.`;
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fields[`${at}.email`] = `Row ${index + 1}: that is not an email address.`;
    if (startDate && !isRealDate(startDate)) fields[`${at}.startDate`] = `Row ${index + 1}: use a date like 2026-12-01.`;
    if (language !== 'en' && language !== 'es') fields[`${at}.language`] = `Row ${index + 1}: pick English or Spanish.`;
    return {
      firstName: firstName ?? '',
      lastName: lastName ?? '',
      phone: cleanText(row.phone)?.slice(0, 40) ?? null,
      email,
      agencyRef: cleanText(row.agencyRef)?.slice(0, 80) ?? null,
      startDate: startDate ?? null,
      language,
    };
  });
  if (Object.keys(fields).length > 0) throw invalid(Object.values(fields)[0]!, fields);
  return out;
}

/** Stores the rows as pending submissions for a supervisor to accept. */
export async function submitAgencyRows(token: string, rows: readonly AgencyRowInput[], sender: string): Promise<{ readonly received: number }> {
  const link = await findLink(token);
  if (!link) throw notActive();
  const clean = cleanAgencyRows(rows);
  const ipHash = sha256(`${link.id}:${sender}`);
  return withOrg(link.orgId, () =>
    db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`crew-agency-link:${link.id}`}))`);
      const [recent] = await tx
        .select({ n: sql<number>`count(*)::int` })
        .from(agencySubmissions)
        .where(and(eq(agencySubmissions.orgId, link.orgId), eq(agencySubmissions.linkId, link.id), eq(agencySubmissions.ipHash, ipHash), gt(agencySubmissions.createdAt, sql`now() - interval '1 hour'`)));
      if ((recent?.n ?? 0) + clean.length > AGENCY_ROWS_PER_HOUR) throw new DomainError('RATE_LIMITED', 'That is a lot of people in one hour. Wait a little and try again.');
      const [used] = await tx.select({ n: sql<number>`count(*)::int` }).from(agencySubmissions).where(and(eq(agencySubmissions.orgId, link.orgId), eq(agencySubmissions.linkId, link.id), ne(agencySubmissions.status, 'rejected')));
      const remaining = link.maxPeople - (used?.n ?? 0);
      if (remaining <= 0) throw notActive();
      if (clean.length > remaining) throw invalid(`This link takes ${remaining} more ${remaining === 1 ? 'person' : 'people'}. Send fewer rows or ask for a new link.`);
      await tx.insert(agencySubmissions).values(clean.map((row) => ({ orgId: link.orgId, linkId: link.id, ...row, ipHash })));
      return { received: clean.length };
    }),
  );
}
