/**
 * Pure guided-setup model: derives the org's setup plan from live signals, the welcome
 * wizard's answers and explicit overrides (skips). No IO — the server module
 * (src/server/onboarding.ts) gathers inputs and resolves deep-link hrefs.
 *
 * Completion is DETECTED from real data wherever possible (members, boards, warehouses,
 * orders), never self-reported: creating your first deal checks the step off by itself.
 */

export type SetupFocus = 'wms' | 'crm' | 'both';
export type BusinessType = '3pl' | 'brand' | 'distributor' | 'other';
export type TeamSize = 'solo' | 'small' | 'medium' | 'large';
export type StartMode = 'fresh' | 'sample' | 'import';
/** The four apps. The same ids as the billing catalog and `core.entitlements.module`. */
export type SetupProduct = 'crm' | 'wms' | 'projects' | 'pulse';

export interface SetupProfile {
  /**
   * Kept for stored profiles and for the CRM and WMS guides, which read it. New profiles derive it
   * from `products` (see `focusFromProducts`).
   */
  readonly focus: SetupFocus;
  readonly businessType: BusinessType;
  readonly teamSize: TeamSize;
  readonly startMode: StartMode;
  /** The apps picked at signup. Missing on profiles saved before the four app signup. */
  readonly products?: readonly SetupProduct[];
}

export const SETUP_FOCUSES: readonly SetupFocus[] = ['wms', 'crm', 'both'];
export const SETUP_PRODUCTS: readonly SetupProduct[] = ['crm', 'wms', 'projects', 'pulse'];

/** Keeps known app ids, in catalog order, with no repeats. Junk is dropped. */
export function toSetupProducts(value: unknown): readonly SetupProduct[] {
  if (!Array.isArray(value)) return [];
  return SETUP_PRODUCTS.filter((product) => value.includes(product));
}

/**
 * The old CRM or WMS answer, worked out from the apps a team picked. Both, or neither, reads as
 * 'both': the app steps are filtered by what the team really has, so nothing extra shows up.
 */
export function focusFromProducts(products: readonly SetupProduct[]): SetupFocus {
  const crm = products.includes('crm');
  const wms = products.includes('wms');
  if (crm && !wms) return 'crm';
  if (wms && !crm) return 'wms';
  return 'both';
}
export const BUSINESS_TYPES: readonly BusinessType[] = ['3pl', 'brand', 'distributor', 'other'];
export const TEAM_SIZES: readonly TeamSize[] = ['solo', 'small', 'medium', 'large'];
export const START_MODES: readonly StartMode[] = ['fresh', 'sample', 'import'];

/** Parses a stored profile payload defensively; null when the shape is off. */
export function parseSetupProfile(payload: unknown): SetupProfile | null {
  if (typeof payload !== 'object' || payload === null) return null;
  const record = payload as Record<string, unknown>;
  const focus = record.focus;
  const businessType = record.businessType;
  const teamSize = record.teamSize;
  const startMode = record.startMode;
  if (
    typeof focus !== 'string' ||
    !(SETUP_FOCUSES as readonly string[]).includes(focus) ||
    typeof businessType !== 'string' ||
    !(BUSINESS_TYPES as readonly string[]).includes(businessType) ||
    typeof teamSize !== 'string' ||
    !(TEAM_SIZES as readonly string[]).includes(teamSize) ||
    typeof startMode !== 'string' ||
    !(START_MODES as readonly string[]).includes(startMode)
  ) {
    return null;
  }
  return {
    focus: focus as SetupFocus,
    businessType: businessType as BusinessType,
    teamSize: teamSize as TeamSize,
    startMode: startMode as StartMode,
    ...(Array.isArray(record.products) ? { products: toSetupProducts(record.products) } : {}),
  };
}

/**
 * Where the team stands on paying, for the "Pick your plan" step (docs/billing/SPEC.md 5.7).
 * `trial`: a free trial is running with no card. `trial_ended`: it is over and nothing is paid.
 * `done`: a card is on file or the plan is paid.
 */
