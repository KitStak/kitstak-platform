/**
 * Billing rate limits (docs/billing/CONTRACTS.md section 11.9): counter rows in `core.rate_limit`
 * (the table Better Auth uses) under keys that start 'billing:'. One fixed window per key, counted in
 * a single atomic upsert so two requests at once cannot both slip through.
 */
import { sql } from 'drizzle-orm';
import { type BillingDb, rows } from './db';

/** True when the call is allowed. False when the key is over `max` inside the window. */
export async function enforceRateLimit(
  db: BillingDb,
  input: { key: string; windowSeconds: number; max: number },
): Promise<boolean> {
  const key = input.key.startsWith('billing:') ? input.key : `billing:${input.key}`;
  const now = Date.now();
  const windowStart = now - Math.max(1, Math.round(input.windowSeconds)) * 1000;
  const result = await db.execute(sql`
    INSERT INTO "core"."rate_limit" ("key", "count", "last_request")
    VALUES (${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "core"."rate_limit"."last_request" < ${windowStart}
                     THEN 1 ELSE "core"."rate_limit"."count" + 1 END,
      "last_request" = CASE WHEN "core"."rate_limit"."last_request" < ${windowStart}
                            THEN ${now} ELSE "core"."rate_limit"."last_request" END
    RETURNING "count"
  `);
  const count = Number(rows<{ count: number | string }>(result)[0]?.count ?? 1);
  return count <= input.max;
}

/**
 * A limit that slows down and never becomes a wall (billing review round 5). It is for mail a
 * person waits for, such as a sign in code: a stranger who asks for codes for someone else's
 * address must not be able to stop the owner from getting one for a day.
 *
 * `gaps[n]` is how many seconds must have passed since the last allowed call before call number
 * `n + 1` of a busy period is allowed. The last entry repeats for every later call. A busy period
 * ends after `quietSeconds` with no allowed call, and the count starts again.
 *
 * Example `[0, 0, 60, 600]`: two calls at once, the third a minute after the second, then one
 * every 10 minutes. The longest wait anyone ever has is the largest gap.
 *
 * A refused call changes nothing, so asking again does not push the wait further out. One atomic
 * statement decides, so two calls at once cannot both pass.
 */
export async function enforceSpacedLimit(
  db: BillingDb,
  input: { key: string; gaps: readonly number[]; quietSeconds: number; now?: number },
): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
  const key = input.key.startsWith('billing:') ? input.key : `billing:${input.key}`;
  const gaps = input.gaps.length > 0 ? input.gaps.map((gap) => Math.max(0, Math.round(gap))) : [0];
  const now = input.now ?? Date.now();
  const quietBefore = now - Math.max(1, Math.round(input.quietSeconds)) * 1000;
  const gapMs = (count: number): number => (gaps[Math.min(Math.max(count, 0), gaps.length - 1)] ?? 0) * 1000;
  // The gap for the stored count, as SQL: CASE WHEN count >= 3 THEN ... WHEN count >= 2 THEN ... END.
  let gapSql = sql`${gapMs(0)}::bigint`;
  for (let count = 1; count < gaps.length; count += 1) {
    gapSql = sql`CASE WHEN "core"."rate_limit"."count" >= ${count} THEN ${gapMs(count)}::bigint ELSE ${gapSql} END`;
  }
  const result = await db.execute(sql`
    INSERT INTO "core"."rate_limit" ("key", "count", "last_request")
    VALUES (${key}, 1, ${now})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "core"."rate_limit"."last_request" < ${quietBefore}
                     THEN 1 ELSE "core"."rate_limit"."count" + 1 END,
      "last_request" = ${now}
    WHERE "core"."rate_limit"."last_request" < ${quietBefore}
       OR "core"."rate_limit"."last_request" + (${gapSql}) <= ${now}
    RETURNING "count"
  `);
  if (rows<{ count: number | string }>(result).length > 0) return { allowed: true, retryAfterSeconds: 0 };
  const held = await db.execute(sql`SELECT "count", "last_request" FROM "core"."rate_limit" WHERE "key" = ${key}`);
  const row = rows<{ count: number | string; last_request: number | string }>(held)[0];
  // The row went away between the two statements (a cleanup). The next call starts fresh.
  if (!row) return { allowed: false, retryAfterSeconds: 1 };
  const openAt = Number(row.last_request) + gapMs(Number(row.count));
  return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((openAt - now) / 1000)) };
}

/** A wait as a person reads it: "40 seconds", "1 minute", "9 minutes". Rounded up, never short. */
export function waitText(seconds: number): string {
  const whole = Math.max(1, Math.ceil(seconds));
  if (whole < 60) return `${whole} ${whole === 1 ? 'second' : 'seconds'}`;
  const minutes = Math.ceil(whole / 60);
  return `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}`;
}
