/** Shared seed types: the environment every seed step receives and transaction helpers. */
import type { AppDb } from '@/server/api/db';
import type { DomainCtx, Tx } from '@/server/domain/types';
import type { FileStore } from '@/server/files';
import type { Rng } from '../seed-data';
import { setClock } from './runtime';
import { withWriteTx } from '@/server/db/sql';

export interface SeedEnv {
  readonly db: AppDb;
  readonly rng: Rng;
  readonly files: FileStore;
}

export interface SeedUser {
  readonly id: string;
  readonly email: string;
  readonly name: string;
}

/** Actor context for domain calls made "by" a seeded user. */
export const actor = (user: SeedUser): DomainCtx => ({ userId: user.id, source: user.email });

/** Context for work done by the scheduler / integrations. */
export const integrationCtx: DomainCtx = { userId: null, source: 'Integration' };

/**
 * Runs `fn` in one SQLite transaction with the virtual clock at `ms`. IMMEDIATE takes the
 * write lock up front, so a dev server writing to the same file makes us wait (busy
 * timeout) instead of failing with SQLITE_BUSY on a read-to-write upgrade.
 */
export async function txAt<T>(env: SeedEnv, ms: number, fn: (tx: Tx) => T): Promise<T> {
  setClock(ms);
  return await withWriteTx(env.db, async (tx) => fn(tx));
}

export type Id = string;

/** Readonly map from a business code (SKU, location code, ...) to an id. */
export type IdMap = ReadonlyMap<string, Id>;

export function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K, what: string): V {
  const value = map.get(key);
  if (value === undefined) throw new Error(`Seed reference missing: ${what} "${String(key)}"`);
  return value;
}

export const round2 = (n: number): number => Math.round(n * 100) / 100;

const BUSY_RETRIES = 6;
const BUSY_BACKOFF_MS = 60;

export function isBusyError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return (
    (typeof code === 'string' && code.startsWith('SQLITE_BUSY')) || /database is locked/i.test(error.message)
  );
}

/**
 * Retries an async domain command that opens its own (deferred) transaction when another
 * connection to the database file (the dev server) holds the write lock. The command's
 * writes are all-or-nothing, so a retry never duplicates rows.
 */
export async function retryBusy<T>(run: () => Promise<T>): Promise<T> {
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (!isBusyError(error) || attempt >= BUSY_RETRIES) throw error;
      await new Promise<void>((resolve) => setTimeout(resolve, BUSY_BACKOFF_MS * attempt));
    }
  }
}