export interface SetupBillingSignal {
  readonly state: 'trial' | 'trial_ended' | 'done';
  /** The last day of the free trial in short words ("Dec 7"), when known. */
  readonly trialEndsLabel: string | null;
}

/** Live signals read from the shared database. `null` = query failed (degrade to todo). */
export interface SetupSignals {
  readonly memberCount: number;
  readonly pendingInvites: number;
  readonly crmEntitled: boolean;
  readonly wmsEntitled: boolean;
  readonly crmBoards: number | null;
  readonly crmDeals: number | null;
  readonly wmsWarehouses: number | null;
  readonly wmsProducts: number | null;
  readonly wmsOrders: number | null;
  /** KitStak Projects module (omitted = not licensed: no Projects steps). */
  readonly projectsEntitled?: boolean;
  /** Real projects (not templates, not the sample project). */
  readonly pmProjects?: number | null;
  /** Tasks someone has been assigned. */
  readonly pmAssignedTasks?: number | null;
  /** Projects/tasks linked to a CRM or WMS record. */
  readonly pmLinks?: number | null;
  /** KitStak Pulse module (omitted = not licensed: no Pulse steps). */
  readonly pulseEntitled?: boolean;
  /** Labor rates, or a default labor cost per hour in Pulse settings. */
  readonly pulseLaborRates?: number | null;
  /** Real jobs (sample data does not count). */
  readonly pulseJobs?: number | null;
  /** Days of work logged on a job (sample data does not count). */
  readonly pulseEntries?: number | null;
  /** Jobs linked to a CRM deal, a WMS work order or a project. */
  readonly pulseLinks?: number | null;
  /**
   * Set only for a team that started a free trial or has a plan. Left out (or null) for teams on
   * a manual grant and teams with no trial: they never see the "Pick your plan" step.
   */
  readonly billing?: SetupBillingSignal | null;
}

export type SetupScope = 'portal' | 'crm' | 'wms' | 'projects' | 'pulse';
export type SetupStepStatus = 'todo' | 'done' | 'skipped';

export type SetupStepKey =
  | 'profile'
  | 'invite_team'
  | 'crm_workspace'
  | 'crm_first_deal'
  | 'wms_warehouse'
  | 'wms_catalog'
  | 'wms_first_order'
  | 'projects_first_project'
  | 'projects_assign_task'
  | 'projects_connect'
  | 'pulse_labor_rate'
  | 'pulse_first_job'
  | 'pulse_first_entry'
  | 'pulse_connect'
  | 'billing_plan';

export const SETUP_STEP_KEYS: readonly SetupStepKey[] = [
  'profile',
  'invite_team',
  'crm_workspace',
  'crm_first_deal',
  'wms_warehouse',
  'wms_catalog',
  'wms_first_order',
  'projects_first_project',
  'projects_assign_task',
  'projects_connect',
  'pulse_labor_rate',
  'pulse_first_job',
  'pulse_first_entry',
  'pulse_connect',
  'billing_plan',
];

export function isSetupStepKey(value: string): value is SetupStepKey {
  return (SETUP_STEP_KEYS as readonly string[]).includes(value);
}

export interface SetupStep {
  readonly key: SetupStepKey;
  readonly scope: SetupScope;
  readonly title: string;
  readonly description: string;
  readonly cta: string;
  readonly minutes: number;
  /** Completion detected from real data ("Done automatically"), vs. a manual action. */
  readonly auto: boolean;
  readonly status: SetupStepStatus;
  /** Set when the step waits on an earlier step; names what unlocks it. */
  readonly lockedBy: string | null;
}

interface StepBlueprint {
  readonly key: SetupStepKey;
  readonly scope: SetupScope;
  readonly title: string;
  /** Plain text, or text that follows the live signals (the plan step names the trial end date). */
  readonly description: string | ((signals: SetupSignals) => string);
  readonly cta: string;
  readonly minutes: number;
  readonly auto: boolean;
  /** Derived completion from signals; null = not auto-detectable right now. */
  readonly detect: (signals: SetupSignals, profile: SetupProfile | null) => boolean;
  /** Which earlier step must be done first (operational ordering, Logiwa-fix). */
  readonly requires?: SetupStepKey;
  readonly include: (signals: SetupSignals, profile: SetupProfile | null) => boolean;
}

