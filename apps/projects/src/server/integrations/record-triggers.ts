/**
 * Cross-app triggers (recipes): watch CRM and WMS records and start work in Projects.
 *
 *   crm_deal_won            CRM deal at a won stage          -> project from a template, linked to the deal + customer,
 *                                                               or a program (action create_program, docs/programs/SPEC.md 6.2)
 *   wms_receipt_discrepancy WMS receipt with short/over/damaged lines -> urgent task linked to the receipt
 *   wms_count_variance      cycle count off by more than X%  -> task linked to the count
 *
 * There is no job runner, so checks run lazily (throttled per org) from the automations sweep and
 * on demand ("Check now"). Each record fires a trigger at most once: pm.record_trigger_runs has a
 * unique (trigger, record) row that is claimed before any work is done. Only records changed after
 * the trigger's `since` moment are considered. Never throws from the sweep.
 */
import 'server-only';
import { and, count, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { wmsTable } from '@kitstak/db/wms-tenants';
import { isWonStage } from '@kitstak/programs-engine/deal';
import { db, getPool } from '@/server/db';
import { projects, recordTriggerRuns, recordTriggers } from '@/server/db/schema';
import type { DomainContext } from '@/server/domain/_shared';
import { invalid, notFound } from '@/server/errors';
import { PRIORITIES, type Priority } from '@/lib/constants';
import { addDaysIso, todayIso } from '@/lib/dates';
import type { ProgramWizardPayload } from '@/lib/program-types';
import { suggestProjectKey } from '@/lib/task-key';
import { routes } from '@/lib/routes';
import {
  describeRecordTrigger,
  RECORD_TRIGGER_APP,
  type CrmDealWonConfig,
  type RecordTriggerConfig,
  type RecordTriggerDTO,
  type RecordTriggerKind,
  type RecordTriggerRunDTO,
  type WmsTaskConfig,
} from '@/lib/record-trigger-types';
import { integrationAvailability, tableExists, wmsSchemaFor } from './detect';

/**
 * The deal won recipe can start a project (the default, so existing recipes are unchanged) or a
 * program (6.2). The program options sit next to the project ones in the stored config.
 */
export type DealWonAction = 'create_project' | 'create_program';
export interface DealWonConfig extends Omit<CrmDealWonConfig, 'templateId'> {
  readonly templateId?: string;
  readonly action?: DealWonAction;
  /** Program template to start from (`pm.templates` with kind `program`). */
  readonly programTemplateId?: string | null;
  /** Or copy variants, the price card and schedules from this program. */
  readonly copyProgramKey?: string | null;
}

export const dealWonAction = (config: { readonly action?: unknown }): DealWonAction => (config.action === 'create_program' ? 'create_program' : 'create_project');

const KINDS: readonly RecordTriggerKind[] = ['crm_deal_won', 'wms_receipt_discrepancy', 'wms_count_variance'];
const THROTTLE_MS = 5 * 60_000;
const MAX_PER_CHECK = 10;
const MAX_LOOKBACK_DAYS = 30;
const lastCheck = new Map<string, number>();

type TriggerRow = typeof recordTriggers.$inferSelect;

interface Candidate {
  readonly type: 'crm_item' | 'wms_receipt' | 'wms_count';
  readonly id: string;
  readonly title: string;
  /** Extra words for the task description / run message. */
  readonly detail: string;
  readonly customerId?: string | null;
}

async function domain() {
  return import('@/server/domain');
}

// ------------------------------------------------------------------------------------------
// Validation + DTOs
// ------------------------------------------------------------------------------------------

function cleanConfig(kind: RecordTriggerKind, raw: Record<string, unknown>): RecordTriggerConfig {
  const str = (value: unknown) => (typeof value === 'string' && value.trim() ? value.trim() : null);
  if (kind === 'crm_deal_won') {
    if (dealWonAction(raw) === 'create_program') {
      const programTemplateId = str(raw.programTemplateId);
      const copyProgramKey = str(raw.copyProgramKey)?.toUpperCase() ?? null;
      if (programTemplateId && copyProgramKey) throw invalid('Start from a template or copy a program, not both.', { programTemplateId: 'Pick one way to start.' });
      const config: DealWonConfig = { action: 'create_program', programTemplateId, copyProgramKey, ownerId: str(raw.ownerId) };
      return config as unknown as RecordTriggerConfig;
    }
    const templateId = str(raw.templateId);
    if (!templateId) throw invalid('Pick the template for the new project.', { templateId: 'Pick a template.' });
    return { templateId, ownerId: str(raw.ownerId), spaceId: str(raw.spaceId) } satisfies CrmDealWonConfig;
  }
  const projectId = str(raw.projectId);
  if (!projectId) throw invalid('Pick the project for the new tasks.', { projectId: 'Pick a project.' });
  const priority = (PRIORITIES as readonly string[]).includes(String(raw.priority)) ? (raw.priority as Priority) : kind === 'wms_receipt_discrepancy' ? 'urgent' : 'high';
  const dueInDays = Number.isFinite(Number(raw.dueInDays)) ? Math.min(60, Math.max(0, Math.round(Number(raw.dueInDays)))) : 1;
  const config: WmsTaskConfig = { projectId, assigneeId: str(raw.assigneeId), priority, dueInDays };
  if (kind === 'wms_count_variance') {
    const threshold = Number(raw.thresholdPercent);
    if (!Number.isFinite(threshold) || threshold < 0.1 || threshold > 100) {
      throw invalid('Set the variance limit between 0.1% and 100%.', { thresholdPercent: 'Use a number from 0.1 to 100.' });
    }
    return { ...config, thresholdPercent: Math.round(threshold * 10) / 10 };
  }
  return config;
}

function runDTO(row: typeof recordTriggerRuns.$inferSelect): RecordTriggerRunDTO {
  return {
    id: row.id,
    triggerId: row.triggerId,
    recordType: row.recordType,
    recordId: row.recordId,
    recordTitle: row.recordTitle,
    status: row.status,
    message: row.message,
    resultUrl: row.resultUrl,
    createdAt: row.createdAt.toISOString(),
  };
}

async function requireManager(ctx: DomainContext) {
  const { requireOrg } = await domain();
  requireOrg(ctx, 'project:create');
}

export async function listRecordTriggers(ctx: DomainContext): Promise<RecordTriggerDTO[]> {
  const rows = await db
    .select()
    .from(recordTriggers)
    .where(and(eq(recordTriggers.orgId, ctx.orgId), isNull(recordTriggers.deletedAt)))
    .orderBy(recordTriggers.createdAt);
  if (rows.length === 0) return [];
  const ids = rows.map((row) => row.id);
  const [runs, counts] = await Promise.all([
    db
      .select()
      .from(recordTriggerRuns)
      .where(and(eq(recordTriggerRuns.orgId, ctx.orgId), inArray(recordTriggerRuns.triggerId, ids)))
      .orderBy(desc(recordTriggerRuns.createdAt))
      .limit(60),
    db
      .select({ triggerId: recordTriggerRuns.triggerId, total: count() })
      .from(recordTriggerRuns)
      .where(and(eq(recordTriggerRuns.orgId, ctx.orgId), inArray(recordTriggerRuns.triggerId, ids), eq(recordTriggerRuns.status, 'created')))
      .groupBy(recordTriggerRuns.triggerId),
  ]);
  const { getPeople, getTemplate } = await domain();
  const projectIds = rows.map((row) => (row.config as { projectId?: string }).projectId).filter((id): id is string => Boolean(id));
  const projectNames = new Map(
    projectIds.length
      ? (await db.select({ id: projects.id, name: projects.name }).from(projects).where(and(eq(projects.orgId, ctx.orgId), inArray(projects.id, projectIds)))).map(
          (row) => [row.id, row.name] as const,
        )
      : [],
  );
  const people = await getPeople(rows.map((row) => (row.config as { assigneeId?: string }).assigneeId).filter((id): id is string => Boolean(id)));
  const templateNames = new Map<string, string>();
  for (const row of rows) {
    const templateId = (row.config as { templateId?: string }).templateId;
    if (!templateId || templateNames.has(templateId) || dealWonAction(row.config as DealWonConfig) === 'create_program') continue;
    try {
      templateNames.set(templateId, (await getTemplate(ctx, templateId)).name);
    } catch {
      templateNames.set(templateId, 'a template that was deleted');
    }
  }
  const programTemplateNames = new Map<string, string>();
  if (rows.some((row) => (row.config as DealWonConfig).programTemplateId)) {
    const { listProgramTemplates } = await import('@/server/domain/programs/templates');
    for (const template of await listProgramTemplates(ctx).catch(() => [])) programTemplateNames.set(template.id, template.name);
  }
  const totals = new Map(counts.map((entry) => [entry.triggerId, Number(entry.total)]));
  return rows.map((row) => {
    const config = row.config as unknown as RecordTriggerConfig;
    const wms = config as WmsTaskConfig;
    return {
      id: row.id,
      kind: row.kind,
      name: row.name,
      config,
      enabled: row.enabled,
      since: row.since.toISOString(),
      lastCheckedAt: row.lastCheckedAt?.toISOString() ?? null,
      createdAt: row.createdAt.toISOString(),
      sentence:
        row.kind === 'crm_deal_won' && dealWonAction(config as DealWonConfig) === 'create_program'
          ? describeProgramTrigger(config as DealWonConfig, programTemplateNames)
          : describeRecordTrigger(row.kind, config, {
              template: templateNames.get((config as CrmDealWonConfig).templateId ?? '') ?? null,
              project: wms.projectId ? (projectNames.get(wms.projectId) ?? null) : null,
              person: wms.assigneeId ? (people.get(wms.assigneeId)?.name ?? null) : null,
            }),
      runCount: totals.get(row.id) ?? 0,
      recentRuns: runs.filter((run) => run.triggerId === row.id).slice(0, 5).map(runDTO),
    };
  });
}

export interface CreateRecordTriggerInput {
  readonly kind: RecordTriggerKind;
  readonly name: string;
  readonly config: Record<string, unknown>;
  /** Also consider records changed in the last N days (0 = only from now on). */
  readonly lookbackDays?: number;
}

async function checkTargets(ctx: DomainContext, kind: RecordTriggerKind, config: RecordTriggerConfig): Promise<void> {
  const { requireProject, getTemplate, isOrgMember } = await domain();
  if (kind === 'crm_deal_won') {
    const deal = config as DealWonConfig;
    if (dealWonAction(deal) === 'create_program') {
      const programs = await import('@/server/domain/programs');
      if (deal.programTemplateId) {
        const { listProgramTemplates } = await import('@/server/domain/programs/templates');
        const found = (await listProgramTemplates(ctx)).some((template) => template.id === deal.programTemplateId);
        if (!found) throw invalid('That program template is gone. Pick another one.', { programTemplateId: 'Pick a template.' });
      }
      if (deal.copyProgramKey) await programs.requireProgram(ctx, deal.copyProgramKey);
    } else {
      await getTemplate(ctx, (config as CrmDealWonConfig).templateId);
    }
    const owner = (config as CrmDealWonConfig).ownerId;
    if (owner && !(await isOrgMember(ctx, owner))) throw invalid('Pick an owner from this workspace.', { ownerId: 'Not in this workspace.' });
    return;
  }
  const wms = config as WmsTaskConfig;
  await requireProject(ctx, { id: wms.projectId }, 'task:create');
  if (wms.assigneeId && !(await isOrgMember(ctx, wms.assigneeId))) throw invalid('Pick a teammate from this workspace.', { assigneeId: 'Not in this workspace.' });
}

export async function createRecordTrigger(ctx: DomainContext, input: CreateRecordTriggerInput): Promise<RecordTriggerDTO> {
  await requireManager(ctx);
  if (!KINDS.includes(input.kind)) throw invalid('Pick a recipe.');
  const availability = await integrationAvailability(ctx);
  if (!availability[RECORD_TRIGGER_APP[input.kind]]) {
    throw invalid(`This workspace doesn’t have KitStak ${RECORD_TRIGGER_APP[input.kind] === 'crm' ? 'CRM' : 'WMS'} yet.`);
  }
  const config = cleanConfig(input.kind, input.config);
  await checkTargets(ctx, input.kind, config);
  const lookback = Math.min(MAX_LOOKBACK_DAYS, Math.max(0, Math.round(input.lookbackDays ?? 0)));
  const name = input.name.trim().slice(0, 120) || 'Cross-app recipe';
  const [row] = await db
    .insert(recordTriggers)
    .values({
      orgId: ctx.orgId,
      kind: input.kind,
      name,
      config: config as unknown as Record<string, unknown>,
      since: new Date(Date.now() - lookback * 86_400_000),
      createdBy: ctx.userId,
    })
    .returning({ id: recordTriggers.id });
  lastCheck.delete(ctx.orgId);
  const list = await listRecordTriggers(ctx);
  const created = list.find((entry) => entry.id === row?.id);
  if (!created) throw notFound('That recipe');
  return created;
}

export async function updateRecordTrigger(
  ctx: DomainContext,
  id: string,
  patch: { readonly enabled?: boolean; readonly name?: string; readonly config?: Record<string, unknown> },
): Promise<void> {
  await requireManager(ctx);
  const [row] = await db
    .select()
    .from(recordTriggers)
    .where(and(eq(recordTriggers.id, id), eq(recordTriggers.orgId, ctx.orgId), isNull(recordTriggers.deletedAt)));
  if (!row) throw notFound('That recipe');
  let config: RecordTriggerConfig | undefined;
  if (patch.config) {
    config = cleanConfig(row.kind, { ...(row.config as Record<string, unknown>), ...patch.config });
    await checkTargets(ctx, row.kind, config);
  }
  await db
    .update(recordTriggers)
    .set({
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
      ...(patch.name?.trim() ? { name: patch.name.trim().slice(0, 120) } : {}),
      ...(config ? { config: config as unknown as Record<string, unknown> } : {}),
      updatedAt: new Date(),
    })
    .where(eq(recordTriggers.id, id));
}

export async function deleteRecordTrigger(ctx: DomainContext, id: string): Promise<void> {
  await requireManager(ctx);
  const result = await db
    .update(recordTriggers)
    .set({ deletedAt: new Date(), enabled: false })
    .where(and(eq(recordTriggers.id, id), eq(recordTriggers.orgId, ctx.orgId), isNull(recordTriggers.deletedAt)))
    .returning({ id: recordTriggers.id });
  if (result.length === 0) throw notFound('That recipe');
}

// ------------------------------------------------------------------------------------------
// Candidates
// ------------------------------------------------------------------------------------------

/**
 * Deals at a won stage, by the shared won rule (A12, engine `isWonStage`): the label's done
 * flag decides, and only a label with no flag is read by its name ("Won", "Closed won"). The SQL
 * narrows to labels that could be won; `isWonStage` makes the final call so CRM, Projects and
 * Pulse agree on every label.
 */
async function wonDeals(ctx: DomainContext, since: Date): Promise<Candidate[]> {
  const hasLinks = await tableExists('crm.customer_links');
  const result = await db.execute<{ id: string; name: string; amount: string | null; currency: string | null; customer_id: string | null; label_name: string | null; label_done: boolean | null }>(sql`
    select i.id::text as id, i.name,
           i.values #>> '{deal_value,amount}' as amount, i.values #>> '{deal_value,currency}' as currency,
           ${hasLinks ? sql`(select cl.core_customer_id::text from crm.customer_links cl
              where cl.org_id = i.org_id and cl.item_id::text = i.values #>> '{account,itemIds,0}' limit 1)` : sql`null::text`} as customer_id,
           stage.name as label_name, stage.done as label_done
    from crm.items i join crm.boards b on b.id = i.board_id
    cross join lateral (
      select label ->> 'name' as name,
             case when jsonb_typeof(label -> 'isDone') = 'boolean' then (label ->> 'isDone')::boolean end as done
        from crm.columns c, jsonb_array_elements(case when jsonb_typeof(c.settings -> 'labels') = 'array' then c.settings -> 'labels' else '[]'::jsonb end) label
       where c.board_id = b.id and c.key = 'stage' and c.deleted_at is null
         and label ->> 'id' = i.values #>> '{stage,labelId}'
       limit 1
    ) stage
    where i.org_id = ${ctx.orgId} and b.kind::text = 'deals' and i.deleted_at is null and i.archived_at is null
      and i.parent_item_id is null and i.updated_at >= ${since.toISOString()}::timestamptz
      and (stage.done is true or (stage.done is null and stage.name ~* '\\mwon\\M'))
    order by i.updated_at limit 50`);
  return result.rows
    .filter((row) => isWonStage({ isDone: row.label_done, name: row.label_name }))
    .map((row) => {
      const amount = row.amount ? Number(row.amount) : null;
      const value =
        amount !== null && Number.isFinite(amount)
          ? new Intl.NumberFormat('en-US', { style: 'currency', currency: row.currency || 'USD', maximumFractionDigits: 0 }).format(amount)
          : null;
      return { type: 'crm_item', id: row.id, title: row.name, detail: value ? `Deal value ${value}` : 'Deal won', customerId: row.customer_id };
    });
}

async function discrepantReceipts(schema: string, since: Date): Promise<Candidate[]> {
  const result = await db.execute<{ id: string; code: string; vendor: string | null; short_lines: number; over_lines: number; damaged: number; lines: number }>(sql`
    select po.id, po.code, po.vendor_name as vendor,
           count(*) filter (where l.received_quantity > 0 and l.received_quantity < l.ordered_quantity)::int as short_lines,
           count(*) filter (where l.received_quantity > l.ordered_quantity)::int as over_lines,
           coalesce(sum(l.damaged_quantity), 0)::int as damaged,
           count(*)::int as lines
    from ${wmsTable(schema, 'purchase_orders')} po join ${wmsTable(schema, 'purchase_order_lines')} l on l.purchase_order_id = po.id
    where po.status not in ('Pending', 'Cancelled') and po.updated_at >= ${since.toISOString()}
    group by po.id, po.code, po.vendor_name
    having count(*) filter (where l.damaged_quantity > 0 or (l.received_quantity > 0 and l.received_quantity <> l.ordered_quantity)) > 0
    order by max(po.updated_at) limit 50`);
  return result.rows.map((row) => {
    const parts = [
      row.short_lines ? `${row.short_lines} ${row.short_lines === 1 ? 'line' : 'lines'} short` : null,
      row.over_lines ? `${row.over_lines} ${row.over_lines === 1 ? 'line' : 'lines'} over` : null,
      row.damaged ? `${row.damaged} damaged ${row.damaged === 1 ? 'unit' : 'units'}` : null,
    ].filter(Boolean);
    return {
      type: 'wms_receipt',
      id: row.id,
      title: `${row.code}${row.vendor ? ` from ${row.vendor}` : ''}`,
      detail: parts.join(', ') || 'Quantities do not match the purchase order',
    };
  });
}

async function varianceCounts(schema: string, since: Date, thresholdPercent: number): Promise<Candidate[]> {
  const result = await db.execute<{ id: string; code: string; description: string | null; pct: number; off_lines: number }>(sql`
    select cp.id, cp.code, cp.description,
           (sum(abs(l.counted_qty - l.initial_stock_qty))::float / nullif(sum(l.initial_stock_qty), 0) * 100) as pct,
           count(*) filter (where l.counted_qty <> l.initial_stock_qty)::int as off_lines
    from ${wmsTable(schema, 'count_plans')} cp join ${wmsTable(schema, 'count_plan_lines')} l on l.plan_id = cp.id
    where cp.status in ('Count Completed', 'Inventory Updated', 'Completed') and cp.updated_at >= ${since.toISOString()}
      and l.counted_qty is not null and not l.is_recount_line
    group by cp.id, cp.code, cp.description
    having (sum(abs(l.counted_qty - l.initial_stock_qty))::float / nullif(sum(l.initial_stock_qty), 0) * 100) > ${thresholdPercent}
    order by max(cp.updated_at) limit 50`);
  return result.rows.map((row) => ({
    type: 'wms_count',
    id: row.id,
    title: `${row.code}${row.description ? ` ${row.description}` : ''}`,
    detail: `Off by ${Number(row.pct).toFixed(Number(row.pct) < 1 ? 2 : 1)}% on ${row.off_lines} ${row.off_lines === 1 ? 'line' : 'lines'} (limit ${thresholdPercent}%)`,
  }));
}

// ------------------------------------------------------------------------------------------
// Firing
// ------------------------------------------------------------------------------------------

/** Claims (trigger, record); false when it already fired. */
async function claim(ctx: DomainContext, trigger: TriggerRow, candidate: Candidate): Promise<string | null> {
  const rows = await db
    .insert(recordTriggerRuns)
    .values({
      orgId: ctx.orgId,
      triggerId: trigger.id,
      recordType: candidate.type,
      recordId: candidate.id,
      recordTitle: candidate.title.replace(/\s*[\u2014\u2013]\s*/g, ' · ').slice(0, 300),
      status: 'skipped',
      message: 'Working on it',
    })
    .onConflictDoNothing()
    .returning({ id: recordTriggerRuns.id });
  return rows[0]?.id ?? null;
}

/** Records the outcome; resolves true when new work was created. */
async function finish(runId: string, status: 'created' | 'skipped' | 'failed', message: string, resultUrl: string | null = null): Promise<boolean> {
  await db.update(recordTriggerRuns).set({ status, message: message.slice(0, 500), resultUrl }).where(eq(recordTriggerRuns.id, runId));
  return status === 'created';
}

async function fireDealWon(ctx: DomainContext, config: CrmDealWonConfig, candidate: Candidate, runId: string): Promise<boolean> {
  if (dealWonAction(config as DealWonConfig) === 'create_program') return fireDealWonProgram(ctx, config as DealWonConfig, candidate, runId);
  const existing = await db.execute<{ key: string }>(sql`
    select p.key from pm.projects p
    where p.org_id = ${ctx.orgId} and p.deleted_at is null and p.kind = 'project'
      and (p.crm_item_id::text = ${candidate.id}
        or exists (select 1 from pm.integration_links l where l.project_id = p.id and l.task_id is null
                     and l.target_type = 'crm_item' and l.target_id = ${candidate.id}))
    limit 1`);
  const already = existing.rows[0]?.key;
  if (already) return finish(runId, 'skipped', `This deal already has project ${already}`, routes.project(already));
  const { instantiateTemplate, addLink } = await domain();
  const project = await instantiateTemplate(ctx, config.templateId, {
    name: candidate.title.replace(/\s*[\u2014\u2013]\s*/g, ': ').slice(0, 120),
    spaceId: config.spaceId ?? null,
    ownerId: config.ownerId ?? null,
    crmItemId: candidate.id,
    crmCustomerId: candidate.customerId ?? null,
    startDate: todayIso(),
  });
  try {
    await addLink(ctx, { projectId: project.id, targetType: 'crm_item', targetId: candidate.id });
  } catch {
    // The project already points at the deal through crm_item_id; the link is a nicety.
  }
  return finish(runId, 'created', `Created project ${project.key} from the won deal`, routes.project(project.key));
}

/** The live program already made from this deal (a `created_from` edge or the program's deal pointer), if any. */
async function programFromDeal(ctx: DomainContext, dealId: string): Promise<string | null> {
  const hasLinks = await tableExists('core.record_links');
  const result = await db.execute<{ key: string }>(sql`
    select p.key from pm.projects p
     where p.org_id = ${ctx.orgId} and p.kind = 'program' and p.deleted_at is null
       and (p.crm_item_id::text = ${dealId}
         ${
           hasLinks
             ? sql`or exists (select 1 from core.record_links l where l.org_id = p.org_id and l.relation = 'created_from'
                     and ((l.from_type = 'pm_program' and l.from_id = p.id::text and l.to_type = 'crm_deal' and l.to_id = ${dealId})
                       or (l.to_type = 'pm_program' and l.to_id = p.id::text and l.from_type = 'crm_deal' and l.from_id = ${dealId})))`
             : sql``
         })
     order by p.created_at limit 1`);
  return result.rows[0]?.key ?? null;
}

/**
 * The wizard payload for a program started by the recipe: the deal's prefill (name, customer,
 * dates, rates and links), with the variants, schedule and card of the template or the copied
 * program when the recipe names one. Deal rates win over the template's card when the deal has any.
 */
async function programPayloadFor(ctx: DomainContext, config: DealWonConfig, candidate: Candidate): Promise<ProgramWizardPayload> {
  const { wizardPrefill } = await import('@/server/domain/programs/prefill');
  const deal = await wizardPrefill(ctx, { crmItemId: candidate.id });
  const name = candidate.title.replace(/\s*[\u2014\u2013]\s*/g, ': ').slice(0, 120);
  const owner = config.ownerId ?? ctx.userId;
  const base: ProgramWizardPayload = { ...deal, basics: { ...deal.basics, name: deal.basics.name || name, ownerId: owner } };
  const source = config.programTemplateId
    ? await wizardPrefill(ctx, { templateId: config.programTemplateId })
    : config.copyProgramKey
      ? await wizardPrefill(ctx, { copyKey: config.copyProgramKey })
      : null;
  if (!source) return base;
  const dealHasRates = base.priceCard.lines.length > 0;
  return {
    ...base,
    basics: {
      ...base.basics,
      unit: source.basics.unit,
      calendar: source.basics.calendar,
      color: source.basics.color,
      icon: source.basics.icon,
      monthlyTargetCents: base.basics.monthlyTargetCents ?? source.basics.monthlyTargetCents,
    },
    variants: source.variants,
    priceCard: dealHasRates
      ? base.priceCard
      : { ...source.priceCard, effectiveFrom: base.priceCard.effectiveFrom, oneTime: [...base.priceCard.oneTime, ...source.priceCard.oneTime] },
    schedule: source.schedule.enabled ? { ...source.schedule, startsOn: base.basics.startDate } : base.schedule,
    links: { ...base.links, members: source.links.members },
  };
}

function isKeyClash(error: unknown): boolean {
  const fields = (error as { fields?: Record<string, string> } | null)?.fields;
  if (fields && ('basics.key' in fields || 'key' in fields)) return true;
  const pg = (error as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } } | null) ?? null;
  const constraint = pg?.constraint ?? pg?.cause?.constraint;
  return (pg?.code === '23505' || pg?.cause?.code === '23505') && (constraint === undefined || /key/.test(constraint));
}

/**
 * Starts a program from a won deal (6.2). Idempotent: a session advisory lock per deal (held on
 * its own connection while the program is made) lets one firing work at a time, and the check
 * for a program already made from the deal runs under that lock, so duplicate or retried events
 * make one program. A key taken in the meantime retries with the next suggested key, up to 5 times.
 */
async function fireDealWonProgram(ctx: DomainContext, config: DealWonConfig, candidate: Candidate, runId: string): Promise<boolean> {
  const lockKey = `program-from-deal-recipe:${candidate.id}`;
  const client = await lockDeal(lockKey);
  try {
    const already = await programFromDeal(ctx, candidate.id);
    if (already) return finish(runId, 'skipped', `This deal already has program ${already}`, routes.program(already));
    const programs = await import('@/server/domain/programs');
    const payload = await programPayloadFor(ctx, config, candidate);
    const taken = new Set((await programs.takenKeys(ctx)).map((key) => key.toUpperCase()));
    let key = payload.basics.key && !taken.has(payload.basics.key.toUpperCase()) ? payload.basics.key : suggestProjectKey(payload.basics.name, taken);
    for (let attempt = 0; ; attempt += 1) {
      try {
        const created = await programs.createProgram(ctx, { ...payload, basics: { ...payload.basics, key } }, { versionSource: 'crm_deal' });
        const builds = created.generated.builds;
        const made = builds > 0 ? ` with ${builds} planned ${builds === 1 ? 'build' : 'builds'}` : '';
        return finish(runId, 'created', `Started program ${created.key} from the won deal${made}`, routes.program(created.key));
      } catch (error) {
        if (attempt >= 4 || !isKeyClash(error)) throw error;
        taken.add(key.toUpperCase());
        key = suggestProjectKey(payload.basics.name, taken);
      }
    }
  } finally {
    await client.query('select pg_advisory_unlock(hashtext($1))', [lockKey]).catch(() => undefined);
    client.release();
  }
}

const LOCK_WAIT_MS = 30_000;

/**
 * Takes the per deal session lock on a connection of its own and returns that connection. A
 * firing that has to wait gives its connection back between tries, so waiting never uses up
 * the pool the program create needs.
 */
async function lockDeal(lockKey: string) {
  const started = Date.now();
  for (;;) {
    const client = await getPool().connect();
    try {
      const result = await client.query<{ ok: boolean }>('select pg_try_advisory_lock(hashtext($1)) as ok', [lockKey]);
      if (result.rows[0]?.ok === true) return client;
    } catch (error) {
      client.release();
      throw error;
    }
    client.release();
    if (Date.now() - started > LOCK_WAIT_MS) throw new Error('Another check is starting a program from this deal. Try again in a minute.');
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** Test hook: fire the deal won recipe for one deal as the given actor (6.2 concurrency test). */
export async function fireDealWonForTest(ctx: DomainContext, config: DealWonConfig, deal: { readonly id: string; readonly title: string }, runId: string): Promise<boolean> {
  return fireDealWon(ctx, config as unknown as CrmDealWonConfig, { type: 'crm_item', id: deal.id, title: deal.title, detail: 'Deal won' }, runId);
}

function describeProgramTrigger(config: DealWonConfig, templateNames: ReadonlyMap<string, string>): string {
  if (config.programTemplateId) return `When a CRM deal is won, start a program from ${templateNames.get(config.programTemplateId) ?? 'a program template'}`;
  if (config.copyProgramKey) return `When a CRM deal is won, start a program copied from ${config.copyProgramKey}`;
  return "When a CRM deal is won, start a program with the deal's rates";
}

async function fireWmsTask(ctx: DomainContext, kind: RecordTriggerKind, config: WmsTaskConfig, candidate: Candidate, runId: string): Promise<boolean> {
  const { createTask, addLink, requireProject } = await domain();
  const { project } = await requireProject(ctx, { id: config.projectId }, 'task:create');
  const title =
    kind === 'wms_receipt_discrepancy'
      ? `Resolve receipt discrepancy on ${candidate.title}`
      : `Investigate count variance on ${candidate.title}`;
  const description =
    kind === 'wms_receipt_discrepancy'
      ? `<p>${escapeHtml(candidate.detail)}.</p><p>Check the lines against the packing slip, file a vendor claim if needed, and correct inventory in WMS.</p>`
      : `<p>${escapeHtml(candidate.detail)}.</p><p>Recount the lines that are off, look for mispicks or misplaced stock, then approve or adjust the count in WMS.</p>`;
  const task = await createTask(ctx, {
    projectId: project.id,
    title: title.slice(0, 250),
    description,
    priority: config.priority ?? (kind === 'wms_receipt_discrepancy' ? 'urgent' : 'high'),
    assigneeId: config.assigneeId ?? null,
    dueDate: addDaysIso(todayIso(), config.dueInDays ?? 1),
    at: 'top',
  });
  try {
    await addLink(ctx, { taskId: task.id, targetType: candidate.type, targetId: candidate.id });
  } catch (error) {
    console.warn('[projects] recipe could not link the WMS record', error);
  }
  return finish(runId, 'created', `Created ${task.key}: ${candidate.detail}`, routes.task(project.key, task.number));
}

function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char);
}

/** WMS recipes read the org's own warehouse schema; an org without an active warehouse has nothing to check. */
async function wmsCandidates(ctx: DomainContext, kind: RecordTriggerKind, config: WmsTaskConfig, since: Date): Promise<Candidate[]> {
  const schema = await wmsSchemaFor(ctx);
  if (!schema) return [];
  return kind === 'wms_receipt_discrepancy' ? discrepantReceipts(schema, since) : varianceCounts(schema, since, config.thresholdPercent ?? 2);
}

async function runTrigger(ctx: DomainContext, trigger: TriggerRow): Promise<number> {
  const config = trigger.config as unknown as RecordTriggerConfig;
  const candidates = trigger.kind === 'crm_deal_won' ? await wonDeals(ctx, trigger.since) : await wmsCandidates(ctx, trigger.kind, config as WmsTaskConfig, trigger.since);
  if (candidates.length === 0) return 0;
  const done = new Set(
    (
      await db
        .select({ recordId: recordTriggerRuns.recordId })
        .from(recordTriggerRuns)
        .where(and(eq(recordTriggerRuns.triggerId, trigger.id), inArray(recordTriggerRuns.recordId, candidates.map((entry) => entry.id))))
    ).map((row) => row.recordId),
  );
  let fired = 0;
  // Act as the person who set the recipe up (project owner, task reporter), labelled "Automation".
  const actor: DomainContext = {
    ...ctx,
    userId: trigger.createdBy ?? ctx.userId,
    userName: 'Automation',
    orgRole: 'owner',
    actorKind: 'automation',
    automationDepth: 1,
  };
  for (const candidate of candidates) {
    if (fired >= MAX_PER_CHECK) break;
    if (done.has(candidate.id)) continue;
    const runId = await claim(ctx, trigger, candidate);
    if (!runId) continue;
    try {
      const created =
        trigger.kind === 'crm_deal_won'
          ? await fireDealWon(actor, config as CrmDealWonConfig, candidate, runId)
          : await fireWmsTask(actor, trigger.kind, config as WmsTaskConfig, candidate, runId);
      if (created) fired += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Something went wrong';
      await finish(runId, 'failed', `Couldn’t start the work: ${message}`);
    }
  }
  return fired;
}

/**
 * Checks every enabled recipe of the org. Throttled to once every 5 minutes per org unless
 * `force`. Returns how many records started work. Never throws.
 */
export async function runRecordTriggers(ctx: DomainContext, options: { readonly force?: boolean; readonly triggerId?: string } = {}): Promise<number> {
  const now = Date.now();
  if (!options.force && now - (lastCheck.get(ctx.orgId) ?? 0) < THROTTLE_MS) return 0;
  lastCheck.set(ctx.orgId, now);
  if (lastCheck.size > 5000) lastCheck.clear();
  try {
    if (!(await tableExists('pm.record_triggers'))) return 0;
    const rows = await db
      .select()
      .from(recordTriggers)
      .where(
        and(
          eq(recordTriggers.orgId, ctx.orgId),
          eq(recordTriggers.enabled, true),
          isNull(recordTriggers.deletedAt),
          options.triggerId ? eq(recordTriggers.id, options.triggerId) : undefined,
        ),
      );
    if (rows.length === 0) return 0;
    const availability = await integrationAvailability(ctx);
    let fired = 0;
    for (const row of rows) {
      if (!availability[RECORD_TRIGGER_APP[row.kind]]) continue;
      try {
        fired += await runTrigger(ctx, row);
      } catch (error) {
        console.error('[projects] recipe check failed', row.id, error);
      }
      await db.update(recordTriggers).set({ lastCheckedAt: new Date() }).where(eq(recordTriggers.id, row.id));
    }
    return fired;
  } catch (error) {
    console.error('[projects] recipe sweep failed', error);
    return 0;
  }
}

/** Orgs with at least one enabled recipe (for the cron route; capped). */
export async function orgsWithRecordTriggers(limit = 200): Promise<string[]> {
  try {
    if (!(await tableExists('pm.record_triggers'))) return [];
    const rows = await db
      .selectDistinct({ orgId: recordTriggers.orgId })
      .from(recordTriggers)
      .where(and(eq(recordTriggers.enabled, true), isNull(recordTriggers.deletedAt)))
      .limit(limit);
    return rows.map((row) => row.orgId);
  } catch {
    return [];
  }
}
