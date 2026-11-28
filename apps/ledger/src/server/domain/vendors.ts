/**
 * Vendors (docs/ledger/SPEC.md 5.1, 5.2, 13 Phase 1). A vendor is the shared `core.vendors` row,
 * named the same by Ledger, Crew (temp agencies) and later the WMS. Ledger keeps its money
 * settings in `ledger.vendor_profiles`. Nobody hard deletes a vendor; archiving keeps history.
 *
 * Kinds are shared too. Ledger records the kinds it added (`vendor_profiles.ledger_kinds`) and
 * never drops a kind another app added unless the person says so (`confirmRemoveKinds`). An
 * import only adds kinds. Archiving a vendor that Crew uses as a temp agency needs `confirmCrew`.
 *
 * Seeing vendors needs `ap:read`; adding, changing and archiving them needs `bill:enter`.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db, type Transaction } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { DomainError, conflict, notFound } from '@/server/errors';
import { requireRight } from './access';
import { logActivity } from './activity';
import { cleanAddress, type PostalAddress } from './customers';
import { actorUserId, isUuid, textOrNull, type DomainContext } from './_shared';
import { VENDOR_KINDS, VENDOR_KIND_LABELS, type VendorKind } from '@/lib/vendor-kinds';

export { VENDOR_KINDS, VENDOR_KIND_LABELS, type VendorKind };

export interface VendorInput {
  readonly name: string;
  readonly kinds: readonly VendorKind[];
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: PostalAddress | null;
  readonly notes: string | null;
  readonly termsId: string | null;
  readonly defaultAccountId: string | null;
  readonly tracks1099: boolean;
  readonly w9OnFile: boolean;
}

export interface VendorDetail {
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly VendorKind[];
  /** Kinds Ledger added. The others came from another app (Crew, the WMS). */
  readonly ledgerKinds: readonly VendorKind[];
  readonly email: string | null;
  readonly phone: string | null;
  readonly address: PostalAddress | null;
  readonly notes: string | null;
  readonly termsId: string | null;
  readonly termsName: string | null;
  readonly defaultAccountId: string | null;
  readonly defaultAccountLabel: string | null;
  readonly tracks1099: boolean;
  readonly w9OnFile: boolean;
  readonly archivedAt: Date | null;
  readonly hasProfile: boolean;
  /** The shared row's version: a stale one is refused. */
  readonly version: number;
}

type VendorDbRow = {
  id: string;
  name: string;
  kinds: string[];
  ledger_kinds: string[] | null;
  email: string | null;
  phone: string | null;
  address: PostalAddress | null;
  notes: string | null;
  terms_id: string | null;
  terms_name: string | null;
  default_account_id: string | null;
  account_label: string | null;
  tracks_1099: boolean | null;
  w9_on_file: boolean | null;
  archived_at: Date | string | null;
  has_profile: boolean;
  version: number;
}

const SELECT = sql`select v.id, v.name, v.kinds, p.ledger_kinds, v.email, v.phone, v.address, v.notes,
       p.terms_id, t.name as terms_name, p.default_account_id, case when a.id is null then null else a.number || ' ' || a.name end as account_label,
       p.tracks_1099, p.w9_on_file, v.archived_at, (p.vendor_id is not null) as has_profile, v.version
  from core.vendors v
  left join ledger.vendor_profiles p on p.org_id = v.org_id and p.vendor_id = v.id
  left join ledger.terms t on t.org_id = p.org_id and t.id = p.terms_id
  left join ledger.accounts a on a.org_id = p.org_id and a.id = p.default_account_id`;

const asKinds = (values: readonly string[] | null | undefined): VendorKind[] => VENDOR_KINDS.filter((kind) => (values ?? []).includes(kind));

function toDetail(row: VendorDbRow): VendorDetail {
  return {
    id: row.id,
    name: row.name,
    kinds: asKinds(row.kinds),
    ledgerKinds: asKinds(row.ledger_kinds),
    email: row.email,
    phone: row.phone,
    address: row.address,
    notes: row.notes,
    termsId: row.terms_id,
    termsName: row.terms_name,
    defaultAccountId: row.default_account_id,
    defaultAccountLabel: row.account_label,
    tracks1099: row.tracks_1099 ?? false,
    w9OnFile: row.w9_on_file ?? false,
    archivedAt: row.archived_at ? new Date(row.archived_at) : null,
    hasProfile: row.has_profile,
    version: row.version,
  };
}

const kindsArray = (kinds: readonly string[]) => sql`array[${sql.join(kinds.map((kind) => sql`${kind}`), sql`, `)}]::text[]`;

export const listVendors = scoped(async function listVendors(ctx: DomainContext, options: { readonly archived?: boolean } = {}): Promise<readonly VendorDetail[]> {
  await requireRight(ctx, 'ap:read');
  const result = await db.execute<VendorDbRow>(
    sql`${SELECT} where v.org_id = ${ctx.orgId}::uuid and v.deleted_at is null and ${options.archived ? sql`v.archived_at is not null` : sql`v.archived_at is null`} order by lower(v.name)`,
  );
  return result.rows.map(toDetail);
});

