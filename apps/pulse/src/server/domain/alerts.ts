/**
 * Alert rules, alert evaluation and the alert inbox (SPEC 5.4).
 *
 * A condition makes one alert (`dedupe_key`), updates it while it lasts and resolves it by itself
 * when it clears. A dismissed alert stays quiet while its condition lasts. Alerts store
 * `{ kind, params }`; title, body and next step are worded per reader at read time.
 */
import 'server-only';
import { and, asc, desc, eq, inArray, isNull, sql, type SQL } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { alertRules, alerts } from '@/server/db/schema';
import { conflict, invalid, notFound } from '@/server/errors';
import { ALERT_KINDS, type AlertEntityType, type AlertKind, type AlertSeverity, type AlertStatus } from '@/lib/constants';
import { addDays, endOfMonth, startOfMonth } from '@/lib/profit';
import type { AlertDTO, AlertRuleDTO } from '@/lib/types';
import { cleanText, defined, diff, inTx, iso, isoRequired, isUuid, moneyOut, monthName, rows, singular, todayInZone, uuidArray, type DomainContext } from './_shared';
import { softDeleteRow } from './_crud';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';
import { liveJobAlert, renderAlertWords, type LiveReason } from './alert-words';
import { isQuietNow, quietOf } from '@/features/alerts/quiet-hours';
import { filterOrgMembers } from './people';
import { notify } from './notifications';
import { userIdsWithRoles } from './roles';
import { loadSettings } from './settings';

type RuleRow = typeof alertRules.$inferSelect;
type AlertRow = typeof alerts.$inferSelect;

function toRuleDTO(row: RuleRow): AlertRuleDTO {
  return { id: row.id, name: row.name, kind: row.kind as AlertKind, threshold: row.threshold, scope: row.scope ?? {}, severity: row.severity as AlertSeverity, notifyRoles: row.notifyRoles, notifyUserIds: row.notifyUserIds, enabled: row.enabled, isSystem: row.isSystem };
}

export async function listAlertRules(ctx: DomainContext): Promise<AlertRuleDTO[]> {
  await requirePulse(ctx, 'pulse:read');
  await loadSettings(ctx.orgId);
  const found = await db.select().from(alertRules).where(and(eq(alertRules.orgId, ctx.orgId), isNull(alertRules.deletedAt))).orderBy(desc(alertRules.isSystem), asc(alertRules.createdAt));
  return found.map(toRuleDTO);
}

export interface AlertRuleInput {
  name: string;
  kind: AlertKind;
  /** Money thresholds are in currency units, margin thresholds in percent, day thresholds in days. */
  threshold?: string | null;
  scope?: { clientId?: string | null; jobTypeId?: string | null; siteId?: string | null };
  severity?: AlertSeverity;
  notifyRoles?: string[];
  notifyUserIds?: string[];
  enabled?: boolean;
}

export async function createAlertRule(ctx: DomainContext, input: AlertRuleInput): Promise<AlertRuleDTO> {
  await requirePulse(ctx, 'alert:manage');
  const name = cleanText(input.name);
  if (!name) throw invalid('Give the rule a name.', { name: 'Give the rule a name.' });
  if (!(ALERT_KINDS as readonly string[]).includes(input.kind)) throw invalid('Pick what the rule watches.');
  return inTx(async (tx) => {
    const [row] = await tx
      .insert(alertRules)
      .values({
        orgId: ctx.orgId,
        name,
        kind: input.kind,
        threshold: input.threshold ?? null,
        scope: defined(input.scope ?? {}),
        severity: input.severity ?? 'warning',
        notifyRoles: input.notifyRoles ?? ['owner', 'admin', 'manager'],
        notifyUserIds: await filterOrgMembers(ctx, input.notifyUserIds ?? [], tx),
        enabled: input.enabled ?? true,
        createdBy: ctx.userId,
      })
      .returning();
    await logActivity(tx, ctx, { verb: 'alert_rule.created', entityType: 'alert_rule', entityId: row!.id, after: { name, kind: input.kind, severity: row!.severity, enabled: row!.enabled } });
    return toRuleDTO(row!);
  });
}

