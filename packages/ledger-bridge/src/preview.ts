/**
 * The preview gate as siblings see it (SPEC 3.1): may this org see any Ledger UI at all?
 *
 * The rule itself is `previewAccess('ledger', slug, env)` in `@kitstak/entitlements`, one rule for
 * Crew and Ledger. This package does not depend on `@kitstak/entitlements` yet, so the host passes
 * that function in as `gate`. `ledgerOpenFor` adds what every sibling needs around it: the org's
 * slug, the Ledger tables being there, and a never throwing answer.
 */
import { sql } from 'drizzle-orm';
import { ledgerAvailability } from './availability';
import { isUuid, queryOne, type BridgeExecutor } from './executor';

export type LedgerGateAnswer = 'full' | 'locked' | 'read_only';
/** `(slug) => previewAccess('ledger', slug)` from `@kitstak/entitlements`. */
export type LedgerGate = (orgSlug: string | null) => LedgerGateAnswer;

export interface LedgerOpen {
  /** Show Ledger UI (switcher row, Portal tile, CRM balance tab, Send to Ledger, Create invoice). */
  readonly open: boolean;
  readonly reason: 'open' | 'locked' | 'not_installed' | 'error';
}

/** Never throws. An org that is not let in, or a database without Ledger, answers `open: false`. */
export async function ledgerOpenFor(db: BridgeExecutor, orgId: string, gate: LedgerGate): Promise<LedgerOpen> {
  if (!isUuid(orgId)) return { open: false, reason: 'error' };
  try {
    const availability = await ledgerAvailability(db);
    if (!availability.available) return { open: false, reason: availability.reason };
    const row = await queryOne<{ slug: string | null }>(db, sql`select slug from core.organization where id = ${orgId}::uuid`);
    if (!row) return { open: false, reason: 'error' };
    return gate(row.slug) === 'full' ? { open: true, reason: 'open' } : { open: false, reason: 'locked' };
  } catch {
    return { open: false, reason: 'error' };
  }
}