export const getVendor = scoped(async function getVendor(ctx: DomainContext, id: string): Promise<VendorDetail> {
  await requireRight(ctx, 'ap:read');
  if (!isUuid(id)) throw notFound('That vendor');
  const result = await db.execute<VendorDbRow>(sql`${SELECT} where v.org_id = ${ctx.orgId}::uuid and v.id = ${id}::uuid and v.deleted_at is null`);
  const row = result.rows[0];
  if (!row) throw notFound('That vendor');
  return toDetail(row);
});

function normalize(input: VendorInput): VendorInput {
  const name = input.name.trim();
  if (name === '') throw new DomainError('VALIDATION', 'Give the vendor a name.', { name: 'Needed.' });
  return {
    ...input,
    name,
    kinds: asKinds(input.kinds),
    email: textOrNull(input.email)?.toLowerCase() ?? null,
    phone: textOrNull(input.phone),
    notes: textOrNull(input.notes),
    address: cleanAddress(input.address),
  };
}

async function assertNameFree(tx: Transaction, orgId: string, name: string, exceptId: string | null): Promise<void> {
  const result = await tx.execute<{ name: string }>(
    sql`select name from core.vendors where org_id = ${orgId}::uuid and archived_at is null and deleted_at is null
           and lower(name) = lower(${name}) and ${exceptId ? sql`id <> ${exceptId}::uuid` : sql`true`} limit 1`,
  );
  if (result.rows[0]) throw new DomainError('CONFLICT', `A vendor named ${result.rows[0].name} is already in your list.`, { name: 'Already used.' });
}

async function writeProfile(tx: Transaction, ctx: DomainContext, vendorId: string, input: VendorInput, ledgerKinds: readonly string[]): Promise<void> {
  await tx.execute(sql`
    insert into ledger.vendor_profiles (org_id, vendor_id, terms_id, default_account_id, tracks_1099, w9_on_file, ledger_kinds)
    values (${ctx.orgId}::uuid, ${vendorId}::uuid, ${input.termsId}::uuid, ${input.defaultAccountId}::uuid, ${input.tracks1099}, ${input.w9OnFile}, ${kindsArray(ledgerKinds)})
    on conflict (org_id, vendor_id) do update set
      terms_id = excluded.terms_id, default_account_id = excluded.default_account_id, tracks_1099 = excluded.tracks_1099,
      w9_on_file = excluded.w9_on_file, ledger_kinds = excluded.ledger_kinds, version = ledger.vendor_profiles.version + 1, updated_at = now()`);
}

/** Adds a `core.vendors` row and its Ledger profile inside `tx`. Rights are the caller's job. */
export const insertVendor = scoped(async function insertVendor(tx: Transaction, ctx: DomainContext, raw: VendorInput, meta: Record<string, unknown> = {}): Promise<string> {
  const input = normalize(raw);
  await assertNameFree(tx, ctx.orgId, input.name, null);
  const result = await tx.execute<{ id: string }>(
    sql`insert into core.vendors (org_id, name, kinds, email, phone, address, notes, created_by, updated_by)
        values (${ctx.orgId}::uuid, ${input.name}, ${kindsArray(input.kinds)}, ${input.email}, ${input.phone},
                ${input.address ? JSON.stringify(input.address) : null}::jsonb, ${input.notes}, ${actorUserId(ctx)}::uuid, ${actorUserId(ctx)}::uuid)
        returning id`,
  );
  const id = result.rows[0]!.id;
  await writeProfile(tx, ctx, id, input, input.kinds);
  await logActivity(tx, ctx, { verb: 'vendor.created', entityType: 'vendor', entityId: id, after: { ...input }, meta });
  return id;
}, 1);

export interface SaveVendorOptions {
  /** The shared row's version the person saw; null skips the check (imports read it fresh). */
  readonly version: number | null;
  /** `screen`: the kinds given are the whole list. `import`: the kinds given are added, none removed. */
  readonly mode: 'screen' | 'import';
  /** Kinds another app added that the person chose to remove anyway. */
  readonly confirmRemoveKinds?: readonly VendorKind[];
  readonly meta?: Record<string, unknown>;
}

