/**
 * "Ask Dana to add Projects" (review round 5): which apps a member already asked for today. One
 * ask per person, per app, per day. The emails themselves are the record: their dedupe key holds
 * the organization, the person, the app and the day. Server only.
 */
import 'server-only';
import { like } from 'drizzle-orm';
import { PRODUCT_IDS, type ProductId } from '@kitstak/billing/catalog';
import { billingEmails } from '@kitstak/db/schema';
import { db } from '@/server/db';

/** The day an ask counts for, in UTC: '2026-11-25'. */
export function askDay(now: Date = new Date()): string {
  return now.toISOString().slice(0, 10);
}

/** `app_request:<org>:<user>:<app>:<day>`. One address is added per email that goes out. */
export function askKey(orgId: string, userId: string, product: ProductId, day: string): string {
  return `app_request:${orgId}:${userId}:${product}:${day}`;
}

/** The apps this person asked for today in this organization. */
export async function appsAskedToday(orgId: string, userId: string, now: Date = new Date()): Promise<readonly ProductId[]> {
  const day = askDay(now);
  const rows = await db
    .select({ key: billingEmails.dedupeKey })
    .from(billingEmails)
    .where(like(billingEmails.dedupeKey, `app_request:${orgId}:${userId}:%`));
  const asked = new Set<string>();
  for (const row of rows) {
    const [, , , product, rowDay] = row.key.split(':');
    if (rowDay === day && product) asked.add(product);
  }
  return PRODUCT_IDS.filter((id) => asked.has(id));
}
