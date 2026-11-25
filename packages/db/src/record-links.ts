/**
 * core.record_links: one link graph for any record to any record (docs/programs/SPEC.md 1.2, 2.1).
 *
 * Raw `sql` over a structural executor, so every app (node-postgres, postgres-js, PGlite, or a
 * transaction of any of them) can read and write edges without the host schema. Writers store one
 * edge per pair and normalize its direction:
 *
 * - money and kit edges go from the pm record outward (`pm_program -> pulse_job`,
 *   `pm_build -> pulse_job`, `pm_variant -> core_item | wms_product`);
 * - `related` and `belongs_to`: the pm record is `from` when exactly one side is pm, otherwise the
 *   lower `(type, id)` pair is `from`;
 * - `created_from` keeps the direction given (the new record is `from`).
 *
 * `cached_url` stores a path, never an absolute URL (the reading app adds the sibling origin).
 * Reads never throw for "not installed": they return `[]` when the table is missing.
 */
import { sql, type SQL } from 'drizzle-orm';
import {
  isUuid,
  isoTimestampOf,
  pgErrorOf,
  queryFirst,
  queryRows,
  ttlCache,
  type Executor,
} from './programs/executor';

export type { Executor } from './programs/executor';

export const RECORD_TYPES = ['core_customer','core_item','crm_deal','crm_account','pm_project','pm_program','pm_task','pm_build','pm_variant','pulse_job','wms_work_order','wms_shipment_order','wms_client','wms_product'] as const;
export const RECORD_RELATIONS = ['related','belongs_to','bills_to','uses_kit','created_from'] as const;

export type RecordType = (typeof RECORD_TYPES)[number];
export type RecordRelation = (typeof RECORD_RELATIONS)[number];

export interface RecordRef {
  readonly type: RecordType;
  readonly id: string;
}

export interface RecordLinkRow {
  id: string;
  orgId: string;
  from: RecordRef;
  to: RecordRef;
  relation: RecordRelation;
  cachedTitle: string | null;
  cachedStatus: string | null;
  cachedUrl: string | null;
  cachedAt: string | null;
  meta: Record<string, unknown>;
  createdBy: string | null;
  createdAt: string;
}

export type RecordLinkErrorCode = 'TAKEN' | 'INVALID' | 'UNAVAILABLE';

export class RecordLinkError extends Error {
  constructor(
    readonly code: RecordLinkErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'RecordLinkError';
  }
}

/** UI copy for the partial unique indexes that keep the money shape (2.1). */
export const RECORD_LINK_TAKEN_MESSAGES: Readonly<Record<string, string>> = {
  record_links_one_job_per_program: 'This program already bills to a Pulse job. Remove that link first.',
  record_links_one_job_per_build: 'This build already bills to a Pulse job.',
  record_links_one_program_per_job: 'This Pulse job already takes revenue from another program.',
  record_links_one_kit_per_variant: 'This variant already has a kit of that kind linked. Remove that link first.',
};

export const RECORD_LINKS_UNAVAILABLE_MESSAGE = 'Linking is not ready yet. Ask an admin to update the database.';

const TYPE_SET: ReadonlySet<string> = new Set(RECORD_TYPES);
const RELATION_SET: ReadonlySet<string> = new Set(RECORD_RELATIONS);
const MAX_ID_LENGTH = 200;

export const isRecordType = (value: unknown): value is RecordType => typeof value === 'string' && TYPE_SET.has(value);
export const isRecordRelation = (value: unknown): value is RecordRelation => typeof value === 'string' && RELATION_SET.has(value);

const available = ttlCache<boolean>();

/** True when `core.record_links` exists (cached for a minute per executor). Never throws. */
export async function recordLinksAvailable(db: Executor): Promise<boolean> {
  const cached = available.get(db);
  if (cached !== undefined) return cached;
  let value = false;
  try {
    const row = await queryFirst<{ ok: boolean }>(db, sql`select to_regclass('core.record_links') is not null as ok`);
    value = row?.ok === true;
  } catch {
    value = false;
  }
  available.set(db, value);
  return value;
}

