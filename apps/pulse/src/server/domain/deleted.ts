/**
 * The one rule for deleted jobs and deleted clients (round five): only a person who may manage
 * jobs (`job:manage`, the same right that deletes and restores a job or a client) can list or
 * read one, or the rows that belong to one. For everyone else a deleted job or client is not
 * there: a filter or a lookup by its id answers NOT_FOUND, the same as the job page and the
 * client page, and lists leave its rows out.
 *
 * Used by every read that takes a job or client id (the stream lists, the audit feed, clients,
 * quotes, standards, items, profit and report filters, exports) and by every list that can hold
 * rows of a deleted job or client.
 */
import 'server-only';
import { and, eq, sql, type SQL } from 'drizzle-orm';
import type { AnyPgColumn } from 'drizzle-orm/pg-core';
import { db, type Executor } from '@/server/db';
import { scoped } from '@/server/db/scope';
import { clients, jobs } from '@/server/db/schema';
import { notFound } from '@/server/errors';
import { canPulse } from '@/lib/permissions';
import { isUuid, type DomainContext } from './_shared';
import { requirePulse, type PulseAccess } from './access';

/** True for a person who may manage jobs: they see deleted jobs, deleted clients and their rows. */
export const seesDeleted = (access: Pick<PulseAccess, 'role'>): boolean => canPulse(access.role, 'job:manage');

/**
 * Refuses a job or client id that names a deleted one, unless the reader may see deleted ones.
 * Ids that are not uuids, or not in this workspace, are left to the caller (they match nothing).
 * Returns whether the reader sees deleted jobs and clients, so a list can decide what to hide.
 */
export const assertReadableRefs = scoped(async function assertReadableRefs(
  ctx: DomainContext,
  refs: { readonly jobId?: string | null; readonly clientId?: string | null },
  access?: Pick<PulseAccess, 'role'>,
  executor: Executor = db,
): Promise<boolean> {
  const reader = access ?? (await requirePulse(ctx, 'pulse:read'));
  if (seesDeleted(reader)) return true;
  if (refs.jobId && isUuid(refs.jobId)) {
    const [job] = await executor.select({ deletedAt: jobs.deletedAt }).from(jobs).where(and(eq(jobs.orgId, ctx.orgId), eq(jobs.id, refs.jobId)));
    if (job?.deletedAt) throw notFound('That job');
  }
  if (refs.clientId && isUuid(refs.clientId)) {
    const [client] = await executor.select({ deletedAt: clients.deletedAt }).from(clients).where(and(eq(clients.orgId, ctx.orgId), eq(clients.id, refs.clientId)));
    if (client?.deletedAt) throw notFound('That client');
  }
  return false;
});

/**
 * A WHERE part that leaves out rows of a deleted job and rows of a deleted client. Pass the row's
 * job id column and client id column (either may be left out). A row with no job or no client
 * passes that half.
 */
export function liveRefsOnly(refs: { readonly job?: AnyPgColumn | SQL; readonly client?: AnyPgColumn | SQL }): SQL {
  const parts: SQL[] = [];
  if (refs.job) parts.push(sql`(${refs.job} IS NULL OR NOT EXISTS (SELECT 1 FROM pulse.jobs dj WHERE dj.id = ${refs.job} AND dj.deleted_at IS NOT NULL))`);
  if (refs.client) parts.push(sql`(${refs.client} IS NULL OR NOT EXISTS (SELECT 1 FROM pulse.clients dc WHERE dc.id = ${refs.client} AND dc.deleted_at IS NOT NULL))`);
  return parts.length > 0 ? sql.join(parts, sql` AND `) : sql`TRUE`;
}

/**
 * The same rule for every API route and download in one place (`apiRoute`, `fileRoute`): a
 * `?job=` or `?client=` in the address that names a deleted job or client answers NOT_FOUND for
 * a reader who may not see deleted ones. Values that are not ids are left to the route.
 */
export const assertAddressRefsReadable = scoped(async function assertAddressRefsReadable(ctx: DomainContext, searchParams: URLSearchParams): Promise<void> {
  const jobId = searchParams.get('job')?.trim() ?? null;
  const clientId = searchParams.get('client')?.trim() ?? null;
  const refs = { jobId: jobId && isUuid(jobId) ? jobId : null, clientId: clientId && isUuid(clientId) ? clientId : null };
  if (!refs.jobId && !refs.clientId) return;
  await assertReadableRefs(ctx, refs);
});
