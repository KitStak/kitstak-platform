/**
 * Settings → Integrations (studio team): how much of this workspace is linked to the CRM and
 * WMS. Counts only live tasks/projects; reading never fails the page.
 */
import 'server-only';
import { sql } from 'drizzle-orm';
import { db } from '@/server/db';
import type { IntegrationTargetType } from '@/lib/constants';
import type { DomainContext } from './_shared';

export interface IntegrationLinkSummary {
  /** Task + project links per record type. */
  readonly links: Partial<Record<IntegrationTargetType, number>>;
  /** Projects tied to a CRM client (core customer) or CRM deal. */
  readonly projectsWithClient: number;
  readonly projectsWithDeal: number;
  readonly automationsUsingApps: number;
}

export async function integrationLinkSummary(ctx: DomainContext): Promise<IntegrationLinkSummary> {
  try {
    const [links, projects, rules] = await Promise.all([
      db.execute(sql`
        select l.target_type as type, count(*)::int as n
        from pm.integration_links l
        left join pm.tasks t on t.id = l.task_id
        left join pm.projects p on p.id = coalesce(l.project_id, t.project_id)
        where l.org_id = ${ctx.orgId} and (t.id is null or t.deleted_at is null) and p.deleted_at is null and p.kind = 'project'
        group by l.target_type`),
      db.execute(sql`
        select count(*) filter (where crm_customer_id is not null)::int as clients,
               count(*) filter (where crm_item_id is not null)::int as deals
        from pm.projects where org_id = ${ctx.orgId} and deleted_at is null and kind = 'project'`),
      db.execute(sql`
        select count(*)::int as n from pm.automations
        where org_id = ${ctx.orgId} and deleted_at is null and trigger ->> 'type' in ('crm_stage_changed', 'wms_order_shipped')`),
    ]);
    const byType: Partial<Record<IntegrationTargetType, number>> = {};
    for (const row of links.rows as { type: IntegrationTargetType; n: number }[]) byType[row.type] = Number(row.n);
    const project = (projects.rows[0] ?? {}) as { clients?: number; deals?: number };
    return {
      links: byType,
      projectsWithClient: Number(project.clients ?? 0),
      projectsWithDeal: Number(project.deals ?? 0),
      automationsUsingApps: Number((rules.rows[0] as { n?: number } | undefined)?.n ?? 0),
    };
  } catch (error) {
    console.error('[settings] integration summary failed', error);
    return { links: {}, projectsWithClient: 0, projectsWithDeal: 0, automationsUsingApps: 0 };
  }
}