/** Test hook: forget the cached availability for an executor. */
export function resetRecordLinksAvailability(db: Executor): void {
  available.clear(db);
}

/**
 * A link path as stored: a path that starts with one `/`, or the path part of an absolute URL.
 * Anything else (a protocol relative `//host`, junk) is not stored.
 */
export function storedLinkPath(url: string | null | undefined): string | null {
  if (!url) return null;
  const trimmed = url.trim();
  if (trimmed.startsWith('//')) return null;
  if (trimmed.startsWith('/')) return trimmed;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return null;
  }
}

const isPm = (ref: RecordRef): boolean => ref.type.startsWith('pm_');

function comparePair(a: RecordRef, b: RecordRef): number {
  if (a.type !== b.type) return a.type < b.type ? -1 : 1;
  if (a.id === b.id) return 0;
  return a.id < b.id ? -1 : 1;
}

/** The stored direction of an edge (see the module header). Pure. */
export function normalizeEdge(from: RecordRef, to: RecordRef, relation: RecordRelation): { from: RecordRef; to: RecordRef } {
  if (relation === 'bills_to') {
    return to.type === 'pm_program' || to.type === 'pm_build' ? { from: to, to: from } : { from, to };
  }
  if (relation === 'uses_kit') {
    return to.type === 'pm_variant' ? { from: to, to: from } : { from, to };
  }
  if (relation === 'created_from') return { from, to };
  const fromPm = isPm(from);
  const toPm = isPm(to);
  if (fromPm && !toPm) return { from, to };
  if (toPm && !fromPm) return { from: to, to: from };
  return comparePair(from, to) <= 0 ? { from, to } : { from: to, to: from };
}

function assertRef(ref: RecordRef, side: string): void {
  if (!ref || !isRecordType(ref.type)) throw new RecordLinkError('INVALID', `That ${side} record type is not supported.`);
  if (typeof ref.id !== 'string' || ref.id.trim() === '' || ref.id.length > MAX_ID_LENGTH) {
    throw new RecordLinkError('INVALID', `That ${side} record is missing its id.`);
  }
}

/** Checks the edge against the SQL rules before it reaches the database. Throws `INVALID`. */
export function validateEdge(from: RecordRef, to: RecordRef, relation: RecordRelation): void {
  assertRef(from, 'first');
  assertRef(to, 'second');
  if (!isRecordRelation(relation)) throw new RecordLinkError('INVALID', 'That link type is not supported.');
  if (from.type === to.type && from.id === to.id) throw new RecordLinkError('INVALID', 'A record cannot link to itself.');
  if (relation === 'bills_to' && !((from.type === 'pm_program' || from.type === 'pm_build') && to.type === 'pulse_job')) {
    throw new RecordLinkError('INVALID', 'Only a program or a build can bill to a Pulse job.');
  }
  if (relation === 'uses_kit' && !(from.type === 'pm_variant' && (to.type === 'core_item' || to.type === 'wms_product'))) {
    throw new RecordLinkError('INVALID', 'Only a variant can use a kit, and the kit must be an item or a WMS product.');
  }
}

interface RawLink {
  id: string;
  org_id: string;
  from_type: string;
  from_id: string;
  to_type: string;
  to_id: string;
  relation: string;
  cached_title: string | null;
  cached_status: string | null;
  cached_url: string | null;
  cached_at: unknown;
  meta: unknown;
  created_by: string | null;
  created_at: unknown;
}

const COLUMNS = sql.raw(
  'id::text as id, org_id::text as org_id, from_type, from_id, to_type, to_id, relation, cached_title, cached_status, cached_url, cached_at, meta, created_by::text as created_by, created_at',
);

