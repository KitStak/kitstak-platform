/**
 * Org settings (pulse.settings, created lazily on first read) and the rows every org starts
 * with: one default site ("Main site"), the built in job type "General" and twelve system alert
 * rules. `loadSettings` is the internal row reader; `getSettings` is the DTO for the app.
 */
import 'server-only';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { db, type Executor } from '@/server/db';
import { alertRules, jobTypes, settings, sites } from '@/server/db/schema';
import { invalid } from '@/server/errors';
import type { AlertKind, AlertSeverity } from '@/lib/constants';
import { isPulseRole, type PulseRole } from '@/lib/permissions';
import type { SettingsDTO } from '@/lib/types';
import { defined, diff, inTx, iso, isValidTimezone, moneyOut, type DomainContext } from './_shared';
import { requirePulse, type PulseAccess } from './access';
import { logActivity } from './activity';

export type SettingsRow = typeof settings.$inferSelect;

/** The twelve system rules every org starts with (SPEC 5.4). Names are plain sentences. */
export const SYSTEM_ALERT_RULES: readonly { kind: AlertKind; name: string; severity: AlertSeverity; threshold: string | null; roles: readonly string[] }[] = [
  { kind: 'job_losing', name: 'Tell me when a job is losing money', severity: 'critical', threshold: null, roles: ['owner', 'admin', 'manager'] },
  { kind: 'job_at_risk', name: 'Tell me when a job is at risk', severity: 'warning', threshold: null, roles: ['owner', 'admin', 'manager'] },
  { kind: 'no_entry_days', name: 'Tell me when an active job has nothing logged for a few work days', severity: 'warning', threshold: null, roles: ['manager', 'supervisor'] },
  { kind: 'due_soon_behind', name: 'Tell me when a job is due soon and behind', severity: 'warning', threshold: null, roles: ['manager', 'supervisor'] },
  { kind: 'missing_rate', name: 'Tell me when hours have no labor rate', severity: 'warning', threshold: null, roles: ['owner', 'admin'] },
  { kind: 'missing_price', name: 'Tell me when a job has no price', severity: 'warning', threshold: null, roles: ['owner', 'admin', 'manager'] },
  { kind: 'missing_hours', name: 'Tell me when days have units and no hours', severity: 'warning', threshold: null, roles: ['manager', 'supervisor'] },
  { kind: 'unbilled_above', name: 'Tell me when finished work stays not billed', severity: 'info', threshold: null, roles: ['owner', 'admin', 'manager'] },
  { kind: 'missing_time_above', name: 'Tell me when paid time is not on any job', severity: 'info', threshold: '2000.0000', roles: ['owner', 'admin'] },
  { kind: 'overhead_rate_off', name: 'Tell me when my overhead rate is off', severity: 'info', threshold: '1000.0000', roles: ['owner', 'admin'] },
  { kind: 'wms_shortage', name: 'Tell me when the warehouse is short on parts for a job', severity: 'warning', threshold: null, roles: ['manager', 'supervisor'] },
  { kind: 'month_ready_to_close', name: 'Tell me when a month is ready to close', severity: 'info', threshold: null, roles: ['owner', 'admin'] },
];

/**
 * The org's settings row. The first call for an org inserts it and, for the winner of that
 * insert only, the default site, the General job type and the system alert rules.
 */
export async function loadSettings(orgId: string, executor: Executor = db): Promise<SettingsRow> {
  const [existing] = await executor.select().from(settings).where(eq(settings.orgId, orgId));
  if (existing) return existing;
  return inTx(async (tx) => {
    const [created] = await tx.insert(settings).values({ orgId }).onConflictDoNothing().returning();
    if (!created) {
      const [row] = await tx.select().from(settings).where(eq(settings.orgId, orgId));
      if (!row) throw new Error('pulse.settings row vanished');
      return row;
    }
    await tx.execute(sql`
      INSERT INTO pulse.sites (org_id, code, name, timezone, is_default)
      SELECT ${orgId}, 'MAIN', 'Main site', ${created.timezone}, true
       WHERE NOT EXISTS (SELECT 1 FROM pulse.sites WHERE org_id = ${orgId} AND deleted_at IS NULL)`);
    await tx.execute(sql`
      INSERT INTO pulse.job_types (org_id, code, name, is_builtin, color, icon, position)
      SELECT ${orgId}, 'GENERAL', 'General', true, 'blue', 'package', 0
       WHERE NOT EXISTS (SELECT 1 FROM pulse.job_types WHERE org_id = ${orgId} AND lower(code) = 'general' AND deleted_at IS NULL)`);
    await tx.insert(alertRules).values(
      SYSTEM_ALERT_RULES.map((rule) => ({
        orgId,
        name: rule.name,
        kind: rule.kind,
        severity: rule.severity,
        threshold: rule.threshold,
        notifyRoles: [...rule.roles],
        isSystem: true,
      })),
    );
    return created;
  }, executor);
}

