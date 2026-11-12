/**
 * Server helpers shared by the M11 repositories: owned-address persistence (clients,
 * customers, retailers), country code/name mapping, name lookups and change-log
 * snapshots. Grid compilation and guards come from the M10 helpers.
 */
import { and, eq, inArray, sql } from 'drizzle-orm';
import { COUNTRIES, countryName } from '@/lib/countries';
import { normalizeDefaults, type OrgAddress } from '@/lib/grid-defs/organization/common';
import type { AppDb } from '@/server/api/db';
import * as s from '@/server/db/schema';
import type { DomainCtx } from '@/server/domain/types';
import { recordCreate, recordDelete, recordUpdate } from '@/server/domain/change-log';
import { dbAll } from '@/server/db/sql';

export {
  assertFound,
  assertVersion,
  compileGrid,
  domainCtxOf,
  duplicateError,
  changeLogPageSchema,
  changeLogResult,
  type Actor,
  type GridBinding,
} from './locations-shared';

type OwnerType = 'client' | 'customer' | 'retailer';
type AddressRow = typeof s.addresses.$inferSelect;

/** Seeds store country names; forms use ISO codes. */
export function countryCode(value: string | null | undefined): string {
  if (!value) return 'US';
  if (value.length === 2) return value.toUpperCase();
  return COUNTRIES.find((c) => c.name.toLowerCase() === value.toLowerCase())?.code ?? 'US';
}

export interface OwnedAddress {
  readonly id: string;
  readonly name: string;
  readonly usageType: 'Shipping' | 'Billing' | 'Return';
  readonly firstName: string | null;
  readonly lastName: string | null;
  readonly companyName: string | null;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string | null;
  readonly postalCode: string;
  readonly country: string;
  readonly countryName: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly isDefault: boolean;
  readonly isActive: boolean;
}

function toOwned(r: AddressRow): OwnedAddress {
  const code = countryCode(r.country);
  return {
    id: r.id,
    name: r.name ?? '',
    usageType: r.usageType,
    firstName: r.firstName,
    lastName: r.lastName,
    companyName: r.companyName,
    line1: r.line1,
    line2: r.line2,
    city: r.city,
    state: r.state,
    postalCode: r.postalCode,
    country: code,
    countryName: countryName(code) || r.country,
    phone: r.phone,
    email: r.email,
    isDefault: Boolean(r.isDefault),
    isActive: Boolean(r.isActive),
  };
}

export async function listAddresses(
  db: AppDb,
  ownerType: OwnerType,
  ownerId: string,
): Promise<OwnedAddress[]> {
  return (
    await db
      .select()
      .from(s.addresses)
      .where(and(eq(s.addresses.ownerType, ownerType), eq(s.addresses.ownerId, ownerId)))
      .orderBy(
        sql`CASE ${s.addresses.usageType} WHEN 'Shipping' THEN 0 WHEN 'Billing' THEN 1 ELSE 2 END`,
        sql`${s.addresses.isDefault} DESC`,
        s.addresses.createdAt,
      )
  ).map(toOwned);
}

/** Default (else first active) address per owner for one usage type. */
export async function defaultAddresses(
  db: AppDb,
  ownerType: OwnerType,
  ownerIds: readonly string[],
  usage: 'Shipping' | 'Billing' | 'Return' = 'Shipping',
): Promise<Map<string, OwnedAddress>> {
  const out = new Map<string, OwnedAddress>();
  if (ownerIds.length === 0) return out;
  const rows = await db
    .select()
    .from(s.addresses)
    .where(
      and(
        eq(s.addresses.ownerType, ownerType),
        inArray(s.addresses.ownerId, [...ownerIds]),
        eq(s.addresses.usageType, usage),
        eq(s.addresses.isActive, true),
      ),
    )
    .orderBy(sql`${s.addresses.isDefault} DESC`, s.addresses.createdAt);
  for (const r of rows) if (!out.has(r.ownerId)) out.set(r.ownerId, toOwned(r));
  return out;
}

const addressLabel = (a: { name: string | null; usageType: string; line1: string; city: string }) =>
  `${a.name || a.usageType} (${a.usageType}): ${a.line1}, ${a.city}`;

/**
 * Replaces the owner's address set with `next` (ids kept for edits), enforcing one
 * default per usage type, and logs added/removed/changed addresses on the owner.
 */