export async function updateAlertRule(ctx: DomainContext, ruleId: string, patch: Partial<AlertRuleInput>): Promise<AlertRuleDTO> {
  await requirePulse(ctx, 'alert:manage');
  return inTx(async (tx) => {
    const [before] = isUuid(ruleId) ? await tx.select().from(alertRules).where(and(eq(alertRules.orgId, ctx.orgId), eq(alertRules.id, ruleId), isNull(alertRules.deletedAt))) : [];
    if (!before) throw notFound('That rule');
    const values = defined({
      name: patch.name === undefined ? undefined : (cleanText(patch.name) ?? before.name),
      kind: before.isSystem ? undefined : patch.kind,
      threshold: patch.threshold,
      scope: patch.scope === undefined ? undefined : defined(patch.scope),
      severity: patch.severity,
      notifyRoles: patch.notifyRoles,
      notifyUserIds: patch.notifyUserIds === undefined ? undefined : await filterOrgMembers(ctx, patch.notifyUserIds, tx),
      enabled: patch.enabled,
    });
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (!change) return toRuleDTO(before);
    const [row] = await tx.update(alertRules).set({ ...values, updatedAt: new Date() }).where(eq(alertRules.id, before.id)).returning();
    await logActivity(tx, ctx, { verb: 'alert_rule.updated', entityType: 'alert_rule', entityId: before.id, ...change });
    return toRuleDTO(row!);
  });
}

/** Deletes a rule a person made. System rules can only be turned off. */
export async function deleteAlertRule(ctx: DomainContext, ruleId: string): Promise<void> {
  await requirePulse(ctx, 'alert:manage');
  await inTx(async (tx) => {
    const [before] = isUuid(ruleId) ? await tx.select().from(alertRules).where(and(eq(alertRules.orgId, ctx.orgId), eq(alertRules.id, ruleId), isNull(alertRules.deletedAt))) : [];
    if (!before) throw notFound('That rule');
    if (before.isSystem) throw conflict('This rule comes with Pulse. Turn it off instead.');
    await softDeleteRow(tx, ctx.orgId, 'alert_rules', ruleId, 'That rule');
    await logActivity(tx, ctx, { verb: 'alert_rule.deleted', entityType: 'alert_rule', entityId: ruleId, before: { name: before.name, kind: before.kind } });
  });
}

/* ---------------------------------------------------------------- evaluation */

interface Candidate {
  rule: RuleRow;
  kind: string;
  entityType: AlertEntityType;
  entityId: string;
  params: Record<string, unknown>;
  impactCents: bigint | null;
  url: string | null;
  jobId: string | null;
}

interface JobSignal {
  id: string;
  number: string;
  name: string;
  unit_label: string;
  client_id: string;
  job_type_id: string;
  site_id: string;
  risk_status: string | null;
  risk_reasons: { rule: string; params: Record<string, unknown>; impactCents: number | null; nextStep: string | null }[];
  projected_margin_bp: number | null;
  not_billed: string;
  last_entry_date: string | null;
}

/** Which stored risk rules raise which alert kind. */
const RULES_FOR_KIND: Readonly<Record<string, readonly string[]>> = {
  labor_over_budget: ['R3', 'W2'],
  material_over_budget: ['W4'],
  productivity_below: ['R4', 'W3'],
  no_entry_days: ['W5'],
  due_soon_behind: ['R5', 'W6'],
  missing_rate: ['D3'],
  missing_price: ['D2'],
  missing_hours: ['D1'],
  wms_shortage: ['R6'],
};

/** Kinds this module evaluates. Others (imports, sync, deals) are raised by their own modules with `raiseAlert`. */
const EVALUATED_KINDS: readonly string[] = ['job_losing', 'job_at_risk', 'margin_below', 'unbilled_above', 'client_margin_below', 'vas_margin_below', 'missing_time_above', 'overhead_rate_off', 'month_ready_to_close', ...Object.keys(RULES_FOR_KIND)];

const inScope = (rule: RuleRow, job: JobSignal): boolean => {
  const scope = (rule.scope ?? {}) as { clientId?: string; jobTypeId?: string; siteId?: string };
  return (!scope.clientId || scope.clientId === job.client_id) && (!scope.jobTypeId || scope.jobTypeId === job.job_type_id) && (!scope.siteId || scope.siteId === job.site_id);
};

