/**
 * Guided-setup reads: live signals from the shared database + explicit state from
 * core.onboarding_progress, combined through the pure model (src/lib/setup-model.ts).
 * Cross-schema counts follow product-stats.ts: defensive raw SQL, any failure → null,
 * the guide degrades instead of breaking the launcher.
 */
import 'server-only';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { invitation, member, onboardingProgress } from '@kitstak/db/schema';
import { findWmsTenantSchema, wmsTable } from '@kitstak/db/wms-tenants';
import { db } from '@/server/db';
import { env } from '@/server/env';
import { getOrgModuleStates } from '@/server/entitlements';
import {
  buildSetupSteps,
  parseSetupProfile,
  summarizeSetup,
  type SetupOverrides,
  type SetupProfile,
  type SetupStep,
  type SetupStepKey,
  type SetupSignals,
  type SetupSummary,
  isSetupStepKey,
} from '@/lib/setup-model';

const DEACTIVATED_PREFIX = 'deactivated:';

/** Org-level row that records the guide itself being dismissed. */
export const GUIDE_STEP_KEY = 'guide';

async function countOrNull(query: ReturnType<typeof sql>, label: string): Promise<number | null> {
  try {
    const result = await db.execute<{ n: unknown }>(query);
    const value = Number(result.rows[0]?.n);
    return Number.isFinite(value) ? value : 0;
  } catch (error: unknown) {
    console.error(`[portal] setup signal query failed (${label})`, error);
    return null;
  }
}

async function teamSignals(orgId: string): Promise<{ memberCount: number; pendingInvites: number }> {
  const [memberRows, inviteRows] = await Promise.all([
    db.select({ role: member.role }).from(member).where(eq(member.organizationId, orgId)),
    db
      .select({ id: invitation.id })
      .from(invitation)
      .where(
        and(
          eq(invitation.organizationId, orgId),
          eq(invitation.status, 'pending'),
          // An expired invite satisfies nothing (ONBOARDING.md predicate lockstep).
          gt(invitation.expiresAt, new Date()),
        ),
      ),
  ]);
  return {
    memberCount: memberRows.filter((row) => !row.role.startsWith(DEACTIVATED_PREFIX)).length,
    pendingInvites: inviteRows.length,
  };
}

/**
 * WMS is single-tenant: its tables describe one install, not the active org. Only the
 * platform org (or an org with a REAL entitlement row — the dev allow-all switch alone
 * does not count) gets WMS steps, so install state never leaks into unrelated guides.
 */
function wmsStepsEligible(
  orgSlug: string,
  access: 'active' | 'trial' | 'grace' | 'locked' | 'dev',
): boolean {
  // The platform org owns the install outright — no entitlement row required.
  if (orgSlug === env.WMS_PLATFORM_ORG_SLUG) return true;
  return access === 'active' || access === 'trial' || access === 'grace';
}

async function getSetupSignals(orgId: string, orgSlug: string): Promise<SetupSignals> {
  // One separate warehouse per organization: count THIS org's warehouse (none yet → 0).
  const wmsSchema = await findWmsTenantSchema(db, orgId).catch(() => null);
  const wmsCount = (table: string, label: string): Promise<number | null> =>
    wmsSchema
      ? countOrNull(sql`select count(*) as n from ${wmsTable(wmsSchema, table)}`, label)
      : Promise.resolve(0);
  const [team, moduleStates, crmBoards, crmDeals, wmsWarehouses, wmsProducts, wmsOrders, pm] =
    await Promise.all([
      teamSignals(orgId),
      getOrgModuleStates(orgId),
      countOrNull(
        sql`select count(*) as n from crm.boards b
            where b.org_id = ${orgId} and b.deleted_at is null and b.archived_at is null`,
        'crm boards',
      ),
      countOrNull(
        sql`select count(*) as n from crm.items i
            join crm.boards b on b.id = i.board_id
            where i.org_id = ${orgId} and b.kind = 'deals'
              and b.deleted_at is null and b.archived_at is null
              and i.deleted_at is null and i.parent_item_id is null`,
        'crm deals',
      ),
      wmsCount('warehouses', 'wms warehouses'),
      wmsCount('products', 'wms products'),
      wmsCount('shipment_orders', 'wms orders'),
      projectsSignals(orgId),
    ]);
  const moduleState = (module: 'crm' | 'wms') =>
    moduleStates.modules.find((state) => state.module === module);
  const wms = moduleState('wms');
  return {
    memberCount: team.memberCount,
    pendingInvites: team.pendingInvites,
    crmEntitled: moduleState('crm')?.entitled ?? false,
    // Platform org OR a real entitlement row (ONBOARDING.md) — the slug match alone wins
    // for the install's own org even with the dev switch off and no row.
    wmsEntitled:
      orgSlug === env.WMS_PLATFORM_ORG_SLUG ||
      ((wms?.entitled ?? false) && wmsStepsEligible(orgSlug, wms?.access ?? 'locked')),
    crmBoards,
    crmDeals,
    wmsWarehouses,
    wmsProducts,
    wmsOrders,
    projectsEntitled: moduleStates.modules.find((state) => state.module === 'projects')?.entitled ?? false,
    pmProjects: pm?.projects ?? null,
    pmAssignedTasks: pm?.assigned ?? null,
    pmLinks: pm?.links ?? null,
  };
}

