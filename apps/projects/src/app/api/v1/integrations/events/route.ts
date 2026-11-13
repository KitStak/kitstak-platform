import { timingSafeEqual } from 'node:crypto';
import { NextResponse } from 'next/server';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import type { DomainContext } from '@/server/domain/_shared';
import { orgsWithScheduledAutomations, sweepAutomations } from '@/server/domain/automation-sweep';
import { env } from '@/server/env';
import { drainIntegrationEvents, orgsWithPendingEvents } from '@/server/integrations/events';
import { orgsWithRecordTriggers } from '@/server/integrations/record-triggers';

/**
 * The scheduler's heartbeat (Vercel Cron, every 5 minutes, with CRON_SECRET set):
 *   1. drains CRM/WMS events (pm.integration_events) for every org that has some, and
 *   2. runs scheduled automations ("due soon", "overdue", CRM stage, WMS shipped) and cross-app
 *      recipes (deal won, receipt discrepancy, count variance) for every org with such a rule,
 * so automations fire even when nobody has Projects open. Signed-in use also does both lazily.
 */
function authorized(request: Request): boolean {
  const secret = env.CRON_SECRET;
  if (!secret) return false;
  const header = request.headers.get('authorization') ?? '';
  const expected = Buffer.from(`Bearer ${secret}`);
  const given = Buffer.from(header);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** Acts for the org as its first owner (automation runs are attributed to "KitStak"). */
async function orgContext(orgId: string): Promise<DomainContext | null> {
  const result = await db.execute<{ slug: string; user_id: string | null }>(sql`
    select o.slug, (select m.user_id from core.member m where m.organization_id = o.id and m.role like '%owner%' limit 1) as user_id
    from core.organization o where o.id = ${orgId}`);
  const org = result.rows[0];
  if (!org?.user_id) return null;
  return { orgId, orgSlug: org.slug, userId: org.user_id, userName: 'KitStak', orgRole: 'owner', actorKind: 'integration' };
}

export async function GET(request: Request) {
  if (!authorized(request)) {
    return NextResponse.json({ error: { code: 'UNAUTHENTICATED', message: 'This route is for the scheduler.' } }, { status: 401 });
  }
  const [eventOrgs, ruleOrgs, recipeOrgs] = await Promise.all([orgsWithPendingEvents(), orgsWithScheduledAutomations(), orgsWithRecordTriggers()]);
  const pending = new Set(eventOrgs);
  const orgIds = [...new Set([...eventOrgs, ...ruleOrgs, ...recipeOrgs])];
  let handled = 0;
  let checked = 0;
  for (const orgId of orgIds) {
    const ctx = await orgContext(orgId);
    if (!ctx) continue;
    if (pending.has(orgId)) handled += await drainIntegrationEvents(ctx, { force: true });
    checked += await sweepAutomations(ctx, { force: true });
  }
  return NextResponse.json({ data: { orgs: orgIds.length, handled, checked } }, { headers: { 'Cache-Control': 'no-store' } });
}
