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
  readonly deal: {
    readonly name: string;
    readonly stage: string | null;
    readonly outcome: 'won' | 'lost' | 'open';
    readonly closeDate: string | null;
    readonly amount: number | null;
    readonly currency: string | null;
    readonly url: string;
  } | null;
  readonly lateReceipts: number;
  readonly exceptions: number;
  readonly openOrders: number;
  readonly receiptsUrl: string | null;
  readonly exceptionsUrl: string | null;
  readonly risks: readonly { readonly id: string; readonly tone: 'danger' | 'warning'; readonly text: string; readonly href: string | null }[];
}

/**
 * One mismatch, always read as: customer, then the fact, then the project work it affects.
 * `text` is the same sentence flattened (screen readers, older clients).
 */
export interface CustomerMismatch {
  readonly id: string;
  readonly kind: 'deal-closed-task-open' | 'deal-lost-project-open' | 'receipts-late';
  readonly tone: 'danger' | 'warning';
  readonly customer: string | null;
  readonly fact: string;
  /** The open task this is about (task mismatches), else null. */
  readonly task: { readonly id: string; readonly ref: string; readonly title: string; readonly href: string } | null;
  /** The project(s) this is about, e.g. "APX has 7 open tasks". */
  readonly work: string;
  readonly projectHref: string;
  readonly dealUrl: string | null;
  readonly receiptsUrl: string | null;
  readonly text: string;
  /** In-app link (task or project). */
  readonly href: string;
}

export interface CustomerPulse {
  readonly available: { readonly crm: boolean; readonly wms: boolean };
  /** What the card can honestly promise: CRM deals exist, warehouse data is connected. */
  readonly sources: { readonly deals: boolean; readonly warehouse: boolean };
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

/** "Frontier Aerospace: Pilot" or "Frontier Aerospace · Pilot" for account "Frontier Aerospace" reads "Pilot". */
export function dealTitleWithoutCustomer(dealName: string, customer: string | null): string {
  const name = undash(dealName).trim();
  if (!customer) return name;
  const lower = name.toLowerCase();
  const prefix = customer.trim().toLowerCase();
  if (!prefix || !lower.startsWith(prefix)) return name;
  const rest = name.slice(prefix.length).replace(/^\s*(?:[:·|/,]|-{1,2}|[—–])\s*/, '');
  return rest === name.slice(prefix.length) || rest.trim() === '' ? name : rest.trim();
}

export function mismatchText(m: Pick<CustomerMismatch, 'customer' | 'fact' | 'task' | 'work'>): string {
  const tail = m.task ? `${m.task.ref} ${m.task.title}` : m.work;
  return [m.customer, m.fact, tail].filter(Boolean).join(' · ');
}

const EMPTY = { rows: [], mismatches: [] } as const;

export async function customerPulse(ctx: DomainContext): Promise<CustomerPulse> {
  const available = await integrationAvailability(ctx);
  const sources = { deals: available.crm && (await orgHasDeals(ctx)), warehouse: available.wms };
  if (!available.crm && !available.wms) return { available, sources, ...EMPTY };
  const projects = (await listProjects(ctx)).filter((project) => project.status !== 'completed' && project.status !== 'archived');
  if (projects.length === 0) return { available, sources, ...EMPTY };
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
  const lateByCustomer = new Map<string, { late: number; name: string; receiptsUrl: string | null; projects: { key: string; openTasks: number }[] }>();
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
      deal: headline
        ? {
            name: dealTitleWithoutCustomer(headline.name, name),
            stage: headline.stage,
            outcome: headline.outcome,
            closeDate: headline.closeDate,
            amount: headline.amount,
            currency: headline.currency,
            url: headline.url,
          }
        : null,
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
      const lost = {
        customer: name,
        fact: `Deal ${dealTitleWithoutCustomer(headline.name, name)} is ${headline.stage ?? 'Lost'}`,
        task: null,
        work: `${project.key} has ${plural(openTasks, 'open task', 'open tasks')}`,
      };
      mismatches.push({
        id: `lost:${project.id}`,
        kind: 'deal-lost-project-open',
        tone: 'danger',
        ...lost,
        projectHref: `/p/${project.key}`,
        dealUrl: headline.url,
        receiptsUrl: null,
        text: mismatchText(lost),
        href: `/p/${project.key}`,
      });
    }
    // Late receipts belong to the customer, not to each project: one line per customer, and only
    // projects that have started count (a project created today is not behind on anything).
    const started = !project.startDate || project.startDate < todayIsoUtc();
    if ((c360.wms?.lateReceipts ?? 0) > 0 && openTasks > 0 && started) {
      const entry = lateByCustomer.get(key) ?? { late: c360.wms?.lateReceipts ?? 0, name, receiptsUrl: c360.wms?.receiptsUrl ?? null, projects: [] };
      entry.projects.push({ key: project.key, openTasks });
      lateByCustomer.set(key, entry);
    }
  }
  for (const [key, entry] of lateByCustomer) {
    const open = entry.projects.reduce((sum, p) => sum + p.openTasks, 0);
    const keys = entry.projects.map((p) => p.key);
    const who = keys.length === 1 ? `${keys[0]} has` : `${keys.slice(0, -1).join(', ')} and ${keys[keys.length - 1]} have`;
    const late = {
      customer: entry.name,
      fact: `${plural(entry.late, 'receipt is', 'receipts are')} late`,
      task: null,
      work: `${who} ${plural(open, 'open task', 'open tasks')}`,
    };
    mismatches.push({
      id: `late:${key}`,
      kind: 'receipts-late',
      tone: 'warning',
      ...late,
      projectHref: `/p/${entry.projects[0]?.key ?? ''}`,
      dealUrl: null,
      receiptsUrl: entry.receiptsUrl,
      text: mismatchText(late),
      href: `/p/${entry.projects[0]?.key ?? ''}`,
    });
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
    const dealIds = result.rows.map((row) => row.deal_id);
    const [deals, accounts] = await Promise.all([getCrmItems(ctx, dealIds), dealAccountNames(ctx, dealIds)]);
    for (const row of result.rows) {
      const deal = deals.get(row.deal_id);
      const stage = `${deal?.status ?? ''}`.toLowerCase();
      const won = /\bwon\b/.test(stage);
      const lost = /\blost\b/.test(stage);
      if (!deal || (!won && !lost)) continue;
      const customer = accounts.get(row.deal_id) ?? null;
      const ref = `${row.key}-${row.number}`;
      const parts = {
        customer,
        fact: `Deal ${dealTitleWithoutCustomer(deal.name, customer)} is ${deal.status ?? (won ? 'Won' : 'Lost')}, task still open`,
        task: { id: row.task_id, ref, title: undash(row.title), href: `/p/${row.key}/${row.number}` },
        work: `${row.key} task`,
      };
      mismatches.push({
        id: `task:${row.task_id}`,
        kind: 'deal-closed-task-open',
        tone: lost ? 'danger' : 'warning',
        ...parts,
        projectHref: `/p/${row.key}`,
        dealUrl: deal.url,
        receiptsUrl: null,
        text: mismatchText(parts),
        href: `/p/${row.key}/${row.number}`,
      });
    }
  }

  const rows = [...byCustomer.values()].sort(
    (a, b) => b.risks.length + b.lateReceipts + b.exceptions - (a.risks.length + a.lateReceipts + a.exceptions) || a.customerName.localeCompare(b.customerName),
  );
  return { available, sources, rows, mismatches: mismatches.slice(0, 6) };
}

