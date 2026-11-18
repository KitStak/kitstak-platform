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

export interface SetupProfile {
  readonly focus: SetupFocus;
  readonly businessType: BusinessType;
  readonly teamSize: TeamSize;
  readonly startMode: StartMode;
}

export const SETUP_FOCUSES: readonly SetupFocus[] = ['wms', 'crm', 'both'];
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
  };
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
  | 'pulse_connect';

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
  readonly description: string;
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
];

/** 3PLs and distributors set up the warehouse first; brands start from the pipeline. */
function scopeOrder(profile: SetupProfile | null): readonly SetupScope[] {
  const wmsFirst =
    profile !== null && (profile.businessType === '3pl' || profile.businessType === 'distributor');
  return wmsFirst ? ['portal', 'wms', 'crm', 'projects', 'pulse'] : ['portal', 'crm', 'wms', 'projects', 'pulse'];
}

/** Explicit per-step override rows from core.onboarding_progress. */
export type SetupOverrides = Readonly<Partial<Record<SetupStepKey, 'completed' | 'skipped'>>>;

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
        order.indexOf(a.blueprint.scope) - order.indexOf(b.blueprint.scope) || a.index - b.index,
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
      description: blueprint.description,
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