export async function saveAddresses(
  tx: AppDb,
  ctx: DomainCtx,
  owner: { type: OwnerType; id: string; code: string; userId: string | null },
  next: readonly OrgAddress[],
): Promise<void> {
  const existing = await tx
    .select()
    .from(s.addresses)
    .where(and(eq(s.addresses.ownerType, owner.type), eq(s.addresses.ownerId, owner.id)));
  const byId = new Map(existing.map((a) => [a.id, a]));
  const normalized = normalizeDefaults(next);
  const keep = new Set<string>();
  const before: Record<string, unknown> = {};
  const after: Record<string, unknown> = {};
  for (const a of existing)
    before[`address.${a.id}`] =
      `${addressLabel(a)}${a.isDefault ? ' · default' : ''}${a.isActive ? '' : ' · inactive'}`;
  for (const a of normalized) {
    const values = {
      ownerType: owner.type,
      ownerId: owner.id,
      name: a.name,
      usageType: a.usageType,
      firstName: a.firstName || null,
      lastName: a.lastName || null,
      companyName: a.companyName ?? null,
      line1: a.line1,
      line2: a.line2 ?? null,
      city: a.city,
      state: a.state || null,
      postalCode: a.postalCode.trim().toUpperCase(),
      country: countryName(a.country) || a.country,
      phone: a.phone ?? null,
      email: a.email ?? null,
      isDefault: a.isDefault,
      isActive: a.isActive,
      updatedBy: owner.userId,
    };
    let id = a.id && byId.has(a.id) ? a.id : null;
    if (id) await tx.update(s.addresses).set(values).where(eq(s.addresses.id, id));
    else
      id = (
        await tx
          .insert(s.addresses)
          .values({ ...values, createdBy: owner.userId })
          .returning({ id: s.addresses.id })
      )[0].id;
    keep.add(id);
    after[`address.${id}`] =
      `${addressLabel({ ...a, name: a.name })}${a.isDefault ? ' · default' : ''}${a.isActive ? '' : ' · inactive'}`;
  }
  const removed = existing.filter((a) => !keep.has(a.id)).map((a) => a.id);
  if (removed.length) await tx.delete(s.addresses).where(inArray(s.addresses.id, removed));
  // One explicit row per added / modified / removed address: "Shipping address Dock 2 added".
  const names = new Map<string, { name: string; usage: string }>();
  for (const a of existing) names.set(`address.${a.id}`, { name: a.name || a.usageType, usage: a.usageType });
  normalized.forEach((a, idx) => {
    const id = [...keep][idx];
    if (id) names.set(`address.${id}`, { name: a.name || a.usageType, usage: a.usageType });
  });
  for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
    if (before[k] === after[k]) continue;
    const n = names.get(k) ?? { name: 'Address', usage: '' };
    const what = `${n.usage ? `${n.usage} address` : 'Address'} ${n.name}`;
    const verb = before[k] === undefined ? 'added' : after[k] === undefined ? 'removed' : 'modified';
    await tx.insert(s.changeLog).values({
      entityType: owner.type,
      entityId: owner.id,
      entityCode: owner.code,
      type: 'Update',
      field: 'address',
      fieldLabel: what,
      fromValue: before[k] === undefined ? null : String(before[k]),
      toValue: after[k] === undefined ? null : String(after[k]),
      message: `${what} ${verb}.`,
      userId: ctx.userId,
      source: ctx.source,
    });
  }
}

export async function deleteAddresses(tx: AppDb, ownerType: OwnerType, ownerId: string): Promise<void> {
  await tx
    .delete(s.addresses)
    .where(and(eq(s.addresses.ownerType, ownerType), eq(s.addresses.ownerId, ownerId)));
}

/** id -> label for clients / warehouses / users / lookups (never show raw UUIDs). */
export async function namesOf(
  db: AppDb,
  table: 'clients' | 'warehouses' | 'users' | 'lookup_values',
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const list = [...new Set(ids.filter((v): v is string => Boolean(v)))];
  const out = new Map<string, string>();
  if (list.length === 0) return out;
  const col = table === 'warehouses' ? sql.raw('code') : sql.raw('name');
  const rows = await dbAll<{ id: string; label: string }>(
    db,
    sql`SELECT id, ${col} AS label FROM ${sql.raw(table)} WHERE id IN (${sql.join(
      list.map((id) => sql`${id}`),
      sql`, `,
    )})`,
  );
  for (const r of rows) out.set(r.id, r.label);
  return out;
}

export const logCreate = async (
  tx: AppDb,
  ctx: DomainCtx,
  entityType: string,
  entityId: string,
  entityCode: string,
): Promise<void> => await recordCreate(tx, ctx, { entityType, entityId, entityCode });
export const logDelete = async (
  tx: AppDb,
  ctx: DomainCtx,
  entityType: string,
  entityId: string,
  entityCode: string,
): Promise<void> => await recordDelete(tx, ctx, { entityType, entityId, entityCode });
export const logUpdate = async (
  tx: AppDb,
  ctx: DomainCtx,
  entityType: string,
  entityId: string,
  entityCode: string,
  before: Readonly<Record<string, unknown>>,
  after: Readonly<Record<string, unknown>>,
): Promise<number> => await recordUpdate(tx, ctx, { entityType, entityId, entityCode, before, after });
