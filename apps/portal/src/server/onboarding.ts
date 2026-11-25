/**
 * Guided-setup reads: live signals from the shared database + explicit state from
 * core.onboarding_progress, combined through the pure model (src/lib/setup-model.ts).
 * Cross-schema counts are defensive raw SQL: any failure → null, so the guide degrades
 * instead of breaking the page.
 */
import 'server-only';
import { and, eq, gt, isNull, sql } from 'drizzle-orm';
import { invitation, member, onboardingProgress } from '@kitstak/db/schema';
import { findWmsTenantSchema, wmsTable } from '@kitstak/db/wms-tenants';
import { getSetupSignals as getPulseSetupSignals, type BridgeExecutor } from '@kitstak/pulse-bridge';
import { formatDayShort } from '@kitstak/billing/catalog';
import type { PlanState } from '@kitstak/billing/plan-state';
import { getPlanState } from '@kitstak/billing/server';
import { isDevAllowAll } from '@kitstak/entitlements';
import { billingRuntime } from '@/server/billing/runtime';
import { db } from '@/server/db';
import { env } from '@/server/env';
import {
  buildSetupSteps,
  moreGuideSteps,
  pickGuideSteps,
  stepsForMember,
  summarizeSetup,
  SETUP_PRODUCTS,
  type SetupBillingSignal,
  type SetupProduct,
  type SetupProfile,
  type SetupStep,
  type SetupStepKey,
  type SetupSignals,
  type SetupSummary,
  readProgressRows,
  type ProgressState,
} from '@/lib/setup-model';

const DEACTIVATED_PREFIX = 'deactivated:';

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
 * Which apps this team has, for the guide. A team that started a free trial or has a plan gets the
 * steps of the apps in it (and of any app KitStak granted by hand), so the guide is tied to what
 * they picked. A team with neither falls back to the dev switch, as before.
 *
 * WMS is one install per organization: its steps show only for the platform org or for a team with
 * a REAL WMS row. The dev switch alone never brings WMS steps into another team's guide.
 */
export function chosenProducts(state: PlanState | null, orgSlug: string, devAllowAll: boolean): readonly SetupProduct[] {
  const touched = state !== null && (state.trial !== null || state.hasSubscription);
  return SETUP_PRODUCTS.filter((product) => {
    const plan = state?.modules[product];
    const real = plan !== undefined && (plan.inPlan || plan.source === 'manual');
    if (product === 'wms') return orgSlug === env.WMS_PLATFORM_ORG_SLUG || real;
    return touched ? real : real || devAllowAll;
  });
}

/** The "Pick your plan" step. null for teams on a manual grant only and teams with no trial. */
export function billingSignal(state: PlanState | null, timeZone?: string): SetupBillingSignal | null {
  if (state === null) return null;
  if (state.trial === null && !state.hasSubscription) return null;
  const paid =
    state.paymentMethod !== null ||
    (state.hasSubscription && state.phase !== 'trial' && state.phase !== 'trial_ended' && state.phase !== 'ended');
  const trialEndsLabel = state.trial ? formatDayShort(state.trial.endsAt, timeZone) : null;
  if (paid) return { state: 'done', trialEndsLabel };
  if (state.phase === 'trial_ended' || state.phase === 'ended') return { state: 'trial_ended', trialEndsLabel };
  return { state: 'trial', trialEndsLabel };
}

async function planStateOrNull(orgId: string): Promise<PlanState | null> {
  try {
    return await getPlanState(billingRuntime(), orgId);
  } catch (error: unknown) {
    console.error('[portal] setup signal read failed (plan state)', error);
    return null;
  }
}