async function collect(executor: Executor, ctx: DomainContext, rules: readonly RuleRow[]): Promise<Candidate[]> {
  const settings = await loadSettings(ctx.orgId, executor);
  const today = todayInZone(settings.timezone);
  const out: Candidate[] = [];
  const jobs = await rows<JobSignal>(
    executor,
    sql`SELECT j.id, j.number, j.name, j.unit_label, j.client_id, j.job_type_id, j.site_id, st.risk_status, st.risk_reasons, st.projected_margin_bp,
               (st.revenue_cents - st.billed_cents)::text AS not_billed, to_char(st.last_entry_date, 'YYYY-MM-DD') AS last_entry_date
          FROM pulse.jobs j JOIN pulse.job_stats st ON st.job_id = j.id
         WHERE j.org_id = ${ctx.orgId} AND j.deleted_at IS NULL AND j.archived_at IS NULL AND j.status IN ('active', 'completed')`,
  );
  const jobCandidate = (rule: RuleRow, job: JobSignal, reason: JobSignal['risk_reasons'][number] | undefined, extra: Record<string, unknown> = {}): Candidate => ({
    rule,
    kind: rule.kind,
    entityType: 'job',
    entityId: job.id,
    params: { jobId: job.id, jobNumber: job.number, jobName: job.name, unitLabel: singular(job.unit_label), rule: reason?.rule ?? null, reason: reason?.params ?? {}, nextStep: reason?.nextStep ?? null, ...extra },
    impactCents: reason?.impactCents === null || reason?.impactCents === undefined ? null : BigInt(Math.round(reason.impactCents)),
    url: `/jobs/${encodeURIComponent(job.number)}`,
    jobId: job.id,
  });
  for (const rule of rules) {
    const threshold = rule.threshold === null ? null : Number(rule.threshold);
    if (rule.kind === 'job_losing' || rule.kind === 'job_at_risk') {
      const wanted = rule.kind === 'job_losing' ? 'losing' : 'at_risk';
      for (const job of jobs) if (job.risk_status === wanted && inScope(rule, job)) out.push(jobCandidate(rule, job, (job.risk_reasons ?? [])[0]));
    } else if (rule.kind in RULES_FOR_KIND) {
      const wanted = RULES_FOR_KIND[rule.kind]!;
      for (const job of jobs) {
        if (!inScope(rule, job)) continue;
        const reason = (job.risk_reasons ?? []).find((item) => wanted.includes(item.rule));
        if (reason) out.push(jobCandidate(rule, job, reason));
      }
    } else if (rule.kind === 'margin_below' && threshold !== null) {
      const bp = Math.round(threshold * 100);
      for (const job of jobs) if (inScope(rule, job) && job.projected_margin_bp !== null && job.projected_margin_bp < bp) out.push(jobCandidate(rule, job, undefined, { marginBp: job.projected_margin_bp, thresholdBp: bp }));
    } else if (rule.kind === 'unbilled_above') {
      const limit = threshold !== null ? BigInt(Math.round(threshold * 100)) : settings.unbilledAlertCents;
      const cutoff = addDays(today, -settings.unbilledAlertDays);
      for (const job of jobs) {
        if (!inScope(rule, job) || BigInt(job.not_billed) <= limit) continue;
        if (job.last_entry_date && job.last_entry_date > cutoff) continue;
        out.push(jobCandidate(rule, job, undefined, { notBilledCents: Number(job.not_billed) }));
      }
    } else if ((rule.kind === 'client_margin_below' || rule.kind === 'vas_margin_below') && threshold !== null) {
      const bp = Math.round(threshold * 100);
      const byClient = rule.kind === 'client_margin_below';
      const found = await rows<{ id: string; name: string; revenue: string; profit: string }>(
        executor,
        byClient
          ? sql`SELECT c.id, c.name, sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents ELSE 0 END)::text AS revenue,
                       sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents WHEN f.kind = 'billed_memo' THEN 0 ELSE -f.amount_cents END)::text AS profit
                  FROM pulse.fact_days f JOIN pulse.clients c ON c.id = f.client_id
                 WHERE f.org_id = ${ctx.orgId} AND f.work_date > ${today}::date - 30 GROUP BY c.id, c.name`
          : sql`SELECT s.id, s.name, sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents ELSE 0 END)::text AS revenue,
                       sum(CASE WHEN f.kind LIKE 'revenue%' THEN f.amount_cents WHEN f.kind = 'billed_memo' THEN 0 ELSE -f.amount_cents END)::text AS profit
                  FROM pulse.fact_days f JOIN pulse.vas_services s ON s.id = f.vas_service_id
                 WHERE f.org_id = ${ctx.orgId} AND f.work_date > ${today}::date - 30 GROUP BY s.id, s.name`,
      );
      for (const row of found) {
        const revenue = Number(row.revenue);
        if (!(revenue > 0)) continue;
        const marginBp = Math.round((Number(row.profit) / revenue) * 10000);
        if (marginBp >= bp) continue;
        out.push({ rule, kind: rule.kind, entityType: byClient ? 'client' : 'vas_service', entityId: row.id, params: { [byClient ? 'clientName' : 'serviceName']: row.name, marginBp, thresholdBp: bp }, impactCents: null, url: byClient ? `/clients/${row.id}` : `/services/${row.id}`, jobId: null });
      }
    } else if (rule.kind === 'missing_time_above') {
      const [row] = await rows<{ cents: string; hours: string }>(executor, sql`SELECT COALESCE(sum(missing_cents), 0)::text AS cents, COALESCE(sum(missing_hours), 0)::text AS hours FROM pulse.company_days WHERE org_id = ${ctx.orgId} AND work_date BETWEEN ${startOfMonth(today)}::date AND ${today}::date`);
      const cents = Number(row?.cents ?? 0);
      if (cents > (threshold ?? 0) * 100 && Number(row?.hours ?? 0) > 0) {
        out.push({ rule, kind: rule.kind, entityType: 'period', entityId: startOfMonth(today), params: { missingCents: cents, missingHours: Number(row?.hours ?? 0) }, impactCents: BigInt(-cents), url: '/labor?tab=time', jobId: null });
      }
    } else if (rule.kind === 'overhead_rate_off') {
      const from = startOfMonth(addDays(startOfMonth(addDays(startOfMonth(addDays(startOfMonth(today), -1)), -1)), -1));
      const to = addDays(startOfMonth(today), -1);
      const [row] = await rows<{ company: string; absorbed: string }>(executor, sql`SELECT COALESCE(sum(company_cost_cents), 0)::text AS company, COALESCE(sum(overhead_absorbed_cents), 0)::text AS absorbed FROM pulse.company_days WHERE org_id = ${ctx.orgId} AND work_date BETWEEN ${from}::date AND ${to}::date`);
      const company = Number(row?.company ?? 0);
      const absorbed = Number(row?.absorbed ?? 0);
      if (company > 0 && Math.abs(company - absorbed) > (threshold ?? 0) * 100) {
        out.push({ rule, kind: rule.kind, entityType: 'period', entityId: from, params: { companyCents: company, absorbedCents: absorbed }, impactCents: BigInt(-(company - absorbed)), url: '/labor?tab=rates', jobId: null });
      }
    } else if (rule.kind === 'month_ready_to_close') {
      const last = startOfMonth(addDays(startOfMonth(today), -1));
      const [row] = await rows<{ has_data: boolean; closed: boolean; open_items: number }>(
        executor,
        sql`SELECT EXISTS (SELECT 1 FROM pulse.fact_days WHERE org_id = ${ctx.orgId} AND work_date BETWEEN ${last}::date AND ${endOfMonth(last)}::date) AS has_data,
                   EXISTS (SELECT 1 FROM pulse.periods WHERE org_id = ${ctx.orgId} AND period_month = ${last}::date AND status = 'closed') AS closed,
                   ((SELECT count(*) FROM pulse.production_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND needs_rate AND work_date BETWEEN ${last}::date AND ${endOfMonth(last)}::date)
                  + (SELECT count(*) FROM pulse.vas_entries WHERE org_id = ${ctx.orgId} AND deleted_at IS NULL AND amount_cents IS NULL AND work_date BETWEEN ${last}::date AND ${endOfMonth(last)}::date))::int AS open_items`,
      );
      if (row?.has_data && !row.closed && row.open_items === 0 && today >= addDays(startOfMonth(today), 2)) {
        out.push({ rule, kind: rule.kind, entityType: 'period', entityId: last, params: { periodMonth: last, monthName: monthName(last) }, impactCents: null, url: '/settings/close', jobId: null });
      }
    }
  }
  return out;
}

