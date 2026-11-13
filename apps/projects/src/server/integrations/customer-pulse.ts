/**
 * Home "Your customers today": one row per customer behind the viewer's active projects, with the
 * CRM deal (stage, close date), the warehouse picture (late receipts, exceptions) and open work,
 * plus "mismatches" no single app can see on its own (deal won but tasks still open, receipts
 * late while work waits on them). Built from `customer360` per project, so every number agrees
 * with the project Overview. Fails soft: no CRM/WMS means an empty list.
 */
import 'server-only';
import { displayText } from '@kitstak/ui/text';
import { and, inArray, isNotNull, isNull, sql } from 'drizzle-orm';
import { db } from '@/server/db';
import { integrationLinks } from '@/server/db/schema';
import type { DomainContext } from '@/server/domain/_shared';
import { listProjects } from '@/server/domain';
import { getCrmItems } from './crm';
import { customer360, type Customer360 } from './customer360';
import { integrationAvailability } from './detect';

export interface CustomerPulseRow {
  readonly key: string;
  readonly customerName: string;
  readonly customerUrl: string | null;
  readonly projects: readonly { readonly id: string; readonly key: string; readonly name: string; readonly openTasks: number; readonly overdue: number }[];
  readonly deal: { readonly name: string; readonly stage: string | null; readonly outcome: 'won' | 'lost' | 'open'; readonly closeDate: string | null; readonly url: string } | null;
  readonly lateReceipts: number;
  readonly exceptions: number;
  readonly openOrders: number;
  readonly receiptsUrl: string | null;
  readonly exceptionsUrl: string | null;
  readonly risks: readonly { readonly id: string; readonly tone: 'danger' | 'warning'; readonly text: string; readonly href: string | null }[];
}

export interface CustomerMismatch {
  readonly id: string;
  readonly tone: 'danger' | 'warning';
  readonly text: string;
  /** In-app link (task or project). */
  readonly href: string;
}

export interface CustomerPulse {
  readonly available: { readonly crm: boolean; readonly wms: boolean };
  readonly rows: readonly CustomerPulseRow[];
  readonly mismatches: readonly CustomerMismatch[];
}

const CUSTOMER_TYPES = ['core_customer', 'crm_account', 'crm_item'] as const;
const MAX_PROJECTS = 8;

/** KitStak copy never shows em or en dashes; CRM names sometimes carry them. */
const undash = (text: string) => displayText(text, '');

function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