const count = (value: number | null): number => value ?? 0;

const wantsCrm = (signals: SetupSignals, profile: SetupProfile | null): boolean =>
  signals.crmEntitled && (profile === null || profile.focus !== 'wms');
const wantsWms = (signals: SetupSignals, profile: SetupProfile | null): boolean =>
  signals.wmsEntitled && (profile === null || profile.focus !== 'crm');
const wantsProjects = (signals: SetupSignals): boolean => signals.projectsEntitled === true;
/** The cross-app step only makes sense when there is a CRM or WMS to connect to. */
const wantsConnect = (signals: SetupSignals, profile: SetupProfile | null): boolean =>
  wantsProjects(signals) && (wantsCrm(signals, profile) || wantsWms(signals, profile));
const wantsPulse = (signals: SetupSignals): boolean => signals.pulseEntitled === true;
/** Linking a job only makes sense when there is a CRM or WMS record to link it to. */
const wantsPulseConnect = (signals: SetupSignals, profile: SetupProfile | null): boolean =>
  wantsPulse(signals) && (wantsCrm(signals, profile) || wantsWms(signals, profile));
/** Solo founders skip the invite step — unless a teammate or invite shows up anyway. */
const wantsInvite = (signals: SetupSignals, profile: SetupProfile | null): boolean =>
  profile?.teamSize !== 'solo' || signals.memberCount > 1 || signals.pendingInvites > 0;

