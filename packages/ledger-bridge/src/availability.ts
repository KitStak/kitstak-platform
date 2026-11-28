/**
 * Is Ledger installed in this database? `to_regclass('ledger.invoices')`, cached 60 seconds per
 * executor (SPEC 9.1). Never throws: an error reads as not available.
 */
import { sql } from 'drizzle-orm';
import { queryOne, type BridgeExecutor } from './executor';
import type { LedgerAvailability } from './types';

const TTL_MS = 60_000;
const cache = new WeakMap<object, { readonly at: number; readonly value: LedgerAvailability }>();

export async function ledgerAvailability(db: BridgeExecutor): Promise<LedgerAvailability> {
  const cached = cache.get(db);
  if (cached && Date.now() - cached.at < TTL_MS) return cached.value;
  let value: LedgerAvailability;
  try {
    const row = await queryOne<{ installed: boolean }>(
      db,
      sql`select (to_regclass('ledger.invoices') is not null and to_regclass('ledger.member_roles') is not null) as installed`,
    );
    value = row?.installed === true ? { available: true } : { available: false, reason: 'not_installed' };
  } catch {
    // An error is not cached, so the next read tries again.
    return { available: false, reason: 'error' };
  }
  cache.set(db, { at: Date.now(), value });
  return value;
}

/** Test hook: forget the cached answer. */
export function resetLedgerAvailability(db: BridgeExecutor): void {
  cache.delete(db);
}
