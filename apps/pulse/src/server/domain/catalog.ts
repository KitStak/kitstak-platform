/**
 * Setup records: sites, clients, job types, items and extra services (VAS catalog).
 * Labor classes and rates live in labor.ts. Every write: permission check, one transaction,
 * one activity row. Parents are soft deleted, never hard deleted.
 */
import 'server-only';
import { and, asc, eq, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { clients, items, jobTypes, sites, vasServices } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import type { PartsOwnerValue, PricingModelValue, StreamSource, VasBilling } from '@/lib/constants';
import type { ClientDTO, ItemDTO, JobTypeDTO, SiteDTO, VasServiceDTO } from '@/lib/types';
import { assertVersion, cleanText, defined, diff, hideUnless, inTx, iso, isoRequired, isUuid, isValidTimezone, rows, todayInZone, type DomainContext } from './_shared';
import { codeFromName, freeCode, restoreRow, softDeleteRow } from './_crud';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { finishWrite, newTouched, restampUsage } from './recalc';
import { loadSettings } from './settings';

type Money = Pick<PulseAccess, 'seesMoney'>;
const bump = sql`version + 1`;

/* ---------------------------------------------------------------- sites */

type SiteRow = typeof sites.$inferSelect;
export function toSiteDTO(row: SiteRow): SiteDTO {
  return { id: row.id, code: row.code, name: row.name, timezone: row.timezone, isDefault: row.isDefault, wmsWarehouseId: row.wmsWarehouseId, archivedAt: iso(row.archivedAt), today: todayInZone(row.timezone) };
}

export async function listSites(ctx: DomainContext, executor: Executor = db): Promise<SiteDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  await loadSettings(ctx.orgId, executor);
  const found = await executor.select().from(sites).where(and(eq(sites.orgId, ctx.orgId), isNull(sites.deletedAt))).orderBy(sql`${sites.isDefault} desc`, asc(sites.name));
  return found.map(toSiteDTO);
}

export async function getSiteRow(ctx: DomainContext, siteId: string, executor: Executor = db): Promise<SiteRow> {
  const [row] = isUuid(siteId) ? await executor.select().from(sites).where(and(eq(sites.orgId, ctx.orgId), eq(sites.id, siteId), isNull(sites.deletedAt))) : [];
  if (!row) throw notFound('That site');
  return row;
}

/** The site to use when none is given: the person's pick when valid, else the default site. */
export async function resolveSite(ctx: DomainContext, siteId: string | null | undefined, executor: Executor = db): Promise<SiteRow> {
  await loadSettings(ctx.orgId, executor);
  if (siteId) return getSiteRow(ctx, siteId, executor);
  const found = await executor.select().from(sites).where(and(eq(sites.orgId, ctx.orgId), isNull(sites.deletedAt))).orderBy(sql`${sites.isDefault} desc`, asc(sites.createdAt)).limit(1);
  if (!found[0]) throw invalid('This workspace has no site yet. Add one in Settings.');
  return found[0];
}

export interface SiteInput {
  code?: string | null;
  name: string;
  timezone: string;
  isDefault?: boolean;
}

export async function createSite(ctx: DomainContext, input: SiteInput): Promise<SiteDTO> {
  await requirePulse(ctx, 'settings:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the site a name.', { name: 'Give the site a name.' });
  if (!isValidTimezone(input.timezone)) throw invalid('Pick a time zone from the list.', { timezone: 'Pick a time zone from the list.' });
  return inTx(async (tx) => {
    await loadSettings(ctx.orgId, tx);
    const code = await freeCode(tx, ctx.orgId, 'sites', cleanText(input.code) ?? codeFromName(name, 10));
    if (input.isDefault) await tx.update(sites).set({ isDefault: false }).where(and(eq(sites.orgId, ctx.orgId), eq(sites.isDefault, true)));
    const [row] = await tx.insert(sites).values({ orgId: ctx.orgId, code, name, timezone: input.timezone, isDefault: Boolean(input.isDefault) }).returning();
    await logActivity(tx, ctx, { verb: 'site.created', entityType: 'site', entityId: row!.id, after: { code, name, timezone: input.timezone } });
    return toSiteDTO(row!);
  });
}