async function recipients(executor: Executor, ctx: DomainContext, rule: Pick<RuleRow, 'notifyRoles' | 'notifyUserIds'>): Promise<string[]> {
  const byRole = await userIdsWithRoles(ctx, rule.notifyRoles, executor);
  const direct = await filterOrgMembers(ctx, rule.notifyUserIds, executor);
  return [...new Set([...byRole.keys(), ...direct])];
}

/**
 * Checks every enabled rule against the current numbers. New conditions become alerts and
 * notify the rule's people; lasting ones are refreshed; cleared ones resolve by themselves.
 * Safe to run often (cron tick, after an import, "Check now").
 */
export async function evaluateAlerts(ctx: DomainContext): Promise<{ created: number; updated: number; resolved: number }> {
  await requirePulse(ctx, 'pulse:read');
  return inTx(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`pulse-alerts:${ctx.orgId}`}))`);
    const settings = await loadSettings(ctx.orgId, tx);
    const rules = await tx.select().from(alertRules).where(and(eq(alertRules.orgId, ctx.orgId), isNull(alertRules.deletedAt), eq(alertRules.enabled, true)));
    const candidates = await collect(tx, ctx, rules);
    const live = await tx.select().from(alerts).where(and(eq(alerts.orgId, ctx.orgId), inArray(alerts.status, ['open', 'snoozed', 'dismissed']), inArray(alerts.kind, [...EVALUATED_KINDS])));
    const byKey = new Map<string, AlertRow>();
    for (const row of live) if (!byKey.has(row.dedupeKey) || row.status !== 'dismissed') byKey.set(row.dedupeKey, row);
    const seen = new Set<string>();
    let created = 0;
    let updated = 0;
    for (const candidate of candidates) {
      const key = `${candidate.rule.id}:${candidate.entityType}:${candidate.entityId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const existing = byKey.get(key);
      if (existing) {
        await tx.update(alerts).set({ params: candidate.params, impactCents: candidate.impactCents, severity: candidate.rule.severity, lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(alerts.id, existing.id));
        updated += 1;
        continue;
      }
      // Quiet hours (money ops): a rule raises nothing new inside its window. The first check after the window picks the condition up.
      if (isQuietNow(quietOf(candidate.rule.scope), settings.timezone)) continue;
      const [row] = await tx
        .insert(alerts)
        .values({ orgId: ctx.orgId, ruleId: candidate.rule.id, kind: candidate.kind, severity: candidate.rule.severity, entityType: candidate.entityType, entityId: candidate.entityId, params: candidate.params, impactCents: candidate.impactCents, url: candidate.url, dedupeKey: key })
        .returning({ id: alerts.id });
      created += 1;
      await notify(tx, { ...ctx, actorKind: 'system' }, await recipients(tx, ctx, candidate.rule), { kind: `alert:${candidate.kind}`, params: candidate.params, url: candidate.url ?? '/alerts', alertId: row!.id, jobId: candidate.jobId });
    }
    const cleared = live.filter((row) => !seen.has(row.dedupeKey)).map((row) => row.id);
    if (cleared.length > 0) await tx.update(alerts).set({ status: 'resolved', resolution: 'cleared', resolvedAt: new Date(), updatedAt: new Date() }).where(inArray(alerts.id, cleared));
    // Snoozes that ran out wake up again.
    await tx.update(alerts).set({ status: 'open', snoozedUntil: null, updatedAt: new Date() }).where(and(eq(alerts.orgId, ctx.orgId), eq(alerts.status, 'snoozed'), sql`${alerts.snoozedUntil} <= CURRENT_DATE`));
    return { created, updated, resolved: cleared.length };
  });
}