/** Saves a vendor inside `tx`, under a row lock on the shared row, keeping every kind Ledger may not drop. */
export const saveVendor = scoped(async function saveVendor(tx: Transaction, ctx: DomainContext, id: string, raw: VendorInput, options: SaveVendorOptions): Promise<void> {
  const input = normalize(raw);
  const found = await tx.execute<VendorDbRow>(sql`${SELECT} where v.org_id = ${ctx.orgId}::uuid and v.id = ${id}::uuid and v.deleted_at is null for update of v`);
  const current = found.rows[0];
  if (!current) throw notFound('That vendor');
  const before = toDetail(current);
  if (options.version !== null && before.version !== options.version) throw conflict('Someone else changed this vendor. Here is the new one.');
  if (!before.archivedAt) await assertNameFree(tx, ctx.orgId, input.name, id);

  const wanted = new Set<VendorKind>(input.kinds);
  const added = input.kinds.filter((kind) => !before.kinds.includes(kind));
  const removed = options.mode === 'import' ? [] : before.kinds.filter((kind) => !wanted.has(kind));
  const foreign = removed.filter((kind) => !before.ledgerKinds.includes(kind) && !(options.confirmRemoveKinds ?? []).includes(kind));
  if (foreign.length > 0) {
    const words = foreign.map((kind) => VENDOR_KIND_LABELS[kind]).join(' and ');
    throw new DomainError('CONFLICT', `Another KitStak app added ${words} to this vendor${foreign.includes('temp_agency') ? ' (Crew uses it for temp agencies)' : ''}. Confirm to remove it anyway.`, {
      kinds: foreign.join(','),
    });
  }
  const kinds = VENDOR_KINDS.filter((kind) => (before.kinds.includes(kind) || added.includes(kind)) && !removed.includes(kind));
  const ledgerKinds = VENDOR_KINDS.filter((kind) => (before.ledgerKinds.includes(kind) || added.includes(kind)) && kinds.includes(kind));

  await tx.execute(sql`update core.vendors set name = ${input.name}, kinds = ${kindsArray(kinds)}, email = ${input.email}, phone = ${input.phone},
                              address = ${input.address ? JSON.stringify(input.address) : null}::jsonb, notes = ${input.notes},
                              updated_by = ${actorUserId(ctx)}::uuid, version = version + 1, updated_at = now()
                        where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
  await writeProfile(tx, ctx, id, input, ledgerKinds);
  await logActivity(tx, ctx, {
    verb: 'vendor.updated',
    entityType: 'vendor',
    entityId: id,
    before: { name: before.name, kinds: before.kinds, email: before.email, phone: before.phone, termsId: before.termsId, tracks1099: before.tracks1099, w9OnFile: before.w9OnFile },
    after: { ...input, kinds },
    meta: options.meta ?? {},
  });
}, 1);

export const createVendor = scoped(async function createVendor(ctx: DomainContext, input: VendorInput): Promise<string> {
  await requireRight(ctx, 'bill:enter');
  return db.transaction((tx) => insertVendor(tx, ctx, input));
});

export const updateVendor = scoped(async function updateVendor(
  ctx: DomainContext,
  id: string,
  input: VendorInput,
  options: { readonly version: number; readonly confirmRemoveKinds?: readonly VendorKind[] },
): Promise<void> {
  await requireRight(ctx, 'bill:enter');
  if (!isUuid(id)) throw notFound('That vendor');
  await db.transaction((tx) => saveVendor(tx, ctx, id, input, { version: options.version, mode: 'screen', confirmRemoveKinds: options.confirmRemoveKinds }));
});

/**
 * Archives a vendor: it leaves pickers and lists and frees its name, and every old bill keeps
 * pointing at it. A temp agency is used by Crew, so archiving one needs `confirmCrew`.
 */
export const archiveVendor = scoped(async function archiveVendor(ctx: DomainContext, id: string, options: { readonly confirmCrew?: boolean } = {}): Promise<void> {
  await requireRight(ctx, 'bill:enter');
  if (!isUuid(id)) throw notFound('That vendor');
  await db.transaction(async (tx) => {
    const found = await tx.execute<{ name: string; kinds: string[]; archived_at: Date | null }>(
      sql`select name, kinds, archived_at from core.vendors where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid and deleted_at is null for update`,
    );
    const row = found.rows[0];
    if (!row) throw notFound('That vendor');
    if (row.archived_at) return;
    if (row.kinds.includes('temp_agency') && !options.confirmCrew) {
      throw new DomainError('CONFLICT', `${row.name} is a temp agency in Crew. Archiving it here hides it from Crew too. Confirm to archive it anyway.`, { confirmCrew: 'Needed.' });
    }
    await tx.execute(sql`update core.vendors set archived_at = now(), updated_by = ${actorUserId(ctx)}::uuid, version = version + 1, updated_at = now()
                          where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
    await logActivity(tx, ctx, { verb: 'vendor.archived', entityType: 'vendor', entityId: id, before: { archived: false }, after: { archived: true }, meta: { kinds: row.kinds } });
  });
});

/** Brings an archived vendor back, when no live vendor took its name meanwhile. */
export const restoreVendor = scoped(async function restoreVendor(ctx: DomainContext, id: string): Promise<void> {
  await requireRight(ctx, 'bill:enter');
  if (!isUuid(id)) throw notFound('That vendor');
  await db.transaction(async (tx) => {
    const found = await tx.execute<{ name: string; archived_at: Date | null }>(
      sql`select name, archived_at from core.vendors where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid and deleted_at is null for update`,
    );
    const row = found.rows[0];
    if (!row) throw notFound('That vendor');
    if (!row.archived_at) return;
    await assertNameFree(tx, ctx.orgId, row.name, id);
    await tx.execute(sql`update core.vendors set archived_at = null, updated_by = ${actorUserId(ctx)}::uuid, version = version + 1, updated_at = now()
                          where org_id = ${ctx.orgId}::uuid and id = ${id}::uuid`);
    await logActivity(tx, ctx, { verb: 'vendor.restored', entityType: 'vendor', entityId: id, before: { archived: true }, after: { archived: false } });
  });
});