export async function updateSite(ctx: DomainContext, siteId: string, patch: Partial<SiteInput> & { archived?: boolean }): Promise<SiteDTO> {
  await requirePulse(ctx, 'settings:manage');
  if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) throw invalid('Pick a time zone from the list.', { timezone: 'Pick a time zone from the list.' });
  return inTx(async (tx) => {
    const before = await getSiteRow(ctx, siteId, tx);
    if (patch.archived && before.isDefault) throw conflict('The default site cannot be archived. Make another site the default first.');
    if (patch.isDefault === true) await tx.update(sites).set({ isDefault: false }).where(and(eq(sites.orgId, ctx.orgId), eq(sites.isDefault, true)));
    if (patch.isDefault === false && before.isDefault) throw conflict('Pick another site as the default instead.');
    const values = defined({
      code: patch.code === undefined ? undefined : (cleanText(patch.code) ?? before.code),
      name: patch.name === undefined ? undefined : (cleanText(patch.name) ?? before.name),
      timezone: patch.timezone,
      isDefault: patch.isDefault,
      archivedAt: patch.archived === undefined ? undefined : patch.archived ? new Date() : null,
    });
    const [row] = await tx.update(sites).set({ ...values, updatedAt: new Date() }).where(eq(sites.id, before.id)).returning();
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (change) await logActivity(tx, ctx, { verb: 'site.updated', entityType: 'site', entityId: before.id, ...change });
    return toSiteDTO(row!);
  });
}

