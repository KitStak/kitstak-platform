/**
 * One billing step at a time per organization (review round 2, docs/billing/CONTRACTS.md section 25).
 *
 * Opening checkout and confirming a plan change both read our tables, ask the gateway, and write
 * back. Two of them at the same moment for one organization made two gateway customers, or charged
 * one change three times. `withOrgBillingTurn` lets one run and makes the others wait their turn.
 *
 * It is a lease row in `core.billing_locks`, not an advisory lock:
 *  - no database connection is held while the gateway is asked, so a small pool can never lock up,
 *  - the lease ends by itself, so a server that dies mid step cannot block an organization for good,
 *  - the webhook path keeps its own short advisory lock (`lockOrgBilling`) inside one transaction, so
 *    a gateway event that arrives during a step is applied without waiting for the step.
 *
 * The database clock is the only clock used, so two servers never disagree about when a lease ends.
 */
import { randomUUID } from 'node:crypto';
import { sql } from 'drizzle-orm';
import { type BillingDb, errorText, logBilling, rows } from './db';

/** Longer than any step can take: every gateway call has its own, shorter time limit. */
const LEASE_SECONDS = 120;
/** How long a second caller waits for its turn before it is told to try again. */
const DEFAULT_WAIT_MS = 20_000;

export type BillingTurn<T> = { readonly ok: true; readonly value: T } | { readonly ok: false };

function pause(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function take(db: Pick<BillingDb, 'execute'>, orgId: string, holder: string, purpose: string): Promise<boolean> {
  const result = await db.execute(sql`
    INSERT INTO "core"."billing_locks" ("org_id", "holder", "purpose", "expires_at")
    VALUES (${orgId}, ${holder}, ${purpose}, now() + (${LEASE_SECONDS} * interval '1 second'))
    ON CONFLICT ("org_id") DO UPDATE
       SET "holder" = EXCLUDED."holder", "purpose" = EXCLUDED."purpose",
           "expires_at" = EXCLUDED."expires_at", "created_at" = now()
     WHERE "core"."billing_locks"."expires_at" <= now()
    RETURNING "holder"`);
  return rows<{ holder: string }>(result)[0]?.holder === holder;
}

/**
 * Runs `run` while holding the organization's turn. Returns `{ ok: false }` when the turn did not
 * come within `waitMs`; nothing was run then. Whatever `run` throws is thrown on, after the turn is
 * given back.
 */
export async function withOrgBillingTurn<T>(
  db: Pick<BillingDb, 'execute'>,
  input: { orgId: string; purpose: string; waitMs?: number },
  run: () => Promise<T>,
): Promise<BillingTurn<T>> {
  const holder = randomUUID();
  const deadline = Date.now() + Math.max(0, input.waitMs ?? DEFAULT_WAIT_MS);
  let delay = 40;
  for (;;) {
    if (await take(db, input.orgId, holder, input.purpose)) break;
    if (Date.now() >= deadline) {
      logBilling('warn', 'a billing step did not get its turn in time', { orgId: input.orgId, purpose: input.purpose });
      return { ok: false };
    }
    // A little randomness, so two waiters do not keep asking at the same instant.
    await pause(delay + Math.floor(Math.random() * 40));
    delay = Math.min(250, Math.round(delay * 1.5));
  }
  try {
    return { ok: true, value: await run() };
  } finally {
    try {
      await db.execute(sql`DELETE FROM "core"."billing_locks" WHERE "org_id" = ${input.orgId} AND "holder" = ${holder}`);
    } catch (error) {
      // The lease ends by itself. Say so, because the next step of this organization waits for it.
      logBilling('error', 'could not give back a billing turn', { orgId: input.orgId, error: errorText(error) });
    }
  }
}
