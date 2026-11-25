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