export async function deleteSite(ctx: DomainContext, siteId: string): Promise<void> {
  await requirePulse(ctx, 'settings:manage');
  await inTx(async (tx) => {
    const before = await getSiteRow(ctx, siteId, tx);
    if (before.isDefault) throw conflict('The default site cannot be deleted. Make another site the default first.');
    const [used] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND site_id = ${siteId} AND deleted_at IS NULL`);
    if ((used?.n ?? 0) > 0) throw conflict('This site still has jobs. Move or delete them first, or archive the site.');
    await softDeleteRow(tx, ctx.orgId, 'sites', siteId, 'That site');
    await logActivity(tx, ctx, { verb: 'site.deleted', entityType: 'site', entityId: siteId, before: { code: before.code, name: before.name } });
  });
}

/* ---------------------------------------------------------------- clients */

type ClientRow = typeof clients.$inferSelect;
export function toClientDTO(row: ClientRow, access: Money, counts?: { jobCount: number; openJobCount: number }): ClientDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    status: row.status as 'active' | 'inactive',
    contactName: row.contactName,
    contactEmail: row.contactEmail,
    phone: row.phone,
    targetMarginBp: hideUnless(access.seesMoney, row.targetMarginBp),
    paymentTermsDays: row.paymentTermsDays,
    partsOwner: row.partsOwner as PartsOwnerValue | null,
    notes: row.notes,
    color: row.color,
    coreCustomerId: row.coreCustomerId,
    crmAccountItemId: row.crmAccountItemId,
    source: row.source as StreamSource,
    isSample: row.isSample,
    version: row.version,
    ...(counts ?? {}),
    createdAt: isoRequired(row.createdAt),
    updatedAt: isoRequired(row.updatedAt),
    deletedAt: iso(row.deletedAt),
  };
}

export async function listClients(ctx: DomainContext, options: { q?: string | null; includeInactive?: boolean; includeDeleted?: boolean } = {}): Promise<ClientDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const q = cleanText(options.q)?.toLowerCase().replace(/[%_\\]/g, '');
  const found = await db
    .select()
    .from(clients)
    .where(
      and(
        eq(clients.orgId, ctx.orgId),
        options.includeDeleted ? undefined : isNull(clients.deletedAt),
        options.includeInactive === false ? eq(clients.status, 'active') : undefined,
        q ? sql`(lower(${clients.name}) like ${`%${q}%`} or lower(${clients.code}) like ${`${q}%`})` : undefined,
      ),
    )
    .orderBy(sql`lower(${clients.name})`);
  const counts = await rows<{ client_id: string; n: number; open: number }>(
    db,
    sql`SELECT client_id, count(*)::int AS n, count(*) FILTER (WHERE status IN ('active', 'on_hold'))::int AS open
          FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL GROUP BY client_id`,
  );
  const byClient = new Map(counts.map((row) => [row.client_id, row]));
  return found.map((row) => toClientDTO(row, access, { jobCount: byClient.get(row.id)?.n ?? 0, openJobCount: byClient.get(row.id)?.open ?? 0 }));
}

export async function getClientRow(ctx: DomainContext, clientId: string, executor: Executor = db, includeDeleted = false): Promise<ClientRow> {
  const [row] = isUuid(clientId) ? await executor.select().from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, clientId), includeDeleted ? undefined : isNull(clients.deletedAt))) : [];
  if (!row) throw notFound('That client');
  return row;
}

export async function getClient(ctx: DomainContext, clientId: string): Promise<ClientDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  return toClientDTO(await getClientRow(ctx, clientId, db, true), access);
}

/**
 * A client can be found three ways (SPEC 5.1): its Pulse id, the `core.customers` id (equal to
 * the WMS client id), or the CRM account item id. Returns null when nothing matches.
 */
export async function findClientByRef(ctx: DomainContext, ref: { pulseClientId?: string | null; coreCustomerId?: string | null; crmAccountItemId?: string | null }): Promise<ClientDTO | null> {
  const access = await requirePulse(ctx, 'pulse:read');
  const tries: [typeof clients.id | typeof clients.coreCustomerId | typeof clients.crmAccountItemId, string | null | undefined][] = [
    [clients.id, ref.pulseClientId],
    [clients.coreCustomerId, ref.coreCustomerId],
    [clients.crmAccountItemId, ref.crmAccountItemId],
  ];
  for (const [column, value] of tries) {
    if (!value || !isUuid(value)) continue;
    const [row] = await db.select().from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(column, value), isNull(clients.deletedAt)));
    if (row) return toClientDTO(row, access);
  }
  return null;
}

export interface ClientInput {
  code?: string | null;
  name: string;
  status?: 'active' | 'inactive';
  contactName?: string | null;
  contactEmail?: string | null;
  phone?: string | null;
  targetMarginBp?: number | null;
  paymentTermsDays?: number | null;
  partsOwner?: PartsOwnerValue | null;
  notes?: string | null;
  color?: string | null;
  coreCustomerId?: string | null;
  crmAccountItemId?: string | null;
  source?: StreamSource;
  sourceRef?: string | null;
  isSample?: boolean;
}

export async function insertClient(tx: Executor, ctx: DomainContext, input: ClientInput): Promise<ClientRow> {
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the client a name.', { name: 'Give the client a name.' });
  await loadSettings(ctx.orgId, tx);
  const wanted = cleanText(input.code);
  const code = wanted ?? (await freeCode(tx, ctx.orgId, 'clients', codeFromName(name)));
  const [row] = await tx
    .insert(clients)
    .values({
      orgId: ctx.orgId,
      code,
      name,
      status: input.status ?? 'active',
      contactName: cleanText(input.contactName),
      contactEmail: cleanText(input.contactEmail),
      phone: cleanText(input.phone),
      targetMarginBp: input.targetMarginBp ?? null,
      paymentTermsDays: input.paymentTermsDays ?? null,
      partsOwner: input.partsOwner ?? null,
      notes: cleanText(input.notes),
      color: input.color ?? null,
      coreCustomerId: input.coreCustomerId ?? null,
      crmAccountItemId: input.crmAccountItemId ?? null,
      source: input.source ?? 'manual',
      sourceRef: input.sourceRef ?? null,
      isSample: Boolean(input.isSample),
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  await logActivity(tx, ctx, { verb: 'client.created', entityType: 'client', entityId: row!.id, clientId: row!.id, after: { code, name } });
  return row!;
}

export async function createClient(ctx: DomainContext, input: ClientInput): Promise<ClientDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => toClientDTO(await insertClient(tx, ctx, input), access));
}

/** Finds a live client by exact name (no case), or makes one. Used by quick add and imports. */
export async function ensureClientByName(tx: Executor, ctx: DomainContext, name: string): Promise<ClientRow> {
  const clean = cleanText(name);
  if (!clean) throw invalid('Pick a client or type a new client name.', { clientName: 'Pick a client or type a new client name.' });
  const [found] = await tx.select().from(clients).where(and(eq(clients.orgId, ctx.orgId), isNull(clients.deletedAt), sql`(lower(${clients.name}) = ${clean.toLowerCase()} or lower(${clients.code}) = ${clean.toLowerCase()})`)).limit(1);
  return found ?? insertClient(tx, ctx, { name: clean });
}

export async function updateClient(ctx: DomainContext, clientId: string, patch: Partial<ClientInput>, version?: number | null): Promise<ClientDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const before = await getClientRow(ctx, clientId, tx);
    assertVersion(before.version, version);
    const values = defined({
      code: patch.code === undefined ? undefined : (cleanText(patch.code) ?? before.code),
      name: patch.name === undefined ? undefined : (cleanText(patch.name) ?? before.name),
      status: patch.status,
      contactName: patch.contactName === undefined ? undefined : cleanText(patch.contactName),
      contactEmail: patch.contactEmail === undefined ? undefined : cleanText(patch.contactEmail),
      phone: patch.phone === undefined ? undefined : cleanText(patch.phone),
      targetMarginBp: patch.targetMarginBp,
      paymentTermsDays: patch.paymentTermsDays,
      partsOwner: patch.partsOwner,
      notes: patch.notes === undefined ? undefined : cleanText(patch.notes),
      color: patch.color,
      coreCustomerId: patch.coreCustomerId,
      crmAccountItemId: patch.crmAccountItemId,
    });
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return toClientDTO(before, access);
    const [row] = await tx.update(clients).set({ ...values, version: bump, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(clients.id, before.id)).returning();
    await logActivity(tx, ctx, { verb: 'client.updated', entityType: 'client', entityId: before.id, clientId: before.id, ...change });
    if ('partsOwner' in change.after || 'targetMarginBp' in change.after) {
      // Parts owner feeds usage stamps; target margin feeds risk. Both touch every job of the client.
      const jobs = await rows<{ id: string; site_id: string }>(tx, sql`SELECT id, site_id FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND client_id = ${before.id}`);
      if ('partsOwner' in change.after) await restampUsage(tx, ctx.orgId, sql`j.client_id = ${before.id}`);
      const touched = newTouched();
      for (const job of jobs) touched.jobIds.add(job.id);
      await finishWrite(tx, ctx, touched);
    }
    return toClientDTO(row!, access);
  });
}

export async function deleteClient(ctx: DomainContext, clientId: string): Promise<void> {
  await requirePulse(ctx, 'job:manage');
  await inTx(async (tx) => {
    const before = await getClientRow(ctx, clientId, tx);
    const [used] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND client_id = ${clientId} AND deleted_at IS NULL`);
    if ((used?.n ?? 0) > 0) throw conflict('This client has jobs. Delete the jobs first, or mark the client inactive.');
    await softDeleteRow(tx, ctx.orgId, 'clients', clientId, 'That client');
    await logActivity(tx, ctx, { verb: 'client.deleted', entityType: 'client', entityId: clientId, clientId, before: { code: before.code, name: before.name } });
  });
}