function toRow(raw: RawLink): RecordLinkRow {
  let meta: Record<string, unknown> = {};
  if (raw.meta && typeof raw.meta === 'object' && !Array.isArray(raw.meta)) meta = raw.meta as Record<string, unknown>;
  else if (typeof raw.meta === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw.meta);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) meta = parsed as Record<string, unknown>;
    } catch {
      meta = {};
    }
  }
  return {
    id: raw.id,
    orgId: raw.org_id,
    from: { type: raw.from_type as RecordType, id: raw.from_id },
    to: { type: raw.to_type as RecordType, id: raw.to_id },
    relation: raw.relation as RecordRelation,
    cachedTitle: raw.cached_title,
    cachedStatus: raw.cached_status,
    cachedUrl: raw.cached_url,
    cachedAt: isoTimestampOf(raw.cached_at),
    meta,
    createdBy: raw.created_by,
    createdAt: isoTimestampOf(raw.created_at) ?? '',
  };
}

function touches(ref: RecordRef): SQL {
  return sql`((from_type = ${ref.type} and from_id = ${ref.id}) or (to_type = ${ref.type} and to_id = ${ref.id}))`;
}

/** Every edge touching `ref`, both directions, newest first. `[]` when the table is missing. */
export async function listRecordLinks(
  db: Executor,
  orgId: string,
  ref: RecordRef,
  opts: { relation?: RecordRelation; otherType?: RecordType } = {},
): Promise<RecordLinkRow[]> {
  if (!isUuid(orgId) || !isRecordType(ref?.type) || typeof ref.id !== 'string') return [];
  if (!(await recordLinksAvailable(db))) return [];
  const relation = opts.relation && isRecordRelation(opts.relation) ? sql` and relation = ${opts.relation}` : sql``;
  const other = opts.otherType && isRecordType(opts.otherType)
    ? sql` and ((from_type = ${ref.type} and from_id = ${ref.id} and to_type = ${opts.otherType}) or (to_type = ${ref.type} and to_id = ${ref.id} and from_type = ${opts.otherType}))`
    : sql``;
  const rows = await queryRows<RawLink>(
    db,
    sql`select ${COLUMNS} from core.record_links
         where org_id = ${orgId}::uuid and ${touches(ref)}${relation}${other}
         order by created_at desc, id desc`,
  );
  return rows.map(toRow);
}

/** Every edge touching any of `refs`, both directions, newest first. */
export async function listRecordLinksMany(
  db: Executor,
  orgId: string,
  refs: readonly RecordRef[],
  opts: { relation?: RecordRelation } = {},
): Promise<RecordLinkRow[]> {
  const valid = refs.filter((ref) => ref && isRecordType(ref.type) && typeof ref.id === 'string' && ref.id !== '');
  if (!isUuid(orgId) || valid.length === 0) return [];
  if (!(await recordLinksAvailable(db))) return [];
  const relation = opts.relation && isRecordRelation(opts.relation) ? sql` and relation = ${opts.relation}` : sql``;
  const any = sql.join(valid.map(touches), sql` or `);
  const rows = await queryRows<RawLink>(
    db,
    sql`select ${COLUMNS} from core.record_links
         where org_id = ${orgId}::uuid and (${any})${relation}
         order by created_at desc, id desc`,
  );
  return rows.map(toRow);
}

export interface LinkRecordsInput {
  readonly orgId: string;
  readonly from: RecordRef;
  readonly to: RecordRef;
  readonly relation?: RecordRelation;
  readonly cache?: { readonly title?: string; readonly status?: string; readonly url?: string };
  readonly meta?: Record<string, unknown>;
  readonly createdBy?: string | null;
}

/**
 * Writes one edge (direction normalized) inside a savepoint. When the same edge exists, its
 * cache and meta are refreshed instead. A one job or one kit index refusal throws
 * `RecordLinkError('TAKEN')` with UI copy; the caller's transaction stays usable.
 */