/** The org's default site id (created with the settings row). */
export async function defaultSiteId(orgId: string, executor: Executor = db): Promise<string> {
  await loadSettings(orgId, executor);
  const [row] = await executor
    .select({ id: sites.id })
    .from(sites)
    .where(and(eq(sites.orgId, orgId), eq(sites.isDefault, true), isNull(sites.deletedAt)));
  if (row) return row.id;
  const [any] = await executor.select({ id: sites.id }).from(sites).where(and(eq(sites.orgId, orgId), isNull(sites.deletedAt))).limit(1);
  if (!any) throw invalid('This workspace has no site yet. Add one in Settings.');
  return any.id;
}

/** The built in "General" job type id. */
export async function generalJobTypeId(orgId: string, executor: Executor = db): Promise<string> {
  await loadSettings(orgId, executor);
  const [row] = await executor
    .select({ id: jobTypes.id })
    .from(jobTypes)
    .where(and(eq(jobTypes.orgId, orgId), sql`lower(${jobTypes.code}) = 'general'`, isNull(jobTypes.deletedAt)));
  if (row) return row.id;
  const [created] = await executor.insert(jobTypes).values({ orgId, code: 'GENERAL', name: 'General', isBuiltin: true }).returning({ id: jobTypes.id });
  return created!.id;
}

export function toSettingsDTO(row: SettingsRow, access: Pick<PulseAccess, 'seesMoney'>): SettingsDTO {
  const money = access.seesMoney;
  return {
    currency: row.currency,
    timezone: row.timezone,
    weekStart: row.weekStart,
    fiscalYearStartMonth: row.fiscalYearStartMonth,
    workingDays: row.workingDays,
    defaultShiftHours: row.defaultShiftHours,
    defaultPayrollTaxBp: row.defaultPayrollTaxBp,
    defaultBenefitsBp: row.defaultBenefitsBp,
    defaultOtherBurdenBp: row.defaultOtherBurdenBp,
    defaultOverheadPerHourCents: moneyOut(money, row.defaultOverheadPerHourCents),
    defaultOvertimeMultiplier: row.defaultOvertimeMultiplier,
    defaultLoadedRateCents: moneyOut(money, row.defaultLoadedRateCents),
    defaultTargetMarginBp: row.defaultTargetMarginBp,
    marginFloorBp: row.marginFloorBp,
    atRiskGapBp: row.atRiskGapBp,
    laborWatchOverBp: row.laborWatchOverBp,
    laborRiskOverBp: row.laborRiskOverBp,
    productivityWatchBp: row.productivityWatchBp,
    productivityRiskBp: row.productivityRiskBp,
    materialWatchOverBp: row.materialWatchOverBp,
    noEntryDays: row.noEntryDays,
    unbilledAlertCents: moneyOut(money, row.unbilledAlertCents),
    unbilledAlertDays: row.unbilledAlertDays,
    sharedCostRule: row.sharedCostRule as SettingsDTO['sharedCostRule'],
    sharedPctBp: row.sharedPctBp,
    sharedSpread: row.sharedSpread as SettingsDTO['sharedSpread'],
    defaultPartsOwner: row.defaultPartsOwner as SettingsDTO['defaultPartsOwner'],
    defaultMemberRole: (isPulseRole(row.defaultMemberRole) ? row.defaultMemberRole : 'none') as PulseRole,
    jobNumberPrefix: row.jobNumberPrefix,
    dateOrder: row.dateOrder as 'MDY' | 'DMY',
    wmsAutoCreateJobs: row.wmsAutoCreateJobs,
    wmsSyncMaterials: row.wmsSyncMaterials,
    wmsSyncVas: row.wmsSyncVas,
    wmsSyncBilling: row.wmsSyncBilling,
    wmsBillingOpsInProfit: row.wmsBillingOpsInProfit,
    crmSuggestJobs: row.crmSuggestJobs,
    projectsTimeImport: row.projectsTimeImport,
    recalcStartedAt: iso(row.recalcStartedAt),
    onboarding: row.onboarding,
    sampleLoadedAt: iso(row.sampleLoadedAt),
    moneyHidden: !money,
  };
}

export async function getSettings(ctx: DomainContext): Promise<SettingsDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  return toSettingsDTO(await loadSettings(ctx.orgId), access);
}