export async function restoreClient(ctx: DomainContext, clientId: string): Promise<ClientDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    await restoreRow(tx, ctx.orgId, 'clients', clientId, 'That client');
    await logActivity(tx, ctx, { verb: 'client.restored', entityType: 'client', entityId: clientId, clientId });
    return toClientDTO(await getClientRow(ctx, clientId, tx), access);
  });
}

/* ---------------------------------------------------------------- job types */

type JobTypeRow = typeof jobTypes.$inferSelect;
export function toJobTypeDTO(row: JobTypeRow, access: Money): JobTypeDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unitLabel: row.unitLabel,
    defaultPricingModel: row.defaultPricingModel as PricingModelValue,
    defaultLaborClassId: row.defaultLaborClassId,
    defaultStandardUph: row.defaultStandardUph,
    targetMarginBp: hideUnless(access.seesMoney, row.targetMarginBp),
    color: row.color,
    icon: row.icon,
    position: row.position,
    isBuiltin: row.isBuiltin,
    archivedAt: iso(row.archivedAt),
  };
}

export async function listJobTypes(ctx: DomainContext, options: { includeArchived?: boolean } = {}): Promise<JobTypeDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  await loadSettings(ctx.orgId);
  const found = await db
    .select()
    .from(jobTypes)
    .where(and(eq(jobTypes.orgId, ctx.orgId), isNull(jobTypes.deletedAt), options.includeArchived ? undefined : isNull(jobTypes.archivedAt)))
    .orderBy(asc(jobTypes.position), sql`lower(${jobTypes.name})`);
  return found.map((row) => toJobTypeDTO(row, access));
}

