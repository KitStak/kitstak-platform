/**
 * Live sibling records for chips and the link dialog: what a linked CRM deal, work order or
 * project looks like right now, and a search over the records a job can be linked to.
 * Fail soft: an app that cannot be read gives `state: 'offline'`, a deleted record `gone`.
 */
import 'server-only';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { db } from '@/server/db';
import { jobLinks, jobs } from '@/server/db/schema';
import { appUrls } from '@/server/env';
import type { DomainContext } from '@/server/domain/_shared';
import type { LinkTargetType } from '@/lib/constants';
import { appOfTarget, type LinkableType, type LiveRecordDTO, type RecordOptionDTO, type RecordTone } from '@/features/integrations/types';
import { crmReady, getAccounts, getDeals, searchDeals, type CrmDeal } from './crm';
import { getProjects, projectsReady, searchProjects, type PmProject } from './projects';
import { listWorkOrders, wmsReady, type WmsWorkOrder } from './wms';
import { logSoftFail } from './log';

export interface RecordTarget {
  readonly type: LinkTargetType;
  readonly id: string;
}

function absolute(type: LinkTargetType, path: string | null): string | null {
  if (!path || !path.startsWith('/') || path.startsWith('//')) return null;
  const urls = appUrls();
  const app = appOfTarget(type);
  return `${urls[app].replace(/\/+$/, '')}${path}`;
}

const dealTone = (deal: CrmDeal): RecordTone => (deal.won ? 'good' : deal.lost ? 'bad' : 'info');

function workOrderTone(status: string): RecordTone {
  if (status === 'Completed') return 'good';
  if (status === 'Shortage') return 'bad';
  if (status === 'Cancelled') return 'quiet';
  return 'info';
}

const PROJECT_HEALTH: Readonly<Record<string, string>> = { on_track: 'On track', at_risk: 'At risk', off_track: 'Off track' };
const PROJECT_STATUS: Readonly<Record<string, string>> = { planning: 'Planning', active: 'Active', on_hold: 'On hold', completed: 'Completed', archived: 'Archived' };

function projectStatus(project: PmProject): { status: string; tone: RecordTone } {
  if (project.status === 'completed' || project.status === 'archived') return { status: PROJECT_STATUS[project.status] ?? project.status, tone: project.status === 'completed' ? 'good' : 'quiet' };
  if (project.status === 'on_hold' || project.status === 'planning') return { status: PROJECT_STATUS[project.status] ?? project.status, tone: 'quiet' };
  return { status: PROJECT_HEALTH[project.health] ?? 'Active', tone: project.health === 'off_track' ? 'bad' : project.health === 'at_risk' ? 'warn' : 'good' };
}

const workOrderDetail = (order: WmsWorkOrder): string => `${order.finishedQty} of ${order.requestedQty} kits built`;

/** The linked records as they are right now, in the order asked. */
export async function resolveRecords(ctx: DomainContext, targets: readonly RecordTarget[]): Promise<LiveRecordDTO[]> {
  const of = (type: LinkTargetType): string[] => targets.filter((target) => target.type === type).map((target) => target.id);
  const [crm, wms, projects] = await Promise.all([crmReady(ctx), wmsReady(ctx).then((schema) => schema !== null), projectsReady(ctx)]);
  const [deals, accounts, orders, found] = await Promise.all([
    crm ? getDeals(ctx, of('crm_deal')) : Promise.resolve([]),
    crm ? getAccounts(ctx, of('crm_account')) : Promise.resolve([]),
    wms ? listWorkOrders(ctx, { ids: of('wms_work_order') }) : Promise.resolve([]),
    projects ? getProjects(ctx, of('pm_project')) : Promise.resolve([]),
  ]);
  const ready = { crm, wms, projects };
  return targets.map((target): LiveRecordDTO => {
    const app = appOfTarget(target.type);
    const base = { type: target.type, id: target.id, app };
    if (!ready[app]) return { ...base, state: 'offline', title: null, status: null, tone: 'quiet', detail: null, url: null };
    if (target.type === 'crm_deal') {
      const deal = deals.find((item) => item.id === target.id);
      if (deal) return { ...base, state: 'live', title: deal.name, status: deal.stage, tone: dealTone(deal), detail: deal.accountName, url: absolute(target.type, deal.path) };
    } else if (target.type === 'crm_account') {
      const account = accounts.find((item) => item.id === target.id);
      if (account) return { ...base, state: 'live', title: account.name, status: account.health, tone: 'info', detail: null, url: absolute(target.type, account.path) };
    } else if (target.type === 'wms_work_order') {
      const order = orders.find((item) => item.id === target.id);
      if (order) return { ...base, state: 'live', title: `${order.code}${order.kitName ? ` ${order.kitName}` : ''}`, status: order.status, tone: workOrderTone(order.status), detail: workOrderDetail(order), url: absolute(target.type, order.path) };
    } else if (target.type === 'pm_project') {
      const project = found.find((item) => item.id === target.id);
      if (project) {
        const { status, tone } = projectStatus(project);
        return { ...base, state: 'live', title: project.name, status, tone, detail: project.percentDone === null ? null : `${project.percentDone}% of tasks done`, url: absolute(target.type, project.path) };
      }
    } else {
      // Shipment orders, warehouse clients and project tasks keep the copy stored on the link.
      return { ...base, state: 'offline', title: null, status: null, tone: 'quiet', detail: null, url: null };
    }
    return { ...base, state: 'gone', title: null, status: null, tone: 'quiet', detail: null, url: null };
  });
}

/** Which of these records already have a job, by record id. */
async function linkedJobs(ctx: DomainContext, type: LinkableType, ids: readonly string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (ids.length === 0) return out;
  const found = await db
    .select({ targetId: jobLinks.targetId, number: jobs.number })
    .from(jobLinks)
    .innerJoin(jobs, eq(jobs.id, jobLinks.jobId))
    .where(and(eq(jobLinks.orgId, ctx.orgId), eq(jobLinks.targetType, type), inArray(jobLinks.targetId, [...ids]), isNull(jobs.deletedAt)));
  for (const row of found) if (!out.has(row.targetId)) out.set(row.targetId, row.number);
  return out;
}

/** Records of one kind that match the text, for the link dialog. Empty when the app cannot be read. */
export async function searchRecords(ctx: DomainContext, type: LinkableType, query: string, limit = 12): Promise<RecordOptionDTO[]> {
  try {
    let options: Omit<RecordOptionDTO, 'linkedJobNumber'>[] = [];
    if (type === 'crm_deal') {
      options = (await searchDeals(ctx, query, limit)).map((deal) => ({ type, id: deal.id, title: deal.name, subtitle: deal.accountName, status: deal.stage, tone: dealTone(deal), path: deal.path }));
    } else if (type === 'wms_work_order') {
      options = (await listWorkOrders(ctx, { query, limit })).map((order) => ({
        type,
        id: order.id,
        title: `${order.code}${order.kitName ? ` ${order.kitName}` : ''}`,
        subtitle: [order.clientName, workOrderDetail(order)].filter(Boolean).join(' · '),
        status: order.status,
        tone: workOrderTone(order.status),
        path: order.path,
      }));
    } else {
      options = (await searchProjects(ctx, query, limit)).map((project) => ({ type, id: project.id, title: project.name, subtitle: project.key, ...projectStatus(project), path: project.path }));
    }
    const linked = await linkedJobs(ctx, type, options.map((option) => option.id));
    return options.map((option) => ({ ...option, linkedJobNumber: linked.get(option.id) ?? null }));
  } catch (error) {
    logSoftFail(ctx.orgId, 'records.searchRecords', error);
    return [];
  }
}