export interface SettingsPatch {
  currency?: string;
  timezone?: string;
  weekStart?: number;
  fiscalYearStartMonth?: number;
  workingDays?: number[];
  defaultShiftHours?: string;
  defaultPayrollTaxBp?: number;
  defaultBenefitsBp?: number;
  defaultOtherBurdenBp?: number;
  defaultOverheadPerHourCents?: number;
  defaultOvertimeMultiplier?: string;
  defaultLoadedRateCents?: number | null;
  defaultTargetMarginBp?: number;
  marginFloorBp?: number;
  atRiskGapBp?: number;
  laborWatchOverBp?: number;
  laborRiskOverBp?: number;
  productivityWatchBp?: number;
  productivityRiskBp?: number;
  materialWatchOverBp?: number;
  noEntryDays?: number;
  unbilledAlertCents?: number;
  unbilledAlertDays?: number;
  sharedCostRule?: SettingsDTO['sharedCostRule'];
  sharedPctBp?: number;
  sharedSpread?: SettingsDTO['sharedSpread'];
  defaultPartsOwner?: 'us' | 'client';
  defaultMemberRole?: 'manager' | 'supervisor' | 'viewer' | 'none';
  jobNumberPrefix?: string;
  dateOrder?: 'MDY' | 'DMY';
  wmsAutoCreateJobs?: boolean;
  wmsSyncMaterials?: boolean;
  wmsSyncVas?: boolean;
  wmsSyncBilling?: boolean;
  wmsBillingOpsInProfit?: string[];
  crmSuggestJobs?: boolean;
  projectsTimeImport?: boolean;
}

/** Settings that feed stamps or rollups: changing one restamps open months and rebuilds every rollup. */
const RECALC_KEYS: readonly (keyof SettingsPatch)[] = [
  'defaultLoadedRateCents',
  'defaultOvertimeMultiplier',
  'sharedCostRule',
  'sharedPctBp',
  'sharedSpread',
  'weekStart',
  'defaultPartsOwner',
  'defaultTargetMarginBp',
  'marginFloorBp',
  'atRiskGapBp',
  'laborWatchOverBp',
  'laborRiskOverBp',
  'productivityWatchBp',
  'productivityRiskBp',
  'materialWatchOverBp',
  'noEntryDays',
  'workingDays',
];

export async function updateSettings(ctx: DomainContext, patch: SettingsPatch): Promise<SettingsDTO> {
  const access = await requirePulse(ctx, 'settings:manage');
  if (patch.timezone !== undefined && !isValidTimezone(patch.timezone)) throw invalid('Pick a time zone from the list.', { timezone: 'Pick a time zone from the list.' });
  if (patch.workingDays !== undefined && patch.workingDays.length === 0) throw invalid('Pick at least one working day.', { workingDays: 'Pick at least one working day.' });
  if (patch.jobNumberPrefix !== undefined && patch.jobNumberPrefix.length > 12) throw invalid('Keep the job number prefix to 12 characters or fewer.');
  return inTx(async (tx) => {
    const before = await loadSettings(ctx.orgId, tx);
    const { unbilledAlertCents, workingDays, ...rest } = patch;
    const values = defined({
      ...rest,
      workingDays: workingDays ? [...new Set(workingDays)].sort((a, b) => a - b) : undefined,
      unbilledAlertCents: unbilledAlertCents === undefined ? undefined : BigInt(unbilledAlertCents),
    });
    if (Object.keys(values).length === 0) return toSettingsDTO(before, access);
    const [after] = await tx.update(settings).set(values).where(eq(settings.orgId, ctx.orgId)).returning();
    const change = diff(before as unknown as Record<string, unknown>, values as Record<string, unknown>);
    if (change) {
      await logActivity(tx, ctx, { verb: 'settings.changed', entityType: 'settings', before: change.before, after: change.after });
      if (RECALC_KEYS.some((key) => key in change.after)) {
        const { recalcOrg } = await import('./recalc');
        await recalcOrg(tx, ctx);
      }
    }
    return toSettingsDTO(after!, access);
  });
}

/** Marks an onboarding step done or stores a small onboarding value (welcome flow, checklist). */
export async function setOnboarding(ctx: DomainContext, key: string, value: unknown): Promise<SettingsDTO> {
  const access = await requirePulse(ctx, 'pulse:read');
  await loadSettings(ctx.orgId);
  const [after] = await db
    .update(settings)
    .set({ onboarding: sql`${settings.onboarding} || ${JSON.stringify({ [key]: value ?? true })}::jsonb` })
    .where(eq(settings.orgId, ctx.orgId))
    .returning();
  return toSettingsDTO(after!, access);
}