export async function getJobTypeRow(ctx: DomainContext, jobTypeId: string, executor: Executor = db): Promise<JobTypeRow> {
  const [row] = isUuid(jobTypeId) ? await executor.select().from(jobTypes).where(and(eq(jobTypes.orgId, ctx.orgId), eq(jobTypes.id, jobTypeId), isNull(jobTypes.deletedAt))) : [];
  if (!row) throw notFound('That job type');
  return row;
}

export interface JobTypeInput {
  code?: string | null;
  name: string;
  unitLabel?: string;
  defaultPricingModel?: PricingModelValue;
  defaultLaborClassId?: string | null;
  defaultStandardUph?: string | null;
  targetMarginBp?: number | null;
  color?: string | null;
  icon?: string | null;
  position?: number;
}

export async function insertJobType(tx: Executor, ctx: DomainContext, input: JobTypeInput): Promise<JobTypeRow> {
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the job type a name.', { name: 'Give the job type a name.' });
  await loadSettings(ctx.orgId, tx);
  const code = cleanText(input.code) ?? (await freeCode(tx, ctx.orgId, 'job_types', codeFromName(name)));
  const [row] = await tx
    .insert(jobTypes)
    .values({
      orgId: ctx.orgId,
      code,
      name,
      unitLabel: cleanText(input.unitLabel) ?? 'units',
      defaultPricingModel: input.defaultPricingModel ?? 'per_unit',
      defaultLaborClassId: input.defaultLaborClassId ?? null,
      defaultStandardUph: input.defaultStandardUph ?? null,
      targetMarginBp: input.targetMarginBp ?? null,
      color: input.color ?? null,
      icon: input.icon ?? null,
      position: input.position ?? 0,
    })
    .returning();
  await logActivity(tx, ctx, { verb: 'job_type.created', entityType: 'job_type', entityId: row!.id, after: { code, name } });
  return row!;
}

export async function createJobType(ctx: DomainContext, input: JobTypeInput): Promise<JobTypeDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => toJobTypeDTO(await insertJobType(tx, ctx, input), access));
}

export async function updateJobType(ctx: DomainContext, jobTypeId: string, patch: Partial<JobTypeInput> & { archived?: boolean }): Promise<JobTypeDTO> {
  const access = await requirePulse(ctx, 'job:manage');
  return inTx(async (tx) => {
    const before = await getJobTypeRow(ctx, jobTypeId, tx);
    if (patch.archived && before.isBuiltin) throw conflict('The General job type is built in and cannot be archived.');
    const values = defined({
      code: patch.code === undefined || before.isBuiltin ? undefined : (cleanText(patch.code) ?? before.code),
      name: patch.name === undefined ? undefined : (cleanText(patch.name) ?? before.name),
      unitLabel: patch.unitLabel === undefined ? undefined : (cleanText(patch.unitLabel) ?? 'units'),
      defaultPricingModel: patch.defaultPricingModel,
      defaultLaborClassId: patch.defaultLaborClassId,
      defaultStandardUph: patch.defaultStandardUph,
      targetMarginBp: patch.targetMarginBp,
      color: patch.color,
      icon: patch.icon,
      position: patch.position,
      archivedAt: patch.archived === undefined ? undefined : patch.archived ? new Date() : null,
    });
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return toJobTypeDTO(before, access);
    const [row] = await tx.update(jobTypes).set({ ...values, updatedAt: new Date() }).where(eq(jobTypes.id, before.id)).returning();
    await logActivity(tx, ctx, { verb: 'job_type.updated', entityType: 'job_type', entityId: before.id, ...change });
    if ('targetMarginBp' in change.after || 'defaultStandardUph' in change.after) {
      const jobs = await rows<{ id: string }>(tx, sql`SELECT id FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND job_type_id = ${before.id}`);
      const touched = newTouched();
      for (const job of jobs) touched.jobIds.add(job.id);
      await finishWrite(tx, ctx, touched);
    }
    return toJobTypeDTO(row!, access);
  });
}

