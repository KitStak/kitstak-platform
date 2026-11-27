/**
 * The database seam and the runtime shape for `@kitstak/billing/server` (docs/billing/CONTRACTS.md
 * section 11.1). Narrowed with `Pick` so the types do not depend on an app's schema generic, and so
 * a transaction handle can be passed wherever a database is expected.
 */
import type { PgDatabase, PgQueryResultHKT } from 'drizzle-orm/pg-core';
import type { BillingGateway } from '../gateway/types';
import type { BillingMode } from '../plan-state';
import type { BillingConfig } from './config';

type AnyPg = PgDatabase<PgQueryResultHKT, Record<string, unknown>>;
export type BillingReadDb = Pick<AnyPg, 'select' | 'execute'>;
export type BillingDb = Pick<AnyPg, 'select' | 'insert' | 'update' | 'delete' | 'execute' | 'transaction'>;

/** Who did it. `label` is the person's name, or "KitStak" for system writes. */
export interface BillingActor {
  readonly userId: string | null;
  readonly label: string;
}

export const SYSTEM_ACTOR: BillingActor = Object.freeze({ userId: null, label: 'KitStak' });

export interface BillingRuntime {
  readonly db: BillingDb;
  readonly config: BillingConfig;
  readonly mode: BillingMode;
  /** null when mode is 'unavailable'. */
  readonly gateway: BillingGateway | null;
  /** No trailing slash. */
  readonly portalUrl: string;
  readonly now: () => Date;
}

/** Works for node-postgres ({ rows }) and postgres-js (array) results of db.execute. */
export function rows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  if (result !== null && typeof result === 'object' && Array.isArray((result as { rows?: unknown }).rows)) {
    return (result as { rows: T[] }).rows;
  }
  return [];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_RE.test(value);
}

/** One line in the server log. Never pass a secret, a card number or a webhook body. */
export function logBilling(level: 'info' | 'warn' | 'error', message: string, detail?: Record<string, unknown>): void {
  const line = `[kitstak-billing] ${message}${detail ? ` ${JSON.stringify(detail)}` : ''}\n`;
  if (level === 'info') process.stdout.write(line);
  else process.stderr.write(line);
}

/** The text of an unknown thrown value, short enough for a log line or an error column. */
export function errorText(error: unknown, max = 500): string {
  const text = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return text.length > max ? `${text.slice(0, max)}...` : text;
}