/** True when the org has at least one live CRM deal (an entitled but empty CRM promises nothing). */
async function orgHasDeals(ctx: DomainContext): Promise<boolean> {
  try {
    const result = await db.execute<{ found: boolean }>(sql`
      select exists(
        select 1 from crm.items i join crm.boards b on b.id = i.board_id
        where i.org_id = ${ctx.orgId} and b.kind::text = 'deals' and i.deleted_at is null and b.deleted_at is null
      ) as found`);
    return Boolean(result.rows[0]?.found);
  } catch {
    return false;
  }
}

/** Deal id to its account name ("Frontier Aerospace"), from the deal's Account relation. */
async function dealAccountNames(ctx: DomainContext, dealIds: readonly string[]): Promise<Map<string, string>> {
  const valid = dealIds.filter((id) => /^[0-9a-f-]{36}$/i.test(id));
  if (valid.length === 0) return new Map();
  try {
    const result = await db.execute<{ id: string; name: string }>(sql`
      select d.id, a.name
      from crm.items d
      join crm.items a on a.id::text = d.values #>> '{account,itemIds,0}' and a.org_id = d.org_id and a.deleted_at is null
      where d.org_id = ${ctx.orgId} and d.id = any(${sql.param(valid)}::uuid[])`);
    return new Map(result.rows.map((row) => [row.id, undash(row.name)]));
  } catch {
    return new Map();
  }
}

/** Today as YYYY-MM-DD (server clock). */
function todayIsoUtc(): string {
  return new Date().toISOString().slice(0, 10);
}