/** Raises (or refreshes) one alert for an event another module saw: a failed import, a failed sync, a won deal with no job. */
export async function raiseAlert(executor: Executor, ctx: DomainContext, input: { kind: AlertKind; entityType: AlertEntityType; entityId: string; params?: Record<string, unknown>; url?: string | null; impactCents?: bigint | null }): Promise<string | null> {
  const [rule] = await executor.select().from(alertRules).where(and(eq(alertRules.orgId, ctx.orgId), eq(alertRules.kind, input.kind), isNull(alertRules.deletedAt), eq(alertRules.enabled, true))).limit(1);
  const key = `${input.kind}:${input.entityType}:${input.entityId}`;
  const [existing] = await executor.select().from(alerts).where(and(eq(alerts.orgId, ctx.orgId), eq(alerts.dedupeKey, key), inArray(alerts.status, ['open', 'snoozed'])));
  if (existing) {
    await executor.update(alerts).set({ params: input.params ?? {}, lastSeenAt: new Date(), updatedAt: new Date() }).where(eq(alerts.id, existing.id));
    return existing.id;
  }
  const [row] = await executor
    .insert(alerts)
    .values({ orgId: ctx.orgId, ruleId: rule?.id ?? null, kind: input.kind, severity: rule?.severity ?? 'warning', entityType: input.entityType, entityId: input.entityId, params: input.params ?? {}, impactCents: input.impactCents ?? null, url: input.url ?? null, dedupeKey: key })
    .returning({ id: alerts.id });
  const people = await recipients(executor, ctx, rule ?? { notifyRoles: ['owner', 'admin'], notifyUserIds: [] });
  await notify(executor, { ...ctx, actorKind: 'system' }, people, { kind: `alert:${input.kind}`, params: input.params ?? {}, url: input.url ?? '/alerts', alertId: row!.id });
  return row!.id;
}