/**
 * KitStak Projects signals (pm schema). Guarded by to_regclass so an environment without
 * Projects installed reads as "no data" quietly instead of logging a failed query.
 */
async function projectsSignals(orgId: string): Promise<{ projects: number; assigned: number; links: number } | null> {
  try {
    const result = await db.execute<{ installed: boolean; projects: unknown; assigned: unknown; links: unknown }>(sql`
      select to_regclass('pm.projects') is not null as installed`);
    if (!result.rows[0]?.installed) return null;
    const counts = await db.execute<{ projects: unknown; assigned: unknown; links: unknown }>(sql`
      select
        (select count(*) from pm.projects p
          where p.org_id = ${orgId} and p.deleted_at is null and p.is_template = false
            and coalesce(p.settings ->> 'sample', 'false') <> 'true') as projects,
        (select count(*) from pm.tasks t join pm.projects p on p.id = t.project_id
          where t.org_id = ${orgId} and t.deleted_at is null and t.assignee_id is not null
            and coalesce(p.settings ->> 'sample', 'false') <> 'true') as assigned,
        (select count(*) from pm.integration_links l
          where l.org_id = ${orgId} and l.target_type <> 'core_customer') as links`);
    const row = counts.rows[0];
    const n = (value: unknown) => (Number.isFinite(Number(value)) ? Number(value) : 0);
    return { projects: n(row?.projects), assigned: n(row?.assigned), links: n(row?.links) };
  } catch (error: unknown) {
    console.error('[portal] setup signal query failed (projects)', error);
    return null;
  }
}

export interface SetupStepView extends SetupStep {
  /** Resolved deep link for the step's CTA. */
  readonly href: string;
  /** Opens in a new tab (sibling app) vs. an in-portal route. */
  readonly external: boolean;
}

export interface SetupState {
  readonly profile: SetupProfile | null;
  readonly steps: readonly SetupStepView[];
  readonly summary: SetupSummary;
  readonly dismissed: boolean;
  /** An org-level 'guide' row exists (seen or dismissed) — the rollout guard marker. */
  readonly seen: boolean;
  /** Guide-eligible modules (WMS gated to the install's org — ONBOARDING.md). */
  readonly guideEntitlements: { readonly crm: boolean; readonly wms: boolean };
}

interface StepLink {
  readonly href: string;
  readonly external: boolean;
  /** CTA label override (e.g. the import start mode retargets the catalog step). */
  readonly cta?: string;
}

/**
 * Deep links consume the wizard answers (ONBOARDING.md): 'import' sends the catalog step
 * to the Imports hub; 'sample' starts the CRM step in the template center where sample
 * data is on by default. External links carry ?setup=<key> for in-app arrival callouts.
 */