const BLUEPRINTS: readonly StepBlueprint[] = [
  {
    key: 'profile',
    scope: 'portal',
    title: 'Tell us about your business',
    description: 'Three quick questions to shape this plan.',
    cta: 'Start',
    minutes: 1,
    auto: false,
    detect: () => false,
    include: () => true,
  },
  {
    key: 'invite_team',
    scope: 'portal',
    title: 'Invite your team',
    description: 'Teammates sign in once and get every app your plan includes.',
    cta: 'Invite',
    minutes: 2,
    auto: true,
    detect: (signals) => signals.memberCount > 1 || signals.pendingInvites > 0,
    include: wantsInvite,
  },
  {
    key: 'crm_workspace',
    scope: 'crm',
    title: 'Create your CRM workspace',
    description: 'Pick a ready-made template: boards for deals, contacts and accounts.',
    cta: 'Open CRM',
    minutes: 2,
    auto: true,
    detect: (signals) => count(signals.crmBoards) > 0,
    include: wantsCrm,
  },
  {
    key: 'crm_first_deal',
    scope: 'crm',
    title: 'Add your first deal',
    description: 'Put one real deal on the board.',
    cta: 'Add a deal',
    minutes: 1,
    auto: true,
    detect: (signals) => count(signals.crmDeals) > 0,
    requires: 'crm_workspace',
    include: wantsCrm,
  },
  {
    key: 'wms_warehouse',
    scope: 'wms',
    title: 'Create your warehouse',
    description: 'Name your facility and lay out zones and locations.',
    cta: 'Open WMS',
    minutes: 3,
    auto: true,
    detect: (signals) => count(signals.wmsWarehouses) > 0,
    include: wantsWms,
  },
  {
    key: 'wms_catalog',
    scope: 'wms',
    title: 'Build your product catalog',
    description: 'Create items one by one, or import your whole catalog from a spreadsheet.',
    cta: 'Add products',
    minutes: 3,
    auto: true,
    detect: (signals) => count(signals.wmsProducts) > 0,
    requires: 'wms_warehouse',
    include: wantsWms,
  },
  {
    key: 'wms_first_order',
    scope: 'wms',
    title: 'Create your first order',
    description: 'Run one order through pick, pack and ship.',
    cta: 'Create order',
    minutes: 2,
    auto: true,
    detect: (signals) => count(signals.wmsOrders) > 0,
    requires: 'wms_catalog',
    include: wantsWms,
  },
  {
    key: 'projects_first_project',
    scope: 'projects',
    title: 'Start your first project',
    description: 'Pick a template like Client onboarding or Warehouse go-live, or start from a blank board.',
    cta: 'Start a project',
    minutes: 2,
    auto: true,
    detect: (signals) => count(signals.pmProjects ?? null) > 0,
    include: (signals) => wantsProjects(signals),
  },
  {
    key: 'projects_assign_task',
    scope: 'projects',
    title: 'Give someone a task',
    description: 'Assign one task with a due date.',
    cta: 'Add a task',
    minutes: 1,
    auto: true,
    detect: (signals) => count(signals.pmAssignedTasks ?? null) > 0,
    requires: 'projects_first_project',
    include: (signals) => wantsProjects(signals),
  },
  {
    key: 'projects_connect',
    scope: 'projects',
    title: 'Connect work to a deal or order',
    description: 'Link a project or task to a CRM deal or WMS order.',
    cta: 'Link a record',
    minutes: 1,
    auto: true,
    detect: (signals) => count(signals.pmLinks ?? null) > 0,
    requires: 'projects_first_project',
    include: wantsConnect,
  },
  {
    key: 'pulse_labor_rate',
    scope: 'pulse',
    title: 'Set your labor cost per hour',
    description: 'One number is enough to start: what an hour of work really costs you.',
    cta: 'Set the rate',
    minutes: 2,
    auto: true,
    detect: (signals) => count(signals.pulseLaborRates ?? null) > 0,
    include: (signals) => wantsPulse(signals),
  },
  {
    key: 'pulse_first_job',
    scope: 'pulse',
    title: 'Add your first job',
    description: 'A job is one piece of work for one client, with one price.',
    cta: 'Add a job',
    minutes: 2,
    auto: true,
    detect: (signals) => count(signals.pulseJobs ?? null) > 0,
    include: (signals) => wantsPulse(signals),
  },
  {
    key: 'pulse_first_entry',
    scope: 'pulse',
    title: 'Log a day of work',
    description: 'Type the units made, the people and the hours. Pulse works out the profit.',
    cta: 'Log work',
    minutes: 1,
    auto: true,
    detect: (signals) => count(signals.pulseEntries ?? null) > 0,
    requires: 'pulse_first_job',
    include: (signals) => wantsPulse(signals),
  },
  {
    key: 'pulse_connect',
    scope: 'pulse',
    title: 'Link a job to a deal or work order',
    description: 'A linked job fills in its own client, quantity and price, and shows its profit on that record.',
    cta: 'Link a job',
    minutes: 1,
    auto: true,
    detect: (signals) => count(signals.pulseLinks ?? null) > 0,
    requires: 'pulse_first_job',
    include: wantsPulseConnect,
  },
  {
    // Always the last step. `ready` during a free trial, `done` once a card is on file or the
    // plan is paid. Never shown to teams on a manual grant or with no trial.
    key: 'billing_plan',
    scope: 'portal',
    title: 'Pick your plan',
    description: billingPlanDescription,
    cta: 'Pick a plan',
    minutes: 2,
    auto: true,
    detect: (signals) => signals.billing?.state === 'done',
    include: (signals) => signals.billing !== undefined && signals.billing !== null,
  },
];

function billingPlanDescription(signals: SetupSignals): string {
  const billing = signals.billing;
  if (billing?.state === 'done') return 'Your plan is set.';
  if (billing?.state === 'trial_ended') return 'Your free trial has ended. Pick a plan to keep working.';
  return billing?.trialEndsLabel
    ? `Pick a plan any time before ${billing.trialEndsLabel}. No charge until then.`
    : 'Pick a plan any time during your free trial. No charge until it ends.';
}

/** Steps that always come last, whatever the scope order. */
const LAST_STEPS: readonly SetupStepKey[] = ['billing_plan'];