export async function customerPulse(ctx: DomainContext): Promise<CustomerPulse> {
  const available = await integrationAvailability(ctx);
  if (!available.crm && !available.wms) return { available, rows: [], mismatches: [] };
  const projects = (await listProjects(ctx)).filter((project) => project.status !== 'completed' && project.status !== 'archived');
  if (projects.length === 0) return { available, rows: [], mismatches: [] };
  const linked = await db
    .selectDistinct({ projectId: integrationLinks.projectId })
    .from(integrationLinks)
    .where(
      and(
        sql`${integrationLinks.orgId} = ${ctx.orgId}`,
        isNull(integrationLinks.taskId),
        isNotNull(integrationLinks.projectId),
        inArray(integrationLinks.targetType, [...CUSTOMER_TYPES]),
        inArray(
          integrationLinks.projectId,
          projects.map((project) => project.id),
        ),
      ),
    );
  const linkedIds = new Set(linked.map((row) => row.projectId));
  const candidates = projects.filter((project) => project.crmCustomerId || project.crmItemId || linkedIds.has(project.id)).slice(0, MAX_PROJECTS);

  const pictures = await Promise.all(
    candidates.map(async (project) => ({ project, c360: await customer360(ctx, project).catch((): Customer360 | null => null) })),
  );

  const byCustomer = new Map<string, { -readonly [K in keyof CustomerPulseRow]: CustomerPulseRow[K] }>();
  const mismatches: CustomerMismatch[] = [];
  for (const { project, c360 } of pictures) {
    if (!c360 || (!c360.customer && !c360.account && !c360.crm?.headline)) continue;
    const name = undash(c360.customer?.name ?? c360.account?.name ?? c360.crm?.headline?.name ?? project.name);
    const key = c360.customer?.id ?? c360.account?.id ?? `project:${project.id}`;
    const openTasks = Math.max(0, project.progress.total - project.progress.done);
    const headline = c360.crm?.headline ?? null;
    const row = byCustomer.get(key) ?? {
      key,
      customerName: name,
      customerUrl: c360.account?.url ?? c360.wms?.clientUrl ?? null,
      projects: [],
      deal: headline ? { name: undash(headline.name), stage: headline.stage, outcome: headline.outcome, closeDate: headline.closeDate, url: headline.url } : null,
      lateReceipts: c360.wms?.lateReceipts ?? 0,
      exceptions: c360.wms?.exceptions ?? 0,
      openOrders: c360.wms?.openOrders ?? 0,
      receiptsUrl: c360.wms?.receiptsUrl ?? null,
      exceptionsUrl: c360.wms?.exceptionsUrl ?? null,
      risks: [],
    };
    row.projects = [...row.projects, { id: project.id, key: project.key, name: project.name, openTasks, overdue: project.progress.overdue }];
    row.risks = [...row.risks, ...c360.risks.filter((risk) => !row.risks.some((seen) => seen.id === risk.id)).map(({ id, tone, text, href }) => ({ id, tone, text, href }))];
    byCustomer.set(key, row);

    // A won deal with an open delivery project is normal, so only a lost deal is a project-level mismatch.
    if (headline?.outcome === 'lost' && openTasks > 0) {
      mismatches.push({ id: `lost:${project.id}`, tone: 'danger', text: `${undash(headline.name)} is lost, but ${project.key} still has ${plural(openTasks, 'open task', 'open tasks')}`, href: `/p/${project.key}` });
    }
    if ((c360.wms?.lateReceipts ?? 0) > 0 && openTasks > 0) {
      mismatches.push({
        id: `late:${project.id}`,
        tone: 'warning',
        text: `${plural(c360.wms?.lateReceipts ?? 0, 'receipt is', 'receipts are')} late for ${name} while ${project.key} has ${plural(openTasks, 'open task', 'open tasks')}`,
        href: `/p/${project.key}`,
      });
    }
  }

  // Task-level: open tasks linked to a CRM deal that is already won or lost ("Send revised pricing"
  // still open on a Closed won deal).
  if (available.crm) {
    const visible = projects.map((project) => project.id);
    const result = await db.execute<{ task_id: string; number: number; title: string; key: string; deal_id: string }>(sql`
      select t.id as task_id, t.number, t.title, p.key, l.target_id as deal_id
      from pm.integration_links l
      join pm.tasks t on t.id = l.task_id and t.deleted_at is null
      join pm.statuses s on s.id = t.status_id
      join pm.projects p on p.id = t.project_id
      where l.org_id = ${ctx.orgId} and l.target_type = 'crm_item' and l.task_id is not null
        and s.category not in ('done', 'cancelled')
        and t.project_id = any(${sql.param(visible)}::uuid[])
      limit 200`);
    const deals = await getCrmItems(
      ctx,
      result.rows.map((row) => row.deal_id),
    );
    for (const row of result.rows) {
      const deal = deals.get(row.deal_id);
      const stage = `${deal?.status ?? ''}`.toLowerCase();
      const won = /\bwon\b/.test(stage);
      const lost = /\blost\b/.test(stage);
      if (!deal || (!won && !lost)) continue;
      mismatches.push({
        id: `task:${row.task_id}`,
        tone: lost ? 'danger' : 'warning',
        text: undash(`${deal.name} is ${deal.status ?? (won ? 'won' : 'lost')}, but ${row.key}-${row.number} "${row.title}" is still open`),
        href: `/p/${row.key}/${row.number}`,
      });
    }
  }

  const rows = [...byCustomer.values()].sort(
    (a, b) => b.risks.length + b.lateReceipts + b.exceptions - (a.risks.length + a.lateReceipts + a.exceptions) || a.customerName.localeCompare(b.customerName),
  );
  return { available, rows, mismatches: mismatches.slice(0, 6) };
}
