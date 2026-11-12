/**
 * Shared zod fragments and helpers for the foundation-owned platform APIs (BUILD_PLAN F7).
 */
import { z } from 'zod';
import { MAX_BULK_IDS } from '@/server/api/envelope';
import { conflictError } from '@/server/api/errors';
import type { AuthContext } from '@/server/auth/context';
import type { DomainCtx } from '@/server/domain/types';
import { PLATFORM_ENTITY_TYPES } from './platform-entities';

export const DEFAULT_PAGE_SIZE = 100;
export const MAX_PAGE_SIZE = 1000;

export const idSchema = z.string().trim().min(1).max(64);
export const idParamsSchema = z.object({ id: idSchema });
export const entityTypeSchema = z.enum(PLATFORM_ENTITY_TYPES);
export const entityRefSchema = z.object({ entityType: entityTypeSchema, entityId: idSchema });

/** Bulk input `{ ids }` (0.2: max 1000). */
export const bulkIdsSchema = z
  .array(idSchema)
  .min(1, 'Select at least one item')
  .max(MAX_BULK_IDS, `At most ${MAX_BULK_IDS} items at once`);

export const pagingSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  ps: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
});

/** Optimistic concurrency token sent by the client on updates. */
export const versionSchema = z.number().int().min(1);

export interface Paged<T> {
  readonly rows: readonly T[];
  readonly total: number;
}

export const offsetFor = (page: number, pageSize: number): number => (Math.max(1, page) - 1) * pageSize;

export function listMeta(
  total: number,
  page: number,
  pageSize: number,
): { total: number; page: number; pageSize: number } {
  return { total, page, pageSize };
}

/** Throws CONFLICT when the client's version no longer matches the stored row. */
export function assertVersion(stored: number, sent: number | undefined): void {
  if (sent !== undefined && stored !== sent) throw conflictError();
}

/** Domain-engine ctx from a route: actor + full scope (cross-scope → 404). */
export function domainCtx(
  actor: { readonly userId: string | null; readonly source: string },
  auth: AuthContext,
): DomainCtx {
  return { userId: actor.userId, source: actor.source, scope: auth.scope };
}

/** SQL LIKE pattern for a contains / starts-with match with wildcards escaped. */
export function likeEscape(text: string, mode: 'contains' | 'startsWith' = 'contains'): string {
  const escaped = text.replace(/[\\%_]/g, (c) => `\\${c}`);
  return mode === 'contains' ? `%${escaped}%` : `${escaped}%`;
}