/** Resolves the open alert of an event that cleared (the import was fixed, the sync works again). */
export async function clearAlert(executor: Executor, ctx: DomainContext, kind: AlertKind, entityType: AlertEntityType, entityId: string): Promise<void> {
  await executor
    .update(alerts)
    .set({ status: 'resolved', resolution: 'cleared', resolvedAt: new Date(), updatedAt: new Date() })
    .where(and(eq(alerts.orgId, ctx.orgId), eq(alerts.dedupeKey, `${kind}:${entityType}:${entityId}`), inArray(alerts.status, ['open', 'snoozed'])));
}

/* ---------------------------------------------------------------- inbox */

/** Current risk reasons of the jobs behind these alerts, so an open alert reads the same money as the job page. */
async function liveReasonsFor(executor: Executor, orgId: string, found: readonly AlertRow[]): Promise<Map<string, LiveReason[]>> {
  const ids = [...new Set(found.filter((row) => row.entityType === 'job' && row.status !== 'resolved' && isUuid(row.entityId)).map((row) => row.entityId as string))];
  const out = new Map<string, LiveReason[]>();
  if (ids.length === 0) return out;
  const live = await rows<{ job_id: string; risk_reasons: LiveReason[] | null }>(
    executor,
    sql`SELECT job_id::text AS job_id, risk_reasons FROM pulse.job_stats WHERE org_id = ${orgId} AND job_id = ANY(${uuidArray(ids)})`,
  );
  for (const row of live) out.set(row.job_id, row.risk_reasons ?? []);
  return out;
}

function toAlertDTO(stored: AlertRow, access: Pick<PulseAccess, 'seesMoney'>, live?: Map<string, LiveReason[]>): AlertDTO {
  const current =
    stored.entityType === 'job' && stored.status !== 'resolved' && live
      ? liveJobAlert({ params: (stored.params ?? {}) as Record<string, unknown>, impactCents: stored.impactCents }, live.get(stored.entityId ?? '') ?? null)
      : null;
  const row = current ? { ...stored, params: current.params, impactCents: current.impactCents } : stored;
  const words = renderAlertWords(row.kind, row.params ?? {}, access.seesMoney);
  const params = (row.params ?? {}) as Record<string, unknown>;
  const label = [params.jobNumber, params.jobName].filter((part) => typeof part === 'string' && part).join(' ') || (params.clientName as string | undefined) || (params.serviceName as string | undefined) || null;
  return {
    id: row.id,
    ruleId: row.ruleId,
    kind: row.kind,
    severity: row.severity as AlertSeverity,
    entityType: row.entityType as AlertEntityType,
    entityId: row.entityId,
    entityLabel: label,
    title: words.title,
    body: words.body,
    nextStep: words.nextStep,
    impactCents: moneyOut(access.seesMoney, row.impactCents),
    impactAsOf: current?.impactAsOf ?? 'live',
    url: row.url,
    status: row.status as AlertStatus,
    snoozedUntil: row.snoozedUntil,
    assignedTo: row.assignedTo,
    resolvedAt: iso(row.resolvedAt),
    resolution: row.resolution as 'cleared' | 'manual' | null,
    firstSeenAt: isoRequired(row.firstSeenAt),
    lastSeenAt: isoRequired(row.lastSeenAt),
    pmTaskId: row.pmTaskId,
    moneyHidden: !access.seesMoney,
  };
}

const SEVERITY_ORDER = sql`CASE ${alerts.severity} WHEN 'critical' THEN 0 WHEN 'warning' THEN 1 ELSE 2 END`;