export async function linkRecords(db: Executor, input: LinkRecordsInput): Promise<RecordLinkRow> {
  const relation: RecordRelation = input.relation ?? 'related';
  if (!isUuid(input.orgId)) throw new RecordLinkError('INVALID', 'That workspace is not valid.');
  assertRef(input.from, 'first');
  assertRef(input.to, 'second');
  if (!isRecordRelation(relation)) throw new RecordLinkError('INVALID', 'That link type is not supported.');
  const { from, to } = normalizeEdge(input.from, input.to, relation);
  validateEdge(from, to, relation);
  if (!(await recordLinksAvailable(db))) throw new RecordLinkError('UNAVAILABLE', RECORD_LINKS_UNAVAILABLE_MESSAGE);
  const title = input.cache?.title?.trim() ? input.cache.title.trim().slice(0, 500) : null;
  const status = input.cache?.status?.trim() ? input.cache.status.trim().slice(0, 120) : null;
  const url = storedLinkPath(input.cache?.url ?? null);
  const hasCache = title !== null || status !== null || url !== null;
  const meta = JSON.stringify(input.meta ?? {});
  const createdBy = input.createdBy && isUuid(input.createdBy) ? input.createdBy : null;
  try {
    return await db.transaction(async (tx) => {
      const row = await queryFirst<RawLink>(
        tx,
        sql`insert into core.record_links
              (org_id, from_type, from_id, to_type, to_id, relation, cached_title, cached_status, cached_url, cached_at, meta, created_by)
            values (${input.orgId}::uuid, ${from.type}, ${from.id}, ${to.type}, ${to.id}, ${relation},
                    ${title}, ${status}, ${url}, ${hasCache ? sql`now()` : sql`null`}, ${meta}::jsonb, ${createdBy}::uuid)
            on conflict (org_id, from_type, from_id, to_type, to_id, relation) do update set
              cached_title = coalesce(excluded.cached_title, record_links.cached_title),
              cached_status = coalesce(excluded.cached_status, record_links.cached_status),
              cached_url = coalesce(excluded.cached_url, record_links.cached_url),
              cached_at = coalesce(excluded.cached_at, record_links.cached_at),
              meta = record_links.meta || excluded.meta,
              updated_at = now()
            returning ${COLUMNS}`,
      );
      if (!row) throw new RecordLinkError('INVALID', 'The link could not be saved.');
      return toRow(row);
    });
  } catch (error) {
    if (error instanceof RecordLinkError) throw error;
    const pg = pgErrorOf(error);
    if (pg?.code === '23505') {
      const message = (pg.constraint && RECORD_LINK_TAKEN_MESSAGES[pg.constraint]) ?? 'That link already exists.';
      throw new RecordLinkError('TAKEN', message);
    }
    if (pg?.code === '23514' || pg?.code === '22P02') throw new RecordLinkError('INVALID', 'That link is not allowed.');
    throw error;
  }
}

/** Removes one edge of the org. True when a row was removed. */
export async function unlinkRecords(db: Executor, orgId: string, linkId: string): Promise<boolean> {
  if (!isUuid(orgId) || !isUuid(linkId)) return false;
  if (!(await recordLinksAvailable(db))) return false;
  const rows = await queryRows<{ id: string }>(
    db,
    sql`delete from core.record_links where org_id = ${orgId}::uuid and id = ${linkId}::uuid returning id::text as id`,
  );
  return rows.length > 0;
}

/**
 * Updates `cached_*` on every edge touching `ref` (for example a CRM deal renamed or moved to a
 * new stage). Fields left out keep their value. Returns the number of edges changed. Never
 * throws for a missing table (returns 0).
 */
export async function refreshLinkCache(
  db: Executor,
  orgId: string,
  ref: RecordRef,
  cache: { title?: string; status?: string; url?: string },
): Promise<number> {
  if (!isUuid(orgId) || !isRecordType(ref?.type) || typeof ref.id !== 'string') return 0;
  if (!(await recordLinksAvailable(db))) return 0;
  const title = cache.title?.trim() ? cache.title.trim().slice(0, 500) : null;
  const status = cache.status?.trim() ? cache.status.trim().slice(0, 120) : null;
  const url = storedLinkPath(cache.url ?? null);
  if (title === null && status === null && url === null) return 0;
  const rows = await queryRows<{ id: string }>(
    db,
    sql`update core.record_links set
          cached_title = coalesce(${title}, cached_title),
          cached_status = coalesce(${status}, cached_status),
          cached_url = coalesce(${url}, cached_url),
          cached_at = now(),
          updated_at = now()
        where org_id = ${orgId}::uuid and ${touches(ref)}
        returning id::text as id`,
  );
  return rows.length;
}