export async function deleteJobType(ctx: DomainContext, jobTypeId: string): Promise<void> {
  await requirePulse(ctx, 'job:manage');
  await inTx(async (tx) => {
    const before = await getJobTypeRow(ctx, jobTypeId, tx);
    if (before.isBuiltin) throw conflict('The General job type is built in and cannot be deleted.');
    const [used] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM pulse.jobs WHERE org_id = ${ctx.orgId} AND job_type_id = ${jobTypeId} AND deleted_at IS NULL`);
    if ((used?.n ?? 0) > 0) throw conflict('Jobs still use this job type. Archive it instead, or move the jobs to another type.');
    await softDeleteRow(tx, ctx.orgId, 'job_types', jobTypeId, 'That job type');
    await logActivity(tx, ctx, { verb: 'job_type.deleted', entityType: 'job_type', entityId: jobTypeId, before: { code: before.code, name: before.name } });
  });
}

/* ---------------------------------------------------------------- items */

type ItemRow = typeof items.$inferSelect;
export function toItemDTO(row: ItemRow, access: Money): ItemDTO {
  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    uom: row.uom,
    unitCost: hideUnless(access.seesMoney, row.unitCost),
    suppliedBy: row.suppliedBy as PartsOwnerValue | null,
    clientId: row.clientId,
    wmsProductId: row.wmsProductId,
    version: row.version,
    moneyHidden: !access.seesMoney,
  };
}

export async function listItems(ctx: DomainContext, options: { q?: string | null; clientId?: string | null; limit?: number } = {}): Promise<ItemDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const q = cleanText(options.q)?.toLowerCase().replace(/[%_\\]/g, '');
  const found = await db
    .select()
    .from(items)
    .where(
      and(
        eq(items.orgId, ctx.orgId),
        isNull(items.deletedAt),
        options.clientId ? sql`(${items.clientId} = ${options.clientId} or ${items.clientId} is null)` : undefined,
        q ? sql`(lower(${items.sku}) like ${`${q}%`} or lower(${items.name}) like ${`%${q}%`})` : undefined,
      ),
    )
    .orderBy(sql`lower(${items.sku})`)
    .limit(Math.min(options.limit ?? 500, 2000));
  return found.map((row) => toItemDTO(row, access));
}

export interface ItemInput {
  sku: string;
  name: string;
  uom?: string;
  unitCost?: string;
  suppliedBy?: PartsOwnerValue | null;
  clientId?: string | null;
}

export async function getItemRow(ctx: DomainContext, itemId: string, executor: Executor = db): Promise<ItemRow> {
  const [row] = isUuid(itemId) ? await executor.select().from(items).where(and(eq(items.orgId, ctx.orgId), eq(items.id, itemId), isNull(items.deletedAt))) : [];
  if (!row) throw notFound('That item');
  return row;
}

export async function insertItem(tx: Executor, ctx: DomainContext, input: ItemInput): Promise<ItemRow> {
  const sku = cleanText(input.sku);
  const name = cleanText(input.name) ?? sku;
  if (!sku || !name) throw invalid('Give the item a SKU.', { sku: 'Give the item a SKU.' });
  const [row] = await tx
    .insert(items)
    .values({ orgId: ctx.orgId, sku, name, uom: cleanText(input.uom) ?? 'each', unitCost: input.unitCost ?? '0', costUpdatedAt: new Date(), suppliedBy: input.suppliedBy ?? null, clientId: input.clientId ?? null, createdBy: ctx.userId, updatedBy: ctx.userId })
    .returning();
  await logActivity(tx, ctx, { verb: 'item.created', entityType: 'item', entityId: row!.id, after: { sku, name } });
  return row!;
}

export async function createItem(ctx: DomainContext, input: ItemInput): Promise<ItemDTO> {
  const access = await requirePulse(ctx, 'cost:manage');
  return inTx(async (tx) => toItemDTO(await insertItem(tx, ctx, input), access));
}

export async function updateItem(ctx: DomainContext, itemId: string, patch: Partial<ItemInput>, version?: number | null): Promise<ItemDTO> {
  const access = await requirePulse(ctx, 'cost:manage');
  return inTx(async (tx) => {
    const before = await getItemRow(ctx, itemId, tx);
    assertVersion(before.version, version);
    const values = defined({
      sku: patch.sku === undefined ? undefined : (cleanText(patch.sku) ?? before.sku),
      name: patch.name === undefined ? undefined : (cleanText(patch.name) ?? before.name),
      uom: patch.uom === undefined ? undefined : (cleanText(patch.uom) ?? 'each'),
      unitCost: patch.unitCost,
      suppliedBy: patch.suppliedBy,
      clientId: patch.clientId,
    });
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return toItemDTO(before, access);
    const [row] = await tx
      .update(items)
      .set({ ...values, ...('unitCost' in change.after ? { costUpdatedAt: new Date() } : {}), version: bump, updatedBy: ctx.userId, updatedAt: new Date() })
      .where(eq(items.id, before.id))
      .returning();
    await logActivity(tx, ctx, { verb: 'item.updated', entityType: 'item', entityId: before.id, ...change });
    if ('suppliedBy' in change.after) {
      // Who buys the part changed: open usage rows that inherit it are restamped (SPEC 4.17).
      await restampUsage(tx, ctx.orgId, sql`src.item_id = ${before.id}`);
      const used = await rows<{ job_id: string; site_id: string; d: string }>(tx, sql`SELECT DISTINCT job_id, site_id, to_char(usage_date, 'YYYY-MM-DD') AS d FROM pulse.material_usage WHERE org_id = ${ctx.orgId} AND item_id = ${before.id} AND deleted_at IS NULL`);
      const touched = newTouched();
      for (const use of used) {
        touched.jobIds.add(use.job_id);
      }
      await finishWrite(tx, ctx, touched);
    }
    return toItemDTO(row!, access);
  });
}

export async function deleteItem(ctx: DomainContext, itemId: string): Promise<void> {
  await requirePulse(ctx, 'cost:manage');
  await inTx(async (tx) => {
    const before = await getItemRow(ctx, itemId, tx);
    await softDeleteRow(tx, ctx.orgId, 'items', itemId, 'That item');
    await logActivity(tx, ctx, { verb: 'item.deleted', entityType: 'item', entityId: itemId, before: { sku: before.sku, name: before.name } });
  });
}

/* ---------------------------------------------------------------- extra services (VAS catalog) */

type ServiceRow = typeof vasServices.$inferSelect;
export function toVasServiceDTO(row: ServiceRow, access: Money): VasServiceDTO {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    unitLabel: row.unitLabel,
    billing: row.billing as VasBilling,
    defaultPrice: hideUnless(access.seesMoney, row.defaultPrice),
    defaultCostPerUnit: hideUnless(access.seesMoney, row.defaultCostPerUnit),
    standardUph: row.standardUph,
    defaultLaborClassId: row.defaultLaborClassId,
    wmsVasTypeId: row.wmsVasTypeId,
    color: row.color,
    active: row.active,
    version: row.version,
    moneyHidden: !access.seesMoney,
  };
}

export async function listVasServices(ctx: DomainContext, options: { includeInactive?: boolean } = {}): Promise<VasServiceDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const found = await db
    .select()
    .from(vasServices)
    .where(and(eq(vasServices.orgId, ctx.orgId), isNull(vasServices.deletedAt), options.includeInactive ? undefined : eq(vasServices.active, true)))
    .orderBy(sql`lower(${vasServices.name})`);
  return found.map((row) => toVasServiceDTO(row, access));
}

export async function getVasServiceRow(ctx: DomainContext, serviceId: string, executor: Executor = db): Promise<ServiceRow> {
  const [row] = isUuid(serviceId) ? await executor.select().from(vasServices).where(and(eq(vasServices.orgId, ctx.orgId), eq(vasServices.id, serviceId), isNull(vasServices.deletedAt))) : [];
  if (!row) throw notFound('That service');
  return row;
}

export async function getVasService(ctx: DomainContext, serviceId: string): Promise<VasServiceDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  return toVasServiceDTO(await getVasServiceRow(ctx, serviceId), access);
}

export interface VasServiceInput {
  code?: string | null;
  name: string;
  unitLabel?: string;
  billing?: VasBilling;
  defaultPrice?: string | null;
  defaultCostPerUnit?: string | null;
  standardUph?: string | null;
  defaultLaborClassId?: string | null;
  color?: string | null;
  active?: boolean;
}

export async function insertVasService(tx: Executor, ctx: DomainContext, input: VasServiceInput): Promise<ServiceRow> {
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the service a name.', { name: 'Give the service a name.' });
  const code = cleanText(input.code) ?? (await freeCode(tx, ctx.orgId, 'vas_services', codeFromName(name)));
  const [row] = await tx
    .insert(vasServices)
    .values({
      orgId: ctx.orgId,
      code,
      name,
      unitLabel: cleanText(input.unitLabel) ?? 'units',
      billing: input.billing ?? 'per_unit',
      defaultPrice: input.defaultPrice ?? null,
      defaultCostPerUnit: input.defaultCostPerUnit ?? null,
      standardUph: input.standardUph ?? null,
      defaultLaborClassId: input.defaultLaborClassId ?? null,
      color: input.color ?? null,
      active: input.active ?? true,
      createdBy: ctx.userId,
      updatedBy: ctx.userId,
    })
    .returning();
  await logActivity(tx, ctx, { verb: 'service.created', entityType: 'service', entityId: row!.id, after: { code, name } });
  return row!;
}

export async function createVasService(ctx: DomainContext, input: VasServiceInput): Promise<VasServiceDTO> {
  const access = await requirePulse(ctx, 'vas:manage');
  return inTx(async (tx) => toVasServiceDTO(await insertVasService(tx, ctx, input), access));
}

export async function updateVasService(ctx: DomainContext, serviceId: string, patch: Partial<VasServiceInput>, version?: number | null): Promise<VasServiceDTO> {
  const access = await requirePulse(ctx, 'vas:manage');
  return inTx(async (tx) => {
    const before = await getVasServiceRow(ctx, serviceId, tx);
    assertVersion(before.version, version);
    const values = defined({
      code: patch.code === undefined ? undefined : (cleanText(patch.code) ?? before.code),
      name: patch.name === undefined ? undefined : (cleanText(patch.name) ?? before.name),
      unitLabel: patch.unitLabel === undefined ? undefined : (cleanText(patch.unitLabel) ?? 'units'),
      billing: patch.billing,
      defaultPrice: patch.defaultPrice,
      defaultCostPerUnit: patch.defaultCostPerUnit,
      standardUph: patch.standardUph,
      defaultLaborClassId: patch.defaultLaborClassId,
      color: patch.color,
      active: patch.active,
    });
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return toVasServiceDTO(before, access);
    const [row] = await tx.update(vasServices).set({ ...values, version: bump, updatedBy: ctx.userId, updatedAt: new Date() }).where(eq(vasServices.id, before.id)).returning();
    await logActivity(tx, ctx, { verb: 'service.updated', entityType: 'service', entityId: before.id, ...change });
    return toVasServiceDTO(row!, access);
  });
}

export async function deleteVasService(ctx: DomainContext, serviceId: string): Promise<void> {
  await requirePulse(ctx, 'vas:manage');
  await inTx(async (tx) => {
    const before = await getVasServiceRow(ctx, serviceId, tx);
    const [used] = await rows<{ n: number }>(tx, sql`SELECT count(*)::int AS n FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND vas_service_id = ${serviceId} AND deleted_at IS NULL`);
    if ((used?.n ?? 0) > 0) throw conflict('This service has entries. Turn it off instead, so its history stays.');
    await softDeleteRow(tx, ctx.orgId, 'vas_services', serviceId, 'That service');
    await logActivity(tx, ctx, { verb: 'service.deleted', entityType: 'service', entityId: serviceId, before: { code: before.code, name: before.name } });
  });
}

/** Brings a deleted extra service back (the Undo of a delete). Added by the profit team. */
export async function restoreVasService(ctx: DomainContext, serviceId: string): Promise<VasServiceDTO> {
  const access = await requirePulse(ctx, 'vas:manage');
  return inTx(async (tx) => {
    await restoreRow(tx, ctx.orgId, 'vas_services', serviceId, 'That service');
    await logActivity(tx, ctx, { verb: 'service.restored', entityType: 'service', entityId: serviceId });
    return toVasServiceDTO(await getVasServiceRow(ctx, serviceId, tx), access);
  });
}
