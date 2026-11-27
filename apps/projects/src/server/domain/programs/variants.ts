/**
 * Variants and attributes (docs/programs/SPEC.md D7, 4.2 `variants.ts`). Variants are the
 * program's kits; attributes are the axes the generator multiplies. Variant rates live on the
 * price card (A3): rates typed with new variants go to the pending draft (4.4.3).
 */
import 'server-only';
import { randomUUID } from 'node:crypto';
import { and, asc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { linkRecords, listRecordLinks, unlinkRecords } from '@kitstak/db/record-links';
import { findConflicts, conflictMessage, VARIANT_KEY_RULE } from '@kitstak/programs-engine/variants';
import { resolveUnitPrice, describeRateRule } from '@kitstak/programs-engine/price';
import { firstDayOfMonth, lastDayOfMonth, monthOf } from '@kitstak/programs-engine/calendar';
import { db, type Executor } from '@/server/db';
import { builds, programAttributes, programVariants, type ProgramAttribute, type ProgramVariant } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { MAX_ATTRIBUTE_VALUES, MAX_PROGRAM_ATTRIBUTES } from '@/lib/constants';
import { rankAfter, ranksBetween } from '@/lib/rank';
import type { AttributeAxisInput, AttributeDTO, VariantDTO } from '@/lib/program-types';
import type { DomainContext } from '../_shared';
import { logActivity } from '../activity';
import { centsOut, shared, todayInZone, versionConflict } from './_program';
import { requireProgram, type ProgramAccess } from './access';
import { versionsFor } from './pricing';

const QTY = /^\d{1,8}(\.\d{1,3})?$/;

export interface VariantRowInput {
  readonly name: string;
  readonly key: string;
  readonly sku?: string | null;
  readonly attributes?: Readonly<Record<string, string>>;
  readonly defaultQty?: string | null;
  readonly packQty?: string | null;
  readonly stdMinutesPerUnit?: string | null;
  readonly materialCostPerUnit?: string | null;
  readonly color?: string | null;
  readonly coreItemId?: string | null;
  /** A rate for the pending draft (4.4.3). */
  readonly unitPrice?: string | null;
}

export function toAttributeDTO(row: ProgramAttribute): AttributeDTO {
  return { id: row.id, name: row.name, values: row.values.map((value) => ({ id: value.id, label: value.label, code: value.code, color: value.color })), position: row.position, version: row.version };
}

export async function listAttributes(ctx: DomainContext, key: string): Promise<AttributeDTO[]> {
  const { program } = await requireProgram(ctx, key);
  const rows = await db.select().from(programAttributes).where(and(eq(programAttributes.programId, program.id), isNull(programAttributes.deletedAt))).orderBy(sql`${programAttributes.position} COLLATE "C"`);
  return rows.map(toAttributeDTO);
}

/** Variant DTOs with this month's units and revenue and the rate in force today. */
export async function variantDTOs(executor: Executor, ctx: DomainContext, access: Pick<ProgramAccess, 'program' | 'settings' | 'caps'>, rows: readonly ProgramVariant[]): Promise<VariantDTO[]> {
  if (rows.length === 0) return [];
  const hidden = !access.caps.seesMoney;
  const today = todayInZone(access.settings.timezone);
  const month = monthOf(today);
  const [versions, attributes, stats] = await Promise.all([
    versionsFor(executor, ctx, access.program.id),
    executor.select().from(programAttributes).where(and(eq(programAttributes.programId, access.program.id), isNull(programAttributes.deletedAt))),
    executor.execute(
      sql`select variant_id::text as variant_id, coalesce(sum(qty), 0)::text as units, coalesce(sum(revenue_cents), 0)::text as cents
            from pm.build_output where program_id = ${access.program.id}::uuid and deleted_at is null
             and work_date between ${firstDayOfMonth(month)}::date and ${lastDayOfMonth(month)}::date group by 1`,
    ),
  ]);
  const statBy = new Map((stats as unknown as { rows: { variant_id: string; units: string; cents: string }[] }).rows.map((row) => [row.variant_id, row]));
  const kitTitles = new Map<string, { sku: string | null; name: string }>();
  const kitIds = rows.flatMap((row) => [row.coreItemId, row.wmsProductId]).filter((id): id is string => Boolean(id));
  if (kitIds.length > 0) {
    const edges = await Promise.all(rows.map((row) => listRecordLinks(shared(executor), ctx.orgId, { type: 'pm_variant', id: row.id }, { relation: 'uses_kit' }).catch(() => [])));
    for (const list of edges) for (const edge of list) kitTitles.set(`${edge.to.type}:${edge.to.id}`, { sku: (edge.meta?.sku as string | undefined) ?? null, name: edge.cachedTitle ?? edge.to.id });
  }
  return rows.map((row) => {
    let currentRate: VariantDTO['currentRate'] = null;
    if (!hidden) {
      const price = resolveUnitPrice({ workDate: today, variantId: row.id, buildOverride: null, versions });
      const version = versions.find((v) => v.id === price.versionId);
      const line = version?.lines.find((l) => l.id === price.lineId);
      const rule = line?.ruleId ? version?.rules.find((r) => r.id === line.ruleId) : null;
      let ruleText: string | null = null;
      if (rule) {
        const attribute = attributes.find((a) => a.id === rule.attributeId);
        const value = attribute?.values.find((v) => v.id === rule.valueId);
        ruleText = describeRateRule(rule, attribute?.name ?? 'Attribute', value?.label ?? 'value');
      }
      currentRate = { unitPrice: price.unitPrice, source: price.source === 'variant' ? 'variant' : price.source === 'card' ? 'card' : 'none', ruleText };
    }
    const stat = statBy.get(row.id);
    const core = row.coreItemId ? kitTitles.get(`core_item:${row.coreItemId}`) : null;
    const wms = row.wmsProductId ? kitTitles.get(`wms_product:${row.wmsProductId}`) : null;
    return {
      id: row.id,
      key: row.key,
      name: row.name,
      sku: row.sku,
      attributes: row.attributes,
      defaultQty: row.defaultQty,
      packQty: row.packQty,
      stdMinutesPerUnit: row.stdMinutesPerUnit,
      materialCostPerUnit: hidden ? null : row.materialCostPerUnit,
      color: row.color,
      position: row.position,
      status: row.status,
      coreItem: row.coreItemId ? { id: row.coreItemId, sku: core?.sku ?? null, name: core?.name ?? 'Linked item' } : null,
      wmsProduct: row.wmsProductId ? { id: row.wmsProductId, sku: wms?.sku ?? null, name: wms?.name ?? 'Linked kit' } : null,
      currentRate,
      monthUnits: stat?.units ?? '0.000',
      monthRevenueCents: centsOut(stat?.cents ?? '0', hidden),
      version: row.version,
    };
  });
}

export async function listVariants(ctx: DomainContext, key: string, options: { readonly includeRetired?: boolean } = {}): Promise<VariantDTO[]> {
  const access = await requireProgram(ctx, key);
  const conditions = [eq(programVariants.programId, access.program.id), isNull(programVariants.deletedAt)];
  if (!options.includeRetired) conditions.push(eq(programVariants.status, 'active'));
  const rows = await db.select().from(programVariants).where(and(...conditions)).orderBy(sql`${programVariants.position} COLLATE "C"`, asc(programVariants.name));
  return variantDTOs(db, ctx, access, rows);
}

function cleanKey(key: string): string {
  return key.trim().toUpperCase();
}

function assertVariantRow(row: VariantRowInput, index: number): void {
  const where = { [`rows.${index}.name`]: 'Give the variant a name.' };
  if (!row.name.trim()) throw invalid('Give every variant a name.', where);
  if (row.name.trim().length > 80) throw invalid('Variant names can be up to 80 characters.', { [`rows.${index}.name`]: 'Too long.' });
  if (!VARIANT_KEY_RULE.test(cleanKey(row.key))) throw invalid('Use up to 16 letters, numbers or dashes for the variant key.', { [`rows.${index}.key`]: 'Use up to 16 letters, numbers or dashes.' });
  for (const field of ['defaultQty', 'packQty'] as const) {
    const value = row[field];
    if (value && !QTY.test(value)) throw invalid('Use a number with up to 3 decimals.', { [`rows.${index}.${field}`]: 'Use a number with up to 3 decimals.' });
  }
}

/** Inserts variants in `tx` (wizard, generator, pasted list). Returns the rows in input order. */
export async function insertVariants(tx: Executor, ctx: DomainContext, programId: string, rows: readonly VariantRowInput[]): Promise<ProgramVariant[]> {
  if (rows.length === 0) return [];
  rows.forEach(assertVariantRow);
  const existing = await tx.select().from(programVariants).where(and(eq(programVariants.programId, programId), isNull(programVariants.deletedAt)));
  const conflicts = findConflicts(
    rows.map((row, index) => ({ comboKey: String(index), attributes: row.attributes ?? { row: String(index) }, name: row.name.trim(), key: cleanKey(row.key), sku: row.sku?.trim() || null })),
    existing.map((row) => ({ key: row.key, name: row.name, sku: row.sku, attributes: Object.keys(row.attributes).length ? row.attributes : { id: row.id } })),
  );
  if (conflicts.length > 0) {
    const first = conflicts[0]!;
    throw invalid(conflictMessage(first), { [`rows.${first.comboKey}`]: conflictMessage(first) });
  }
  const [last] = await tx.select({ position: programVariants.position }).from(programVariants).where(eq(programVariants.programId, programId)).orderBy(sql`${programVariants.position} COLLATE "C" desc`).limit(1);
  let position = last?.position ?? null;
  const values = rows.map((row) => {
    position = rankAfter(position);
    return {
      orgId: ctx.orgId,
      programId,
      key: cleanKey(row.key),
      name: row.name.trim(),
      attributes: { ...(row.attributes ?? {}) },
      sku: row.sku?.trim() || null,
      defaultQty: row.defaultQty || null,
      packQty: row.packQty || null,
      stdMinutesPerUnit: row.stdMinutesPerUnit || null,
      materialCostPerUnit: row.materialCostPerUnit || null,
      color: row.color ?? null,
      coreItemId: row.coreItemId ?? null,
      position,
      createdBy: ctx.actorKind === 'user' ? ctx.userId : null,
    };
  });
  const inserted = await tx.insert(programVariants).values(values).returning();
  for (const variant of inserted) {
    if (variant.coreItemId) {
      await linkRecords(shared(tx), { orgId: ctx.orgId, from: { type: 'pm_variant', id: variant.id }, to: { type: 'core_item', id: variant.coreItemId }, relation: 'uses_kit', createdBy: ctx.userId }).catch(() => undefined);
    }
  }
  return inserted;
}

export async function createVariants(ctx: DomainContext, key: string, rows: readonly VariantRowInput[]): Promise<VariantDTO[]> {
  const access = await requireProgram(ctx, key, 'project:update');
  const today = todayInZone(access.settings.timezone);
  const created = await db.transaction(async (tx) => {
    const inserted = await insertVariants(tx, ctx, access.program.id, rows);
    const rated = inserted.map((variant, index) => ({ variant, price: rows[index]?.unitPrice ?? null })).filter((row) => row.price);
    if (rated.length > 0) {
      if (!access.caps.canPropose) throw invalid('Only people who can propose prices can set rates.');
      const { setVariantRatesIn } = await import('./price-cards');
      await setVariantRatesIn(tx, ctx, access, rated.map((row) => ({ variantId: row.variant.id, unitPrice: row.price })), today);
    }
    await logActivity(tx, ctx, { verb: 'variant.created', entityType: 'project', entityId: access.program.id, projectId: access.program.id, after: { count: inserted.length, names: inserted.slice(0, 10).map((v) => v.name) } });
    return inserted;
  });
  return variantDTOs(db, ctx, access, created);
}

export interface VariantPatch {
  readonly name?: string;
  readonly key?: string;
  readonly sku?: string | null;
  readonly defaultQty?: string | null;
  readonly packQty?: string | null;
  readonly stdMinutesPerUnit?: string | null;
  readonly materialCostPerUnit?: string | null;
  readonly color?: string | null;
  readonly attributes?: Readonly<Record<string, string>>;
}

async function loadVariant(ctx: DomainContext, id: string, action: 'project:read' | 'project:update' = 'project:update') {
  const [row] = await db.select().from(programVariants).where(and(eq(programVariants.id, id), eq(programVariants.orgId, ctx.orgId), isNull(programVariants.deletedAt)));
  if (!row) throw notFound('That variant');
  const access = await requireProgram(ctx, { id: row.programId }, action);
  return { row, access };
}

export async function updateVariant(ctx: DomainContext, id: string, patch: VariantPatch, expectedVersion: number): Promise<VariantDTO> {
  const { row, access } = await loadVariant(ctx, id);
  if (row.version !== expectedVersion) throw versionConflict();
  const next: VariantRowInput = {
    name: patch.name ?? row.name,
    key: patch.key ?? row.key,
    sku: patch.sku !== undefined ? patch.sku : row.sku,
    defaultQty: patch.defaultQty !== undefined ? patch.defaultQty : row.defaultQty,
    packQty: patch.packQty !== undefined ? patch.packQty : row.packQty,
    attributes: patch.attributes ?? row.attributes,
  };
  assertVariantRow(next, 0);
  const others = await db.select().from(programVariants).where(and(eq(programVariants.programId, row.programId), isNull(programVariants.deletedAt)));
  const clash = findConflicts(
    [{ comboKey: '0', attributes: Object.keys(next.attributes ?? {}).length ? (next.attributes as Record<string, string>) : { id: row.id }, name: next.name.trim(), key: cleanKey(next.key), sku: next.sku?.trim() || null }],
    others.filter((o) => o.id !== id).map((o) => ({ key: o.key, name: o.name, sku: o.sku, attributes: Object.keys(o.attributes).length ? o.attributes : { id: o.id } })),
  );
  if (clash.length > 0) throw conflict(conflictMessage(clash[0]!));
  const [updated] = await db.transaction(async (tx) => {
    const rows = await tx
      .update(programVariants)
      .set({
        name: next.name.trim(),
        key: cleanKey(next.key),
        sku: next.sku?.trim() || null,
        defaultQty: next.defaultQty || null,
        packQty: next.packQty || null,
        stdMinutesPerUnit: patch.stdMinutesPerUnit !== undefined ? patch.stdMinutesPerUnit || null : row.stdMinutesPerUnit,
        materialCostPerUnit: patch.materialCostPerUnit !== undefined ? patch.materialCostPerUnit || null : row.materialCostPerUnit,
        color: patch.color !== undefined ? patch.color : row.color,
        attributes: { ...(next.attributes ?? {}) },
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(and(eq(programVariants.id, id), eq(programVariants.version, expectedVersion)))
      .returning();
    if (rows.length === 0) throw versionConflict();
    await logActivity(tx, ctx, { verb: 'variant.updated', entityType: 'variant', entityId: id, projectId: row.programId, before: { name: row.name, key: row.key }, after: { name: rows[0]!.name, key: rows[0]!.key } });
    return rows;
  });
  const [dto] = await variantDTOs(db, ctx, access, [updated!]);
  return dto!;
}

export async function reorderVariants(ctx: DomainContext, key: string, ids: readonly string[]): Promise<void> {
  const { program } = await requireProgram(ctx, key, 'project:update');
  const ranks = ranksBetween(ids.length);
  await db.transaction(async (tx) => {
    for (const [index, id] of ids.entries()) {
      await tx.update(programVariants).set({ position: ranks[index]!, updatedAt: new Date() }).where(and(eq(programVariants.id, id), eq(programVariants.programId, program.id)));
    }
  });
}

async function setVariantStatus(ctx: DomainContext, id: string, status: 'active' | 'retired'): Promise<void> {
  const { row } = await loadVariant(ctx, id);
  if (row.status === status) return;
  await db.transaction(async (tx) => {
    await tx.update(programVariants).set({ status, version: row.version + 1, updatedAt: new Date() }).where(eq(programVariants.id, id));
    await logActivity(tx, ctx, { verb: status === 'retired' ? 'variant.retired' : 'variant.restored', entityType: 'variant', entityId: id, projectId: row.programId, after: { name: row.name } });
  });
}

export const retireVariant = (ctx: DomainContext, id: string) => setVariantStatus(ctx, id, 'retired');
export const restoreVariant = (ctx: DomainContext, id: string) => setVariantStatus(ctx, id, 'active');

/** Deletes a variant that has no builds (retire it otherwise). */
export async function deleteVariant(ctx: DomainContext, id: string): Promise<void> {
  const { row } = await loadVariant(ctx, id);
  const [used] = await db.select({ id: builds.taskId }).from(builds).where(eq(builds.variantId, id)).limit(1);
  if (used) throw invalid('This variant has builds. Retire it instead.');
  await db.transaction(async (tx) => {
    const lines = await tx.execute(sql`select 1 from pm.price_card_lines l join pm.price_card_versions v on v.id = l.version_id where l.variant_id = ${id}::uuid and v.status = 'published' limit 1`);
    if ((lines as unknown as { rows: unknown[] }).rows.length > 0) throw invalid('A published price card has a rate for this variant. Retire it instead.');
    await tx.execute(sql`delete from pm.price_card_lines where variant_id = ${id}::uuid`);
    await tx.update(programVariants).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(programVariants.id, id));
    await logActivity(tx, ctx, { verb: 'variant.deleted', entityType: 'variant', entityId: id, projectId: row.programId, before: { name: row.name, key: row.key } });
  });
}

/** Links a variant to a core item and or a WMS kit product (`uses_kit` edges plus the cache columns). */
export async function linkVariantKit(ctx: DomainContext, id: string, input: { readonly coreItemId?: string | null; readonly wmsProductId?: string | null; readonly title?: string; readonly sku?: string | null }): Promise<VariantDTO> {
  const { row, access } = await loadVariant(ctx, id);
  await db.transaction(async (tx) => {
    const edges = await listRecordLinks(shared(tx), ctx.orgId, { type: 'pm_variant', id }, { relation: 'uses_kit' });
    for (const [field, type] of [['coreItemId', 'core_item'], ['wmsProductId', 'wms_product']] as const) {
      const value = input[field];
      if (value === undefined) continue;
      for (const edge of edges.filter((e) => e.to.type === type)) await unlinkRecords(shared(tx), ctx.orgId, edge.id);
      if (value) {
        await linkRecords(shared(tx), { orgId: ctx.orgId, from: { type: 'pm_variant', id }, to: { type, id: value }, relation: 'uses_kit', cache: { title: input.title }, meta: input.sku ? { sku: input.sku } : {}, createdBy: ctx.userId });
      }
    }
    await tx
      .update(programVariants)
      .set({
        ...(input.coreItemId !== undefined ? { coreItemId: input.coreItemId } : {}),
        ...(input.wmsProductId !== undefined ? { wmsProductId: input.wmsProductId } : {}),
        version: row.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(programVariants.id, id));
    await logActivity(tx, ctx, { verb: 'variant.kit_linked', entityType: 'variant', entityId: id, projectId: row.programId, after: { coreItemId: input.coreItemId ?? null, wmsProductId: input.wmsProductId ?? null } });
  });
  const [fresh] = await db.select().from(programVariants).where(eq(programVariants.id, id));
  const [dto] = await variantDTOs(db, ctx, access, [fresh!]);
  return dto!;
}

function axisValues(axis: AttributeAxisInput, existing: ProgramAttribute | undefined) {
  if (axis.values.length > MAX_ATTRIBUTE_VALUES) throw invalid(`An attribute can have up to ${MAX_ATTRIBUTE_VALUES} values.`);
  const codes = new Set<string>();
  return axis.values.map((value) => {
    const code = value.code.trim().toUpperCase();
    if (codes.has(code)) throw invalid(`Two ${axis.name} values use the code ${code}.`);
    codes.add(code);
    const prior = existing?.values.find((v) => (value.id && v.id === value.id) || v.code === code);
    return { id: prior?.id ?? value.id ?? randomUUID(), label: value.label.trim(), code, color: (value.color ?? null) as ProgramAttribute['values'][number]['color'] };
  });
}

/** Inserts attribute axes in `tx` (wizard). Returns the rows with their value ids. */
export async function insertAttributes(tx: Executor, ctx: DomainContext, programId: string, axes: readonly AttributeAxisInput[]): Promise<ProgramAttribute[]> {
  if (axes.length === 0) return [];
  if (axes.length > MAX_PROGRAM_ATTRIBUTES) throw invalid(`A program can have up to ${MAX_PROGRAM_ATTRIBUTES} attributes.`);
  const ranks = ranksBetween(axes.length);
  const names = new Set<string>();
  for (const axis of axes) {
    const lower = axis.name.trim().toLowerCase();
    if (names.has(lower)) throw invalid(`Two attributes are named ${axis.name}.`);
    names.add(lower);
  }
  return tx
    .insert(programAttributes)
    .values(axes.map((axis, index) => ({ orgId: ctx.orgId, programId, name: axis.name.trim(), values: axisValues(axis, undefined), position: ranks[index]! })))
    .returning();
}

/**
 * Saves the attribute axes. A new axis with variants in place needs a value for them
 * (`valuesForExisting`); removing an axis needs the remaining combinations to stay unique.
 */
export async function saveAttributes(ctx: DomainContext, key: string, axes: readonly AttributeAxisInput[], options: { readonly valuesForExisting?: Readonly<Record<string, string>> } = {}): Promise<AttributeDTO[]> {
  const { program } = await requireProgram(ctx, key, 'project:update');
  if (axes.length > MAX_PROGRAM_ATTRIBUTES) throw invalid(`A program can have up to ${MAX_PROGRAM_ATTRIBUTES} attributes.`);
  await db.transaction(async (tx) => {
    const current = await tx.select().from(programAttributes).where(and(eq(programAttributes.programId, program.id), isNull(programAttributes.deletedAt)));
    const variants = await tx.select().from(programVariants).where(and(eq(programVariants.programId, program.id), isNull(programVariants.deletedAt)));
    const keepIds = new Set(axes.map((axis) => axis.id).filter((id): id is string => Boolean(id)));
    const removed = current.filter((row) => !keepIds.has(row.id));
    const ranks = ranksBetween(axes.length);
    const savedIds: string[] = [];
    for (const [index, axis] of axes.entries()) {
      const existing = axis.id ? current.find((row) => row.id === axis.id) : undefined;
      const values = axisValues(axis, existing);
      if (existing) {
        const used = new Set(variants.map((v) => v.attributes[existing.id]).filter(Boolean));
        const lost = existing.values.filter((v) => used.has(v.id) && !values.some((n) => n.id === v.id));
        if (lost.length > 0) throw invalid(`Variants still use ${lost.map((v) => v.label).join(', ')}. Change those variants first.`);
        await tx.update(programAttributes).set({ name: axis.name.trim(), values, position: ranks[index]!, version: existing.version + 1, updatedAt: new Date() }).where(eq(programAttributes.id, existing.id));
        savedIds.push(existing.id);
      } else {
        const [row] = await tx.insert(programAttributes).values({ orgId: ctx.orgId, programId: program.id, name: axis.name.trim(), values, position: ranks[index]! }).returning();
        savedIds.push(row!.id);
        if (variants.length > 0) {
          const valueId = options.valuesForExisting?.[axis.name] ?? options.valuesForExisting?.[row!.id] ?? values[0]?.id;
          const picked = values.find((v) => v.id === valueId || v.code === valueId) ?? null;
          if (!picked) throw invalid(`Pick the ${axis.name} value for the variants you already have.`, { valuesForExisting: `Pick the ${axis.name} value for the variants you already have.` });
          for (const variant of variants) {
            await tx.update(programVariants).set({ attributes: { ...variant.attributes, [row!.id]: picked.id }, updatedAt: new Date() }).where(eq(programVariants.id, variant.id));
          }
        }
      }
    }
    if (removed.length > 0) {
      const rules = await tx.execute(sql`select 1 from pm.price_card_rules where attribute_id in (${sql.join(removed.map((r) => sql`${r.id}::uuid`), sql`, `)}) limit 1`);
      if ((rules as unknown as { rows: unknown[] }).rows.length > 0) throw invalid('A price card rule uses this attribute. Remove the rule first.');
      const combos = new Set<string>();
      for (const variant of variants) {
        const rest = Object.entries(variant.attributes).filter(([attributeId]) => !removed.some((r) => r.id === attributeId)).sort().map(([a, v]) => `${a}=${v}`).join('|');
        if (rest && combos.has(rest)) throw invalid('Removing this attribute would make two variants the same. Change or retire one first.');
        combos.add(rest);
      }
      await tx.update(programAttributes).set({ deletedAt: new Date(), updatedAt: new Date() }).where(inArray(programAttributes.id, removed.map((r) => r.id)));
      for (const variant of variants) {
        const next = Object.fromEntries(Object.entries(variant.attributes).filter(([attributeId]) => !removed.some((r) => r.id === attributeId)));
        await tx.update(programVariants).set({ attributes: next, updatedAt: new Date() }).where(eq(programVariants.id, variant.id));
      }
    }
    await logActivity(tx, ctx, { verb: 'attributes.changed', entityType: 'project', entityId: program.id, projectId: program.id, after: { names: axes.map((a) => a.name) } });
  });
  return listAttributes(ctx, key);
}