/** 3PLs and distributors set up the warehouse first; brands start from the pipeline. */
function scopeOrder(profile: SetupProfile | null): readonly SetupScope[] {
  const wmsFirst =
    profile !== null && (profile.businessType === '3pl' || profile.businessType === 'distributor');
  return wmsFirst ? ['portal', 'wms', 'crm', 'projects', 'pulse'] : ['portal', 'crm', 'wms', 'projects', 'pulse'];
}

/** Explicit per-step override rows from core.onboarding_progress. */
export type SetupOverrides = Readonly<Partial<Record<SetupStepKey, 'completed' | 'skipped'>>>;

/** The org-level row that records the Portal guide itself being seen or dismissed. */
export const GUIDE_STEP_KEY = 'guide';

export interface ProgressRow {
  readonly scope: string;
  readonly stepKey: string;
  readonly status: string;
  readonly payload: unknown;
}

export interface ProgressState {
  readonly profile: SetupProfile | null;
  readonly overrides: SetupOverrides;
  readonly dismissed: boolean;
  readonly seen: boolean;
}

/**
 * Folds the org-level core.onboarding_progress rows into the guide's saved state.
 * CRM and WMS keep their own 'guide' rows under their own scope, so only the Portal's
 * row decides whether the Portal guide was seen or dismissed.
 */
export function readProgressRows(rows: readonly ProgressRow[]): ProgressState {
  let profile: SetupProfile | null = null;
  let dismissed = false;
  let seen = false;
  const overrides: Partial<Record<SetupStepKey, 'completed' | 'skipped'>> = {};
  for (const row of rows) {
    if (row.stepKey === GUIDE_STEP_KEY) {
      if (row.scope !== 'portal') continue;
      seen = true;
      dismissed = row.status === 'dismissed';
      continue;
    }
    if (row.stepKey === 'profile' && row.status === 'completed') {
      profile = parseSetupProfile(row.payload);
      overrides.profile = 'completed';
      continue;
    }
    if (isSetupStepKey(row.stepKey) && (row.status === 'completed' || row.status === 'skipped')) {
      overrides[row.stepKey] = row.status;
    }
  }
  return { profile, overrides, dismissed, seen };
}


export function buildSetupSteps(
  signals: SetupSignals,
  profile: SetupProfile | null,
  overrides: SetupOverrides,
): readonly SetupStep[] {
  const order = scopeOrder(profile);
  const included = BLUEPRINTS.filter((blueprint) => blueprint.include(signals, profile))
    // Stable sort: scope order from the profile, original order within a scope.
    .map((blueprint, index) => ({ blueprint, index }))
    .sort(
      (a, b) =>
        Number(LAST_STEPS.includes(a.blueprint.key)) - Number(LAST_STEPS.includes(b.blueprint.key)) ||
        order.indexOf(a.blueprint.scope) - order.indexOf(b.blueprint.scope) ||
        a.index - b.index,
    )
    .map((entry) => entry.blueprint);
  const statusOf = new Map<SetupStepKey, SetupStepStatus>();
  for (const blueprint of included) {
    const override = overrides[blueprint.key];
    const detected =
      blueprint.key === 'profile' ? profile !== null : blueprint.detect(signals, profile);
    const status: SetupStepStatus =
      detected || override === 'completed' ? 'done' : override === 'skipped' ? 'skipped' : 'todo';
    statusOf.set(blueprint.key, status);
  }
  return included.map((blueprint) => {
    const status = statusOf.get(blueprint.key) ?? 'todo';
    const requirement = blueprint.requires;
    const blocked =
      status === 'todo' && requirement !== undefined && statusOf.get(requirement) === 'todo';
    const lockedBy = blocked
      ? (BLUEPRINTS.find((candidate) => candidate.key === requirement)?.title ?? null)
      : null;
    return {
      key: blueprint.key,
      scope: blueprint.scope,
      title: blueprint.title,
      description:
        typeof blueprint.description === 'function' ? blueprint.description(signals) : blueprint.description,
      cta: blueprint.cta,
      minutes: blueprint.minutes,
      auto: blueprint.auto,
      status,
      lockedBy,
    };
  });
}