export async function listAlerts(ctx: DomainContext, filters: { status?: AlertStatus | 'all' | null; entityType?: AlertEntityType | null; entityId?: string | null; assignedTo?: string | null; limit?: number } = {}): Promise<AlertDTO[]> {
  const access = await requirePulse(ctx, 'pulse:read');
  const status = filters.status ?? 'open';
  const where: (SQL | undefined)[] = [
    eq(alerts.orgId, ctx.orgId),
    status === 'all' ? undefined : eq(alerts.status, status),
    filters.entityType ? eq(alerts.entityType, filters.entityType) : undefined,
    filters.entityId ? eq(alerts.entityId, filters.entityId) : undefined,
    filters.assignedTo ? eq(alerts.assignedTo, filters.assignedTo) : undefined,
  ];
  const found = await db.select().from(alerts).where(and(...where)).orderBy(SEVERITY_ORDER, sql`${alerts.impactCents} asc nulls last`, desc(alerts.lastSeenAt)).limit(Math.min(filters.limit ?? 200, 1000));
  const live = await liveReasonsFor(db, ctx.orgId, found);
  return found.map((row) => toAlertDTO(row, access, live));
}

export async function countOpenAlerts(ctx: DomainContext): Promise<number> {
  const [row] = await db.select({ n: sql<number>`count(*)::int` }).from(alerts).where(and(eq(alerts.orgId, ctx.orgId), eq(alerts.status, 'open')));
  return row?.n ?? 0;
}

export type AlertChange =
  | { action: 'snooze'; until: string }
  | { action: 'unsnooze' }
  | { action: 'dismiss' }
  | { action: 'resolve' }
  | { action: 'reopen' }
  | { action: 'assign'; userId: string | null }
  | { action: 'link_task'; pmTaskId: string | null };

/** Snooze, assign, dismiss, resolve or reopen one alert. */
export async function updateAlert(ctx: DomainContext, alertId: string, change: AlertChange): Promise<AlertDTO> {
  const access = await requirePulse(ctx, change.action === 'assign' || change.action === 'link_task' ? 'alert:manage' : 'production:log');
  return inTx(async (tx) => {
    const [before] = isUuid(alertId) ? await tx.select().from(alerts).where(and(eq(alerts.orgId, ctx.orgId), eq(alerts.id, alertId))) : [];
    if (!before) throw notFound('That alert');
    let values: Partial<typeof alerts.$inferInsert>;
    switch (change.action) {
      case 'snooze':
        if (!/^\d{4}-\d{2}-\d{2}$/.test(change.until)) throw invalid('Pick the day the alert should come back.');
        values = { status: 'snoozed', snoozedUntil: change.until };
        break;
      case 'unsnooze':
      case 'reopen':
        values = { status: 'open', snoozedUntil: null, resolvedAt: null, resolvedBy: null, resolution: null };
        break;
      case 'dismiss':
        values = { status: 'dismissed', resolvedAt: new Date(), resolvedBy: ctx.userId };
        break;
      case 'resolve':
        values = { status: 'resolved', resolution: 'manual', resolvedAt: new Date(), resolvedBy: ctx.userId };
        break;
      case 'assign': {
        const ok = change.userId ? await filterOrgMembers(ctx, [change.userId], tx) : [];
        if (change.userId && ok.length === 0) throw invalid('Pick a member of this workspace.');
        values = { assignedTo: change.userId };
        break;
      }
      case 'link_task':
        values = { pmTaskId: change.pmTaskId };
        break;
    }
    const [row] = await tx.update(alerts).set({ ...values, updatedAt: new Date() }).where(eq(alerts.id, before.id)).returning();
    await logActivity(tx, ctx, { verb: 'alert.updated', entityType: 'alert', entityId: before.id, jobId: before.entityType === 'job' && isUuid(before.entityId) ? before.entityId : null, before: { status: before.status, snoozedUntil: before.snoozedUntil, assignedTo: before.assignedTo }, after: { status: row!.status, snoozedUntil: row!.snoozedUntil, assignedTo: row!.assignedTo }, meta: { action: change.action } });
    if (change.action === 'assign' && change.userId) await notify(tx, ctx, [change.userId], { kind: `alert:${before.kind}`, params: before.params ?? {}, url: before.url ?? '/alerts', alertId: before.id });
    return toAlertDTO(row!, access, await liveReasonsFor(tx, ctx.orgId, [row!]));
  });
}
