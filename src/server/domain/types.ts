/**
 * Shared domain types (BUILD_PLAN F5 conventions): every engine function takes
 * `(tx, ctx, input)`. `tx` is the open transaction (or the database for reads);
 * `ctx` identifies the actor and, when present, the data scope to enforce.
 */
import type { AppDb } from "@/server/api/db";
import type { Scope } from "@/server/auth/scope";
import { assertInScope } from "@/server/auth/scope";

export type Tx = AppDb;

export interface DomainCtx {
  readonly userId: string | null;
  /** Email, "Integration" or "Scheduler". Stored on change_log / ledger rows. */
  readonly source: string;
  /** When set, every touched record is checked against it (cross-scope -> 404). */
  readonly scope?: Scope;
}

/** Context used by background work (scheduler, integrations). */
export const systemCtx = (source = "Scheduler"): DomainCtx => ({ userId: null, source });

export interface BulkResult {
  readonly succeeded: readonly string[];
  readonly failed: readonly { readonly id: string; readonly code: string; readonly message: string }[];
}

export function checkScope(
  ctx: DomainCtx,
  record: { readonly warehouseId?: string | null; readonly clientId?: string | null } | null | undefined,
  what: string,
): void {
  if (ctx.scope) assertInScope(ctx.scope, record, what);
}

export const nowIso = (): string => new Date().toISOString();

export const MAX_BULK_IDS = 1000;