function stepHref(key: SetupStepKey, orgSlug: string, profile: SetupProfile | null): StepLink {
  const crm = (path: string): string => `${env.NEXT_PUBLIC_CRM_URL}/${orgSlug}${path}`;
  const wms = (path: string): string => `${env.NEXT_PUBLIC_WMS_URL}${path}`;
  const projects = (path: string): string => `${env.NEXT_PUBLIC_PROJECTS_URL}${path}`;
  switch (key) {
    case 'profile':
      return { href: '/welcome', external: false };
    case 'invite_team':
      return { href: '/settings/organization', external: false };
    case 'crm_workspace':
      return profile?.startMode === 'sample'
        ? { href: crm('/templates?setup=crm_workspace'), external: true, cta: 'Pick a template' }
        : { href: crm('?setup=crm_workspace'), external: true };
    case 'crm_first_deal':
      return { href: crm('/crm/pipeline?setup=crm_first_deal'), external: true };
    case 'wms_warehouse':
      return { href: wms('/settings/warehouses?setup=wms_warehouse'), external: true };
    case 'wms_catalog':
      return profile?.startMode === 'import'
        ? { href: wms('/imports?setup=wms_catalog'), external: true, cta: 'Import catalog' }
        : { href: wms('/products?setup=wms_catalog'), external: true };
    case 'wms_first_order':
      return { href: wms('/orders?setup=wms_first_order'), external: true };
    case 'projects_first_project':
      return { href: projects('/projects/new?setup=projects_first_project'), external: true };
    case 'projects_assign_task':
      return { href: projects('/my-work?setup=projects_assign_task'), external: true };
    case 'projects_connect':
      return { href: projects('/projects?setup=projects_connect'), external: true };
  }
}

interface ProgressRows {
  readonly profile: SetupProfile | null;
  readonly overrides: SetupOverrides;
  readonly dismissed: boolean;
  readonly seen: boolean;
}

async function getProgressRows(orgId: string): Promise<ProgressRows> {
  const rows = await db
    .select({
      stepKey: onboardingProgress.stepKey,
      status: onboardingProgress.status,
      payload: onboardingProgress.payload,
    })
    .from(onboardingProgress)
    .where(and(eq(onboardingProgress.orgId, orgId), isNull(onboardingProgress.userId)));
  let profile: SetupProfile | null = null;
  let dismissed = false;
  let seen = false;
  const overrides: Partial<Record<SetupStepKey, 'completed' | 'skipped'>> = {};
  for (const row of rows) {
    if (row.stepKey === 'profile' && row.status === 'completed') {
      profile = parseSetupProfile(row.payload);
      overrides.profile = 'completed';
      continue;
    }
    if (row.stepKey === GUIDE_STEP_KEY) {
      seen = true;
      dismissed = row.status === 'dismissed';
      continue;
    }
    if (isSetupStepKey(row.stepKey) && (row.status === 'completed' || row.status === 'skipped')) {
      overrides[row.stepKey] = row.status;
    }
  }
  return { profile, overrides, dismissed, seen };
}

/**
 * Rollout-guard marker: records that this org has SEEN the guide in an incomplete state.
 * Fire-and-forget from `after()` only — never awaited inside a render (pool rule).
 */
export async function markGuideSeen(orgId: string): Promise<void> {
  try {
    await db
      .insert(onboardingProgress)
      .values({ orgId, userId: null, scope: 'portal', stepKey: GUIDE_STEP_KEY, status: 'completed' })
      .onConflictDoNothing();
  } catch (error: unknown) {
    console.error('[portal] markGuideSeen failed', error);
  }
}

/** The org's full guided-setup state for the launcher and the welcome wizard. */
export async function getSetupState(org: {
  readonly id: string;
  readonly slug: string;
}): Promise<SetupState> {
  const [signals, progress] = await Promise.all([
    getSetupSignals(org.id, org.slug),
    getProgressRows(org.id),
  ]);
  const steps = buildSetupSteps(signals, progress.profile, progress.overrides);
  return {
    profile: progress.profile,
    steps: steps.map((step) => {
      const link = stepHref(step.key, org.slug, progress.profile);
      return { ...step, cta: link.cta ?? step.cta, href: link.href, external: link.external };
    }),
    summary: summarizeSetup(steps),
    dismissed: progress.dismissed,
    seen: progress.seen,
    guideEntitlements: { crm: signals.crmEntitled, wms: signals.wmsEntitled },
  };
}