async function getSetupSignals(
  orgId: string,
  orgSlug: string,
  timeZone?: string,
): Promise<{ signals: SetupSignals; products: readonly SetupProduct[]; plan: PlanState | null }> {
  // One separate warehouse per organization: count THIS org's warehouse (none yet → 0).
  const wmsSchema = await findWmsTenantSchema(db, orgId).catch(() => null);
  const wmsCount = (table: string, label: string): Promise<number | null> =>
    wmsSchema
      ? countOrNull(sql`select count(*) as n from ${wmsTable(wmsSchema, table)}`, label)
      : Promise.resolve(0);
  const [team, plan, crmBoards, crmDeals, wmsWarehouses, wmsProducts, wmsOrders, pm, pulse] =
    await Promise.all([
      teamSignals(orgId),
      planStateOrNull(orgId),
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
      // to_regclass guarded inside the bridge: null when Pulse is not installed here.
      getPulseSetupSignals(db as unknown as BridgeExecutor, orgId),
    ]);
  const products = chosenProducts(plan, orgSlug, isDevAllowAll());
  const has = (product: SetupProduct): boolean => products.includes(product);
  const signals: SetupSignals = {
    memberCount: team.memberCount,
    pendingInvites: team.pendingInvites,
    crmEntitled: has('crm'),
    wmsEntitled: has('wms'),
    crmBoards,
    crmDeals,
    wmsWarehouses,
    wmsProducts,
    wmsOrders,
    projectsEntitled: has('projects'),
    pmProjects: pm?.projects ?? null,
    pmAssignedTasks: pm?.assigned ?? null,
    pmLinks: pm?.links ?? null,
    pulseEntitled: has('pulse'),
    pulseLaborRates: pulse?.laborRates ?? null,
    pulseJobs: pulse?.jobs ?? null,
    pulseEntries: pulse?.entries ?? null,
    pulseLinks: pulse?.links ?? null,
    billing: billingSignal(plan, timeZone),
  };
  return { signals, products, plan };
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
  /** Every step of the plan, in order. */
  readonly steps: readonly SetupStepView[];
  /** Counts over every step. */
  readonly summary: SetupSummary;
  /**
   * The quick start: the 3 to 5 steps the welcome screen promised (docs/billing/SPEC.md 5.7). The
   * launcher guide shows these, counts these and celebrates these.
   */
  readonly quick: { readonly steps: readonly SetupStepView[]; readonly summary: SetupSummary };
  /** The steps the quick start leaves out. The guide folds them behind "Show more steps". */
  readonly more: readonly SetupStepView[];
  readonly dismissed: boolean;
  /** An org-level 'guide' row exists (seen or dismissed) — the rollout guard marker. */
  readonly seen: boolean;
  /** Guide-eligible modules (WMS gated to the install's org — ONBOARDING.md). */
  readonly guideEntitlements: { readonly crm: boolean; readonly wms: boolean };
  /** The apps the guide covers: the ones in the trial or plan, or granted by hand. */
  readonly products: readonly SetupProduct[];
  /** The "Pick your plan" step's facts. null when the team never sees that step. */
  readonly billing: SetupBillingSignal | null;
  /** The last day of the free trial, when one is running. */
  readonly trialEndsAt: Date | null;
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
  const pulse = (path: string): string => `${env.NEXT_PUBLIC_PULSE_URL}${path}`;
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
    case 'pulse_labor_rate':
      return { href: pulse('/labor?tab=rates&setup=pulse_labor_rate'), external: true };
    case 'pulse_first_job':
      return { href: pulse('/jobs/new?setup=pulse_first_job'), external: true };
    case 'pulse_first_entry':
      return { href: pulse('/log?setup=pulse_first_entry'), external: true };
    case 'pulse_connect':
      return { href: pulse('/jobs?setup=pulse_connect'), external: true };
    case 'billing_plan':
      return { href: '/billing/plan', external: false };
  }
}

async function getProgressRows(orgId: string): Promise<ProgressState> {
  const rows = await db
    .select({
      scope: onboardingProgress.scope,
      stepKey: onboardingProgress.stepKey,
      status: onboardingProgress.status,
      payload: onboardingProgress.payload,
    })
    .from(onboardingProgress)
    .where(and(eq(onboardingProgress.orgId, orgId), isNull(onboardingProgress.userId)));
  return readProgressRows(rows);
}

/** The org's full guided-setup state for the launcher and the welcome wizard. */
export async function getSetupState(
  org: {
    readonly id: string;
    readonly slug: string;
  },
  options: {
    readonly timeZone?: string;
    /**
     * False for a person who cannot pay or change the plan (not an owner, not a billing manager).
     * Their guide has no "Pick your plan" step: it would be a button they cannot use.
     */
    readonly canManageBilling?: boolean;
    /**
     * False for a person who is not an owner or an admin. Their guide leaves out the steps only an
     * owner or admin can do while those are still open (`stepsForMember`): a step with no button
     * is a dead end. A step that is done still shows as done.
     */
    readonly canManageOrg?: boolean;
  } = {},
): Promise<SetupState> {
  const [{ signals: liveSignals, products, plan }, progress] = await Promise.all([
    getSetupSignals(org.id, org.slug, options.timeZone),
    getProgressRows(org.id),
  ]);
  const signals: SetupSignals = options.canManageBilling === false ? { ...liveSignals, billing: null } : liveSignals;
  const allSteps = buildSetupSteps(signals, progress.profile, progress.overrides);
  const steps = options.canManageOrg === false ? stepsForMember(allSteps) : allSteps;
  const view = (step: SetupStep): SetupStepView => {
    const link = stepHref(step.key, org.slug, progress.profile);
    return { ...step, cta: link.cta ?? step.cta, href: link.href, external: link.external };
  };
  const quickSteps = pickGuideSteps(steps);
  return {
    profile: progress.profile,
    steps: steps.map(view),
    summary: summarizeSetup(steps),
    quick: { steps: quickSteps.map(view), summary: summarizeSetup(quickSteps) },
    more: moreGuideSteps(steps).map(view),
    dismissed: progress.dismissed,
    seen: progress.seen,
    guideEntitlements: { crm: signals.crmEntitled, wms: signals.wmsEntitled },
    products,
    billing: signals.billing ?? null,
    trialEndsAt: plan?.phase === 'trial' && plan.trial ? plan.trial.endsAt : null,
  };
}