export interface SetupSummary {
  /** DONE steps only — skips never count as finished work (ONBOARDING.md). */
  readonly doneCount: number;
  readonly skippedCount: number;
  readonly totalCount: number;
  /** Settled (done + skipped) share of the plan; drives the ring. */
  readonly percent: number;
  readonly remainingMinutes: number;
  /** Everything genuinely detected/completed — the only state that earns a celebration. */
  readonly allDone: boolean;
  /** Nothing left to act on, but some steps were skipped (quiet wrap-up, no confetti). */
  readonly allSettled: boolean;
  /** First actionable todo step (not locked), if any. */
  readonly nextKey: SetupStepKey | null;
}

export function summarizeSetup(steps: readonly SetupStep[]): SetupSummary {
  const totalCount = steps.length;
  const settled = steps.filter((step) => step.status !== 'todo').length;
  const doneCount = steps.filter((step) => step.status === 'done').length;
  const skippedCount = steps.filter((step) => step.status === 'skipped').length;
  const remainingMinutes = steps
    .filter((step) => step.status === 'todo')
    .reduce((sum, step) => sum + step.minutes, 0);
  const next = steps.find((step) => step.status === 'todo' && step.lockedBy === null);
  return {
    doneCount,
    skippedCount,
    totalCount,
    percent: totalCount === 0 ? 100 : Math.round((settled / totalCount) * 100),
    remainingMinutes,
    allDone: totalCount > 0 && doneCount === totalCount,
    allSettled: totalCount > 0 && settled === totalCount,
    nextKey: next?.key ?? null,
  };
}

/** The quick start never lists fewer or more steps than this (docs/billing/SPEC.md 5.7, must have 27). */
export const GUIDE_STEPS_MIN = 3;
export const GUIDE_STEPS_MAX = 5;

/**
 * The quick start: the 3 to 5 steps the welcome screen promises and the launcher guide then shows,
 * tied to the apps the team picked. The same list in both places, so the count and the minutes
 * never change between the two screens.
 *
 * It is "Tell us about your business", then the first step of each area in turn (team, then each
 * app), then the second of each, until the list is full. "Pick your plan" always closes the list
 * when the team is in a free trial. The pick looks at what the plan contains, never at what is
 * done, so the list does not reshuffle as steps are ticked off. Every other step is one of the
 * "more steps" the guide folds away; each app's own guide carries those too.
 */
export function pickGuideSteps(steps: readonly SetupStep[], max: number = GUIDE_STEPS_MAX): readonly SetupStep[] {
  const opening = steps.filter((step) => step.key === 'profile');
  const closing = steps.filter((step) => LAST_STEPS.includes(step.key));
  const rest = steps.filter((step) => step.key !== 'profile' && !LAST_STEPS.includes(step.key));
  const room = Math.max(0, max - opening.length - closing.length);

  // One queue per area, in plan order.
  const queues: SetupStep[][] = [];
  for (const step of rest) {
    const queue = queues.find((entry) => entry[0]?.scope === step.scope);
    if (queue) queue.push(step);
    else queues.push([step]);
  }
  const chosen = new Set<SetupStepKey>();
  for (let round = 0; chosen.size < room; round += 1) {
    let took = false;
    for (const queue of queues) {
      const step = queue[round];
      if (step && chosen.size < room) {
        chosen.add(step.key);
        took = true;
      }
    }
    if (!took) break;
  }
  // Back in plan order, so a step never shows above the one that unlocks it.
  return [...opening, ...rest.filter((step) => chosen.has(step.key)), ...closing];
}

/** The steps the quick start leaves out, in plan order. */
export function moreGuideSteps(steps: readonly SetupStep[], max: number = GUIDE_STEPS_MAX): readonly SetupStep[] {
  const picked = new Set(pickGuideSteps(steps, max).map((step) => step.key));
  return steps.filter((step) => !picked.has(step.key));
}
