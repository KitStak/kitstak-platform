/**
 * Device links (SPEC 5.4) and the floor tablet (SPEC section 6, `/kiosk/t/[token]`).
 *
 * A device link is a long random secret for a shared screen: a wall TV or a floor tablet. Only a
 * hash of the secret is stored, so a leaked database row cannot open a screen. Links belong to
 * one site, expire (90 days by default) and can be turned off at any time.
 *
 * The floor tablet never holds a personal login. A person picks their name and types a 4 digit
 * PIN; that gives a signed 12 hour kiosk session for one site that may only log production.
 * Five wrong tries lock that name on that tablet for five minutes. Entries carry a stable
 * `clientRef` from the tablet, so a retry after bad wifi never logs the same work twice.
 * Nothing in this file ever returns money.
 */
import 'server-only';
import { createHash, createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { and, asc, desc, eq, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import {
  clients,
  deviceLinks,
  jobStats,
  jobs,
  memberRoles,
  productionEntries,
  sites,
} from '@/server/db/schema';
import { orgHasPulseModule } from '@/server/entitlements';
import { env } from '@/server/env';
import { DomainError, forbidden, invalid, notFound } from '@/server/errors';
import { canPulse } from '@/lib/permissions';
import { addDays, unitsPerHour } from '@/lib/profit';
import type {
  CreatedDeviceLinkDTO,
  DeviceLinkDTO,
  KioskJobDTO,
  KioskPersonDTO,
  KioskSaveDTO,
  KioskSessionDTO,
  KioskStateDTO,
} from '@/lib/types';
import { cleanText, inTx, iso, isoRequired, isUuid, rows, todayInZone, type DomainContext } from './_shared';
import { requirePulse } from './access';
import { logActivity } from './activity';
import { getSiteRow, resolveSite } from './catalog';
import { getJobRow } from './jobs';
import { assertCanLogDay } from './production';
import { assertOpen, finishWrite, newTouched, restampFixedJob, restampProduction, touchDay } from './recalc';
import { resolveAllAccess, verifyKioskPin } from './roles';
import { loadSettings } from './settings';

type LinkRow = typeof deviceLinks.$inferSelect;
export type DeviceKind = 'wall' | 'kiosk';

export const DEVICE_LINK_DAYS = 90;
export const KIOSK_SESSION_HOURS = 12;
export const KIOSK_IDLE_SECONDS = 120;
export const KIOSK_MAX_PIN_TRIES = 5;
export const KIOSK_LOCK_MINUTES = 5;

const hashToken = (token: string): string => createHash('sha256').update(token).digest('hex');

export const devicePath = (kind: DeviceKind, token: string): string =>
  kind === 'kiosk' ? `/kiosk/t/${token}` : `/wall/t/${token}`;

function linkStatus(
  row: Pick<LinkRow, 'revokedAt' | 'expiresAt'>,
  now = new Date(),
): DeviceLinkDTO['status'] {
  if (row.revokedAt) return 'revoked';
  return row.expiresAt.getTime() <= now.getTime() ? 'expired' : 'active';
}

/** Lock counters are private to the server: they never leave in a DTO. */
function publicConfig(config: Record<string, unknown> | null): Record<string, unknown> {
  const rest = { ...(config ?? {}) };
  delete rest.pinFails;
  return rest;
}

function toLinkDTO(row: LinkRow, siteName: string): DeviceLinkDTO {
  return {
    id: row.id,
    kind: row.kind as DeviceKind,
    name: row.name,
    siteId: row.siteId,
    siteName,
    tokenPrefix: row.tokenPrefix,
    config: publicConfig(row.config),
    expiresAt: isoRequired(row.expiresAt),
    lastSeenAt: iso(row.lastSeenAt),
    revokedAt: iso(row.revokedAt),
    createdBy: row.createdBy,
    createdAt: isoRequired(row.createdAt),
    status: linkStatus(row),
  };
}

/* ---------------------------------------------------------------- manage links (signed in) */

/** Device links of the org, newest first. Links that were turned off stay listed for the record. */
export async function listDeviceLinks(
  ctx: DomainContext,
  filters: { kind?: DeviceKind | null } = {},
): Promise<DeviceLinkDTO[]> {
  await requirePulse(ctx, 'device:manage');
  const found = await db
    .select({ row: deviceLinks, siteName: sites.name })
    .from(deviceLinks)
    .innerJoin(sites, eq(sites.id, deviceLinks.siteId))
    .where(
      and(
        eq(deviceLinks.orgId, ctx.orgId),
        isNull(deviceLinks.deletedAt),
        filters.kind ? eq(deviceLinks.kind, filters.kind) : undefined,
      ),
    )
    .orderBy(desc(deviceLinks.createdAt));
  return found.map((item) => toLinkDTO(item.row, item.siteName));
}

export interface DeviceLinkInput {
  kind: DeviceKind;
  name: string;
  siteId?: string | null;
  /** Days until the link stops working (1 to 365, default 90). */
  expiresInDays?: number | null;
  config?: Record<string, unknown> | null;
}

function expiry(days: number | null | undefined): Date {
  const span = Math.min(Math.max(Math.round(days ?? DEVICE_LINK_DAYS), 1), 365);
  return new Date(Date.now() + span * 86_400_000);
}

/** Makes a link and returns its secret once. Store the returned path on the device, not in Pulse. */
export async function createDeviceLink(
  ctx: DomainContext,
  input: DeviceLinkInput,
): Promise<CreatedDeviceLinkDTO> {
  await requirePulse(ctx, 'device:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the link a name, like "Line 2 tablet".', { name: 'This cannot be empty.' });
  if (input.kind !== 'kiosk' && input.kind !== 'wall')
    throw invalid('Pick a floor tablet or a wall display.');
  const config = publicConfig(input.config ?? null);
  return inTx(async (tx) => {
    const site = await resolveSite(ctx, input.siteId, tx);
    const token = randomBytes(24).toString('base64url');
    const [row] = await tx
      .insert(deviceLinks)
      .values({
        orgId: ctx.orgId,
        kind: input.kind,
        name,
        tokenHash: hashToken(token),
        tokenPrefix: token.slice(0, 6),
        siteId: site.id,
        config,
        expiresAt: expiry(input.expiresInDays),
        createdBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, {
      verb: 'device.created',
      entityType: 'device_link',
      entityId: row!.id,
      after: { kind: row!.kind, name: row!.name, siteId: site.id, expiresAt: isoRequired(row!.expiresAt) },
    });
    return { link: toLinkDTO(row!, site.name), token, path: devicePath(input.kind, token) };
  });
}

async function getLinkRow(tx: Executor, ctx: DomainContext, linkId: string): Promise<LinkRow> {
  const [row] = isUuid(linkId)
    ? await tx
        .select()
        .from(deviceLinks)
        .where(
          and(eq(deviceLinks.orgId, ctx.orgId), eq(deviceLinks.id, linkId), isNull(deviceLinks.deletedAt)),
        )
    : [];
  if (!row) throw notFound('That device link');
  return row;
}

/** Turns a link off right away. The screen shows "This link is not active" on its next request. */
export async function revokeDeviceLink(ctx: DomainContext, linkId: string): Promise<DeviceLinkDTO> {
  await requirePulse(ctx, 'device:manage');
  return inTx(async (tx) => {
    const row = await getLinkRow(tx, ctx, linkId);
    const site = await getSiteRow(ctx, row.siteId, tx);
    if (row.revokedAt) return toLinkDTO(row, site.name);
    const [after] = await tx
      .update(deviceLinks)
      .set({ revokedAt: new Date(), updatedAt: new Date() })
      .where(eq(deviceLinks.id, row.id))
      .returning();
    await logActivity(tx, ctx, {
      verb: 'device.revoked',
      entityType: 'device_link',
      entityId: row.id,
      before: { name: row.name },
      meta: { kind: row.kind },
    });
    return toLinkDTO(after!, site.name);
  });
}

/** Undo of "turn off", and "renew": the same secret works again for the given number of days. */
export async function renewDeviceLink(
  ctx: DomainContext,
  linkId: string,
  options: { expiresInDays?: number | null } = {},
): Promise<DeviceLinkDTO> {
  await requirePulse(ctx, 'device:manage');
  return inTx(async (tx) => {
    const row = await getLinkRow(tx, ctx, linkId);
    const site = await getSiteRow(ctx, row.siteId, tx);
    const [after] = await tx
      .update(deviceLinks)
      .set({ revokedAt: null, expiresAt: expiry(options.expiresInDays), updatedAt: new Date() })
      .where(eq(deviceLinks.id, row.id))
      .returning();
    await logActivity(tx, ctx, {
      verb: 'device.created',
      entityType: 'device_link',
      entityId: row.id,
      after: { name: row.name, expiresAt: isoRequired(after!.expiresAt) },
      meta: { kind: row.kind, renewed: true },
    });
    return toLinkDTO(after!, site.name);
  });
}

/** Renames a link or changes its options (for a kiosk: `idleSeconds`). */
export async function updateDeviceLink(
  ctx: DomainContext,
  linkId: string,
  patch: { name?: string; config?: Record<string, unknown> },
): Promise<DeviceLinkDTO> {
  await requirePulse(ctx, 'device:manage');
  return inTx(async (tx) => {
    const row = await getLinkRow(tx, ctx, linkId);
    const site = await getSiteRow(ctx, row.siteId, tx);
    const name = patch.name === undefined ? row.name : cleanText(patch.name);
    if (!name) throw invalid('Give the link a name.', { name: 'This cannot be empty.' });
    const wanted = publicConfig(patch.config ?? null);
    const config =
      patch.config === undefined
        ? row.config
        : { ...wanted, ...(row.config?.pinFails ? { pinFails: row.config.pinFails } : {}) };
    const [after] = await tx
      .update(deviceLinks)
      .set({ name, config, updatedAt: new Date() })
      .where(eq(deviceLinks.id, row.id))
      .returning();
    return toLinkDTO(after!, site.name);
  });
}

/* ---------------------------------------------------------------- open a link (no sign in) */

export interface ResolvedDevice {
  readonly link: LinkRow;
  readonly site: typeof sites.$inferSelect;
  readonly orgSlug: string;
}

const NOT_ACTIVE = 'This link is not active. Ask a manager to make a new one.';

/**
 * Finds the live link behind a secret. Returns null for an unknown, expired or turned off link,
 * and when the org no longer has Pulse. Marks the link as seen (at most once a minute).
 */
export async function resolveDeviceLink(token: string, kind: DeviceKind): Promise<ResolvedDevice | null> {
  if (typeof token !== 'string' || token.length < 16 || token.length > 128) return null;
  const [found] = await db
    .select({ link: deviceLinks, site: sites })
    .from(deviceLinks)
    .innerJoin(sites, eq(sites.id, deviceLinks.siteId))
    .where(
      and(
        eq(deviceLinks.tokenHash, hashToken(token)),
        eq(deviceLinks.kind, kind),
        isNull(deviceLinks.deletedAt),
      ),
    );
  if (!found || linkStatus(found.link) !== 'active') return null;
  if (!(await orgHasPulseModule(found.link.orgId))) return null;
  const [org] = await rows<{ slug: string }>(
    db,
    sql`SELECT slug FROM core.organization WHERE id = ${found.link.orgId}`,
  );
  if (!org) return null;
  if (!found.link.lastSeenAt || Date.now() - found.link.lastSeenAt.getTime() > 60_000) {
    await db.update(deviceLinks).set({ lastSeenAt: new Date() }).where(eq(deviceLinks.id, found.link.id));
  }
  return { link: found.link, site: found.site, orgSlug: org.slug };
}

/** A context that acts for the org on behalf of one of its people (used for the role lookup). */
function deviceContext(
  device: ResolvedDevice,
  person: { id: string; name: string; orgRole: DomainContext['orgRole'] },
): DomainContext {
  return {
    orgId: device.link.orgId,
    orgSlug: device.orgSlug,
    userId: person.id,
    userName: person.name,
    orgRole: person.orgRole,
    actorKind: 'user',
  };
}

function idleSeconds(link: LinkRow): number {
  const wanted = Number((link.config ?? {}).idleSeconds);
  return Number.isFinite(wanted) && wanted >= 30 && wanted <= 3600 ? Math.round(wanted) : KIOSK_IDLE_SECONDS;
}

/** People who may unlock this tablet: they can log production and have a kiosk PIN. */
async function kioskPeople(
  device: ResolvedDevice,
): Promise<{ id: string; name: string; orgRole: DomainContext['orgRole'] }[]> {
  const probe: DomainContext = {
    orgId: device.link.orgId,
    orgSlug: device.orgSlug,
    userId: device.link.createdBy ?? device.link.id,
    userName: 'KitStak',
    orgRole: 'owner',
    actorKind: 'system',
  };
  const members = await resolveAllAccess(probe);
  return members
    .filter((member) => member.hasKioskPin && canPulse(member.access.role, 'production:log'))
    .map((member) => ({ id: member.person.id, name: member.person.name, orgRole: member.person.orgRole }));
}

/** The lock screen of a floor tablet: site, today and the names that can unlock it. */
export async function getKioskState(token: string): Promise<KioskStateDTO | null> {
  const device = await resolveDeviceLink(token, 'kiosk');
  if (!device) return null;
  const settings = await loadSettings(device.link.orgId);
  const people = await kioskPeople(device);
  return {
    linkName: device.link.name,
    siteName: device.site.name,
    today: todayInZone(device.site.timezone),
    idleSeconds: idleSeconds(device.link),
    shiftHours: settings.defaultShiftHours,
    people: people.map((person) => ({ id: person.id, name: person.name })),
  };
}

/* ---------------------------------------------------------------- kiosk session */

function sessionKey(): Buffer {
  return createHmac('sha256', env.BETTER_AUTH_SECRET).update('pulse:kiosk-session:v1').digest();
}

function signSession(linkId: string, userId: string, expiresAt: number): string {
  const payload = `v1.${linkId}.${userId}.${expiresAt}`;
  return `${payload}.${createHmac('sha256', sessionKey()).update(payload).digest('base64url')}`;
}

/** The user id inside a kiosk session, or null when it is forged, expired or for another link. */
export function readKioskSession(session: string, linkId: string, now = Date.now()): string | null {
  if (typeof session !== 'string' || session.length > 400) return null;
  const parts = session.split('.');
  if (parts.length !== 5 || parts[0] !== 'v1') return null;
  const [, link, userId, expires, signature] = parts as [string, string, string, string, string];
  const expected = createHmac('sha256', sessionKey()).update(`v1.${link}.${userId}.${expires}`).digest();
  let given: Buffer;
  try {
    given = Buffer.from(signature, 'base64url');
  } catch {
    return null;
  }
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  if (link !== linkId || !isUuid(userId) || Number(expires) * 1000 <= now) return null;
  return userId;
}

interface PinFails {
  n: number;
  until?: string;
}

/**
 * Checks a name and PIN on a tablet. Wrong tries are counted per name on the link row inside a
 * transaction with a row lock, so parallel guesses cannot dodge the count.
 */
export async function unlockKiosk(
  token: string,
  input: { userId: string; pin: string },
): Promise<KioskSessionDTO> {
  const device = await resolveDeviceLink(token, 'kiosk');
  if (!device) throw new DomainError('NOT_FOUND', NOT_ACTIVE);
  if (!isUuid(input.userId) || !/^\d{4}$/.test(input.pin ?? ''))
    throw invalid('Pick your name and type your 4 digit PIN.');
  const people = await kioskPeople(device);
  const person = people.find((item) => item.id === input.userId);
  const outcome = await inTx(async (tx) => {
    const [locked] = await tx
      .select()
      .from(deviceLinks)
      .where(eq(deviceLinks.id, device.link.id))
      .for('update');
    const config = { ...(locked?.config ?? {}) };
    const fails = { ...((config.pinFails as Record<string, PinFails> | undefined) ?? {}) };
    const mine = fails[input.userId];
    const now = Date.now();
    if (mine?.until && Date.parse(mine.until) > now)
      return {
        ok: false as const,
        waitMinutes: Math.max(1, Math.ceil((Date.parse(mine.until) - now) / 60_000)),
        left: 0,
      };
    const [role] = person
      ? await tx
          .select({ hash: memberRoles.kioskPinHash })
          .from(memberRoles)
          .where(and(eq(memberRoles.orgId, device.link.orgId), eq(memberRoles.userId, input.userId)))
      : [];
    const good = Boolean(person) && verifyKioskPin(role?.hash ?? null, input.pin);
    if (good) {
      if (mine) {
        delete fails[input.userId];
        await tx
          .update(deviceLinks)
          .set({ config: { ...config, pinFails: fails } })
          .where(eq(deviceLinks.id, device.link.id));
      }
      return { ok: true as const };
    }
    const tries = (mine?.until ? 0 : (mine?.n ?? 0)) + 1;
    const lockNow = tries >= KIOSK_MAX_PIN_TRIES;
    fails[input.userId] = lockNow
      ? { n: 0, until: new Date(now + KIOSK_LOCK_MINUTES * 60_000).toISOString() }
      : { n: tries };
    await tx
      .update(deviceLinks)
      .set({ config: { ...config, pinFails: fails } })
      .where(eq(deviceLinks.id, device.link.id));
    return {
      ok: false as const,
      waitMinutes: lockNow ? KIOSK_LOCK_MINUTES : 0,
      left: KIOSK_MAX_PIN_TRIES - tries,
    };
  });
  if (!outcome.ok) {
    if (outcome.waitMinutes > 0)
      throw new DomainError(
        'RATE_LIMITED',
        `Too many wrong tries. This name is locked for ${outcome.waitMinutes} ${outcome.waitMinutes === 1 ? 'minute' : 'minutes'}.`,
      );
    throw forbidden(`That PIN is not right. ${outcome.left} ${outcome.left === 1 ? 'try' : 'tries'} left.`);
  }
  const expiresAt = Math.floor(Date.now() / 1000) + KIOSK_SESSION_HOURS * 3600;
  return {
    session: signSession(device.link.id, person!.id, expiresAt),
    expiresAt: new Date(expiresAt * 1000).toISOString(),
    person: { id: person!.id, name: person!.name },
    jobs: await kioskJobs(device),
  };
}

interface KioskActor {
  readonly device: ResolvedDevice;
  readonly ctx: DomainContext;
  readonly person: KioskPersonDTO;
}

async function requireKioskSession(token: string, session: string): Promise<KioskActor> {
  const device = await resolveDeviceLink(token, 'kiosk');
  if (!device) throw new DomainError('NOT_FOUND', NOT_ACTIVE);
  const userId = readKioskSession(session, device.link.id);
  const person = userId ? (await kioskPeople(device)).find((item) => item.id === userId) : undefined;
  if (!person)
    throw new DomainError('UNAUTHENTICATED', 'This tablet is locked. Pick your name and type your PIN.');
  return { device, ctx: deviceContext(device, person), person: { id: person.id, name: person.name } };
}

async function kioskJobs(device: ResolvedDevice): Promise<KioskJobDTO[]> {
  const today = todayInZone(device.site.timezone);
  const found = await db
    .select({
      job: jobs,
      clientName: clients.name,
      standardUph: jobStats.standardUph,
      unitsDone: jobStats.unitsGood,
    })
    .from(jobs)
    .innerJoin(clients, eq(clients.id, jobs.clientId))
    .leftJoin(jobStats, eq(jobStats.jobId, jobs.id))
    .where(
      and(
        eq(jobs.orgId, device.link.orgId),
        eq(jobs.siteId, device.site.id),
        isNull(jobs.deletedAt),
        eq(jobs.status, 'active'),
        sql`(${jobs.startDate} IS NULL OR ${jobs.startDate} <= ${today}::date)`,
      ),
    )
    .orderBy(asc(clients.name), asc(jobs.number));
  const todays = await rows<{ job_id: string; units: string; hours: string }>(
    db,
    sql`SELECT job_id, sum(units_good)::text AS units, sum(hours)::text AS hours FROM pulse.production_entries
         WHERE org_id = ${device.link.orgId} AND site_id = ${device.site.id} AND work_date = ${today}::date AND deleted_at IS NULL GROUP BY job_id`,
  );
  const byJob = new Map(todays.map((row) => [row.job_id, row]));
  return found.map(({ job, clientName, standardUph, unitsDone }) => {
    const crew = (job.usualCrew ?? []).reduce((total, line) => total + Number(line.headcount ?? 0), 0);
    return {
      jobId: job.id,
      jobNumber: job.number,
      jobName: job.name,
      clientName,
      unitLabel: job.unitLabel,
      targetUph: standardUph ?? job.standardUph ?? null,
      plannedUnits: job.plannedUnits,
      unitsDone: unitsDone ?? '0',
      todayUnits: byJob.get(job.id)?.units ?? '0',
      todayHours: byJob.get(job.id)?.hours ?? '0',
      usualPeople: crew > 0 ? crew : null,
    };
  });
}

/** The job cards of an unlocked tablet. */
export async function listKioskJobs(token: string, session: string): Promise<KioskJobDTO[]> {
  const actor = await requireKioskSession(token, session);
  return kioskJobs(actor.device);
}

export interface KioskProductionInput {
  /** A stable id made on the tablet for this one save. A retry sends the same one. */
  clientRef: string;
  jobId: string;
  /** Today or yesterday at the site. Left out: today. */
  workDate?: string | null;
  unitsGood: string;
  unitsScrap?: string;
  /** People. */
  headcount: string;
  /** Hours each person worked. Labor hours are people times hours each. */
  hoursEach: string;
  note?: string | null;
}

const fixed = (value: number, places: number): string => value.toFixed(places);

/**
 * Saves one tablet entry. A job has one row per day, shift and labor class, so a second entry for
 * the same job on the same day adds its units and labor hours to that row. The `clientRef` is
 * remembered on the row, and a retry with the same one changes nothing.
 */
export async function saveKioskProduction(
  token: string,
  session: string,
  input: KioskProductionInput,
): Promise<KioskSaveDTO> {
  const actor = await requireKioskSession(token, session);
  const { device, ctx } = actor;
  const ref = cleanText(input.clientRef);
  if (!ref || !/^[A-Za-z0-9_-]{8,64}$/.test(ref)) throw invalid('This entry has no valid id. Type it again.');
  const today = todayInZone(device.site.timezone);
  const workDate = input.workDate ?? today;
  if (workDate !== today && workDate !== addDays(today, -1))
    throw invalid('The floor tablet can log work for today or yesterday. Ask a manager to fix an older day.');
  const units = Number(input.unitsGood);
  const scrap = Number(input.unitsScrap ?? 0);
  const people = Number(input.headcount);
  const hoursEach = Number(input.hoursEach);
  if (![units, scrap, people, hoursEach].every((value) => Number.isFinite(value) && value >= 0))
    throw invalid('Type numbers of 0 or more.');
  if (units === 0 && scrap === 0 && people * hoursEach === 0)
    throw invalid('Type the units finished, or the people and hours.');
  if (hoursEach > 24) throw invalid('Hours each cannot be more than 24.', { hoursEach: 'More than a day.' });
  const addHours = Math.round(people * hoursEach * 100) / 100;
  const access = await requirePulse(ctx, 'production:log');

  return inTx(async (tx) => {
    const job = await getJobRow(ctx, input.jobId, tx);
    if (job.siteId !== device.site.id) throw forbidden('That job belongs to another site.');
    if (job.status === 'cancelled' || job.status === 'completed')
      throw invalid('That job is closed. Pick another job.');
    await assertCanLogDay(tx, ctx, access, device.site.id, device.site.timezone, workDate);
    await assertOpen(tx, ctx.orgId, [workDate]);
    const laborClassId = job.defaultLaborClassId ?? null;
    const key = and(
      eq(productionEntries.orgId, ctx.orgId),
      eq(productionEntries.jobId, job.id),
      eq(productionEntries.workDate, workDate),
      eq(productionEntries.shift, 'day'),
      laborClassId
        ? eq(productionEntries.laborClassId, laborClassId)
        : isNull(productionEntries.laborClassId),
      isNull(productionEntries.deletedAt),
    );
    const [existing] = await tx.select().from(productionEntries).where(key).for('update');
    const [applied] = await rows<{ id: string }>(
      tx,
      sql`SELECT id FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND job_id = ${job.id} AND (source_ref = ${`kiosk:${ref}`} OR meta -> 'kiosk_refs' ? ${ref}) LIMIT 1`,
    );
    const duplicate = Boolean(applied);
    if (!duplicate) {
      let rowId: string;
      if (existing) {
        const refs = Array.isArray(existing.meta?.kiosk_refs) ? (existing.meta.kiosk_refs as string[]) : [];
        const headcount = Math.max(Number(existing.headcount ?? 0), people);
        const note = cleanText(input.note);
        const [row] = await tx
          .update(productionEntries)
          .set({
            unitsGood: fixed(Number(existing.unitsGood) + units, 3),
            unitsScrap: fixed(Number(existing.unitsScrap) + scrap, 3),
            hours: fixed(Number(existing.hours) + addHours, 2),
            headcount: headcount > 0 ? fixed(headcount, 2) : existing.headcount,
            hoursConfirmed: existing.hoursConfirmed || addHours > 0,
            note: note ? [existing.note, note].filter(Boolean).join(' | ').slice(0, 1000) : existing.note,
            meta: { ...(existing.meta ?? {}), kiosk_refs: [...refs, ref].slice(-200) },
            version: sql`version + 1`,
            updatedBy: ctx.userId,
            updatedAt: new Date(),
          })
          .where(eq(productionEntries.id, existing.id))
          .returning();
        rowId = row!.id;
        await logActivity(tx, ctx, {
          verb: 'production.edited',
          entityType: 'production',
          entityId: rowId,
          jobId: job.id,
          clientId: job.clientId,
          before: { unitsGood: existing.unitsGood, hours: existing.hours, headcount: existing.headcount },
          after: { unitsGood: row!.unitsGood, hours: row!.hours, headcount: row!.headcount },
          meta: { workDate, via: 'kiosk', deviceLinkId: device.link.id },
        });
      } else {
        const [row] = await tx
          .insert(productionEntries)
          .values({
            orgId: ctx.orgId,
            jobId: job.id,
            siteId: device.site.id,
            workDate,
            shift: 'day',
            laborClassId,
            unitsGood: fixed(units, 3),
            unitsScrap: fixed(scrap, 3),
            headcount: people > 0 ? fixed(people, 2) : null,
            hours: fixed(addHours, 2),
            hoursConfirmed: true,
            note: cleanText(input.note),
            enteredBy: ctx.userId,
            source: 'manual',
            sourceRef: `kiosk:${ref}`,
            meta: { kiosk_refs: [ref] },
            createdBy: ctx.userId,
            updatedBy: ctx.userId,
          })
          .returning();
        rowId = row!.id;
        await logActivity(tx, ctx, {
          verb: 'production.logged',
          entityType: 'production',
          entityId: rowId,
          jobId: job.id,
          clientId: job.clientId,
          after: {
            workDate,
            shift: 'day',
            laborClassId,
            unitsGood: row!.unitsGood,
            unitsScrap: row!.unitsScrap,
            headcount: row!.headcount,
            hours: row!.hours,
          },
          meta: { via: 'kiosk', deviceLinkId: device.link.id },
        });
      }
      const touched = newTouched();
      touched.jobIds.add(job.id);
      touchDay(touched, device.site.id, workDate);
      await restampProduction(tx, ctx.orgId, sql`src.id = ${rowId}`);
      if (job.pricingModel === 'fixed') await restampFixedJob(tx, ctx, job.id);
      await finishWrite(tx, ctx, touched);
    }
    const [day] = await rows<{ units: string; hours: string; pace_hours: string }>(
      tx,
      sql`SELECT COALESCE(sum(units_good), 0)::text AS units, COALESCE(sum(hours), 0)::text AS hours, COALESCE(sum(hours - setup_hours) FILTER (WHERE hours_confirmed), 0)::text AS pace_hours
            FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND job_id = ${job.id} AND work_date = ${workDate}::date AND deleted_at IS NULL`,
    );
    const [stats] = await tx
      .select({ standardUph: jobStats.standardUph })
      .from(jobStats)
      .where(eq(jobStats.jobId, job.id));
    const uph = unitsPerHour(day?.units ?? '0', day?.pace_hours ?? '0');
    return {
      duplicate,
      jobId: job.id,
      workDate,
      todayUnits: day?.units ?? '0',
      todayHours: day?.hours ?? '0',
      uph: uph === null ? null : uph.toFixed(3),
      targetUph: stats?.standardUph ?? job.standardUph ?? null,
    };
  });
}

/* ---------------------------------------------------------------- my own PIN */

/**
 * Lets a person who may log production set or clear their own kiosk PIN. Admins set PINs for
 * other people with `setKioskPin` in `roles.ts`.
 */
export async function setMyKioskPin(
  ctx: DomainContext,
  pin: string | null,
): Promise<{ hasKioskPin: boolean }> {
  const access = await requirePulse(ctx, 'production:log');
  if (pin !== null && !/^\d{4}$/.test(pin))
    throw invalid('A kiosk PIN is 4 digits.', { pin: 'Type 4 digits.' });
  const salt = randomBytes(16);
  const hash = pin === null ? null : `${salt.toString('hex')}:${scryptSync(pin, salt, 32).toString('hex')}`;
  await inTx(async (tx) => {
    await tx
      .insert(memberRoles)
      .values({
        orgId: ctx.orgId,
        userId: ctx.userId,
        role: access.role,
        seesMoney: access.seesMoneySwitch,
        kioskPinHash: hash,
        updatedBy: ctx.userId,
      })
      .onConflictDoUpdate({
        target: [memberRoles.orgId, memberRoles.userId],
        set: { kioskPinHash: hash, updatedBy: ctx.userId, updatedAt: new Date() },
      });
    await logActivity(tx, ctx, {
      verb: 'role.changed',
      entityType: 'member_role',
      entityId: ctx.userId,
      meta: { kioskPin: pin === null ? 'cleared' : 'set', self: true },
    });
  });
  return { hasKioskPin: pin !== null };
}

/** Whether the signed in person has a kiosk PIN (the PIN itself is never readable). */
export async function myKioskPinState(
  ctx: DomainContext,
): Promise<{ hasKioskPin: boolean; canUseKiosk: boolean }> {
  const access = await requirePulse(ctx, 'pulse:read');
  const [row] = await db
    .select({ hash: memberRoles.kioskPinHash })
    .from(memberRoles)
    .where(and(eq(memberRoles.orgId, ctx.orgId), eq(memberRoles.userId, ctx.userId)));
  return { hasKioskPin: Boolean(row?.hash), canUseKiosk: canPulse(access.role, 'production:log') };
}
