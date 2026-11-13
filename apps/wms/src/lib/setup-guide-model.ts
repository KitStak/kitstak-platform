/**
 * "Get set up" guide model (cross-app onboarding, WMS half).
 *
 * PURE module (no server imports): the dashboard panel and the server loader share it.
 * Setup state is DERIVED from live row counts — the operationally correct order is
 * encoded here (warehouse → locations → clients → products → first order), so new
 * installs are never left guessing what to create first. `core.onboarding_progress`
 * (scope 'wms', org-level rows) only stores what the system cannot observe: per-step
 * skips, the guide dismissal and the "seen" rollout marker. Live detection always
 * beats a stale skip. Contract: docs/integration/ONBOARDING.md.
 */

export const SETUP_STEP_KEYS = [
  'wms_warehouse',
  'wms_locations',
  'wms_client',
  'wms_catalog',
  'wms_first_order',
] as const;

export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

/**
 * The org-level guide row's step key. One row, two meanings: status 'dismissed' hides
 * the guide; status 'completed' is the rollout "seen" marker (the guide rendered at
 * least once while incomplete, so the celebration is earned, not a deploy surprise).
 */
export const SETUP_GUIDE_KEY = 'guide';

export interface SetupStepLink {
  readonly label: string;
  readonly href: string;
  /** Any-of permission keys needed to follow the link (nav view keys). */
  readonly permission: readonly string[];
}

export interface SetupStepDef {
  readonly key: SetupStepKey;
  readonly title: string;
  readonly description: string;
  /** Rough effort shown as "about N min left". */
  readonly minutes: number;
  readonly cta: SetupStepLink;
  /** Alternate path (e.g. spreadsheet import for the catalog step). */
  readonly secondary?: SetupStepLink;
  /** Locked until this step is done OR skipped (skipping unlocks dependents). */
  readonly dependsOn: SetupStepKey | null;
}

/** Operational order. Each step unlocks when its dependency is done or skipped. */
export const SETUP_STEPS: readonly SetupStepDef[] = [
  {
    key: 'wms_warehouse',
    title: 'Create your warehouse',
    description: 'Name, address and time zone. Everything else hangs off a facility.',
    minutes: 2,
    cta: { label: 'Add warehouse', href: '/settings/warehouses', permission: ['settings.warehouse.view'] },
    dependsOn: null,
  },
  {
    key: 'wms_locations',
    title: 'Add storage locations',
    description: 'Racks, bins and staging areas inside the warehouse, one by one or from Excel.',
    minutes: 3,
    cta: { label: 'Add locations', href: '/locations', permission: ['settings.locations.view'] },
    dependsOn: 'wms_warehouse',
  },
  {
    key: 'wms_client',
    title: 'Add your first client',
    description: 'The company you fulfill for. Products and orders belong to a client.',
    minutes: 2,
    cta: { label: 'Add client', href: '/clients', permission: ['settings.clients.view'] },
    dependsOn: 'wms_warehouse',
  },
  {
    key: 'wms_catalog',
    title: 'Build your product catalog',
    description: 'SKUs, barcodes and units for the client you just added.',
    minutes: 5,
    cta: { label: 'Add products', href: '/products', permission: ['settings.products.view'] },
    secondary: {
      label: 'Import from a spreadsheet',
      href: '/imports/products',
      permission: ['settings.products.import_file'],
    },
    dependsOn: 'wms_client',
  },
  {
    key: 'wms_first_order',
    title: 'Create your first order',
    description: 'A shipment order proves the whole flow: allocate, pick, pack, ship.',
    minutes: 3,
    cta: { label: 'Create order', href: '/orders', permission: ['fulfillment.shipment_orders.view'] },
    dependsOn: 'wms_catalog',
  },
];

export type SetupStepStatus = 'done' | 'ready' | 'skipped' | 'locked';

export interface SetupStepState extends SetupStepDef {
  readonly status: SetupStepStatus;
  /** Title of the unmet dependency ("Unlocks after Create your warehouse"). */
  readonly lockedBy: string | null;
}

export interface SetupProgressRow {
  readonly stepKey: string;
  readonly status: string;
}

export interface SetupGuideInput {
  /** Live row counts (or 0/1 existence flags) per step's target table. */
  readonly counts: Readonly<Record<SetupStepKey, number>>;
  /** Org-level `core.onboarding_progress` rows for scope 'wms' (user_id IS NULL). */
  readonly rows: readonly SetupProgressRow[];
}

export interface SetupGuide {
  readonly steps: readonly SetupStepState[];
  readonly totalCount: number;
  /** Steps done: live-detected or stored 'completed' (skips never count here). */
  readonly completedCount: number;
  /** Steps explicitly skipped (and not since detected done). */
  readonly skippedCount: number;
  /** Settled steps (done + skipped) — the progress-ring numerator. */
  readonly settledCount: number;
  /** Every step DONE → celebration state. Skips never celebrate. */
  readonly allDone: boolean;
  /** Every step settled (done or skipped) → quiet "wrapped up" state when not allDone. */
  readonly allSettled: boolean;
  /** Org-level 'guide' row with status 'dismissed'. */
  readonly dismissed: boolean;
  /** Org-level 'guide' row with status 'completed' (rollout "seen" marker). */
  readonly seen: boolean;
  /** Minutes of work still ahead (steps neither done nor skipped). */
  readonly remainingMinutes: number;
  /**
   * Render the panel at all: `!dismissed && (!allDone || seen)`. An install that was
   * already fully set up before the guide shipped never sees it (or its celebration).
   */
  readonly visible: boolean;
}

function isDetectedDone(counts: SetupGuideInput['counts'], key: SetupStepKey): boolean {
  return (counts[key] ?? 0) > 0;
}

/**
 * Derives the full guide state. Precedence per step:
 * done (live data or stored 'completed') > skipped (explicit org-level row) >
 * locked (dependency neither done nor skipped) > ready.
 */
export function deriveSetupGuide(input: SetupGuideInput): SetupGuide {
  const rowStatus = new Map(input.rows.map((r) => [r.stepKey, r.status]));
  const guideStatus = rowStatus.get(SETUP_GUIDE_KEY);
  const dismissed = guideStatus === 'dismissed';
  const seen = guideStatus === 'completed';
  const titleOf = new Map(SETUP_STEPS.map((s) => [s.key, s.title]));

  const isDone = (key: SetupStepKey): boolean =>
    isDetectedDone(input.counts, key) || rowStatus.get(key) === 'completed';
  const isSkipped = (key: SetupStepKey): boolean => !isDone(key) && rowStatus.get(key) === 'skipped';

  const steps: SetupStepState[] = SETUP_STEPS.map((def) => {
    // A skipped prerequisite UNLOCKS its dependents; locked means "neither done nor skipped".
    const depSettled =
      def.dependsOn === null || isDone(def.dependsOn) || isSkipped(def.dependsOn);
    let status: SetupStepStatus;
    if (isDone(def.key)) status = 'done';
    else if (isSkipped(def.key)) status = 'skipped';
    else if (!depSettled) status = 'locked';
    else status = 'ready';
    const lockedBy =
      status === 'locked' && def.dependsOn ? (titleOf.get(def.dependsOn) ?? null) : null;
    return { ...def, status, lockedBy };
  });

  const completedCount = steps.filter((s) => s.status === 'done').length;
  const skippedCount = steps.filter((s) => s.status === 'skipped').length;
  const settledCount = completedCount + skippedCount;
  const allDone = completedCount === steps.length;
  const allSettled = settledCount === steps.length;
  const remainingMinutes = steps
    .filter((s) => s.status === 'locked' || s.status === 'ready')
    .reduce((sum, s) => sum + s.minutes, 0);

  return {
    steps,
    totalCount: steps.length,
    completedCount,
    skippedCount,
    settledCount,
    allDone,
    allSettled,
    dismissed,
    seen,
    remainingMinutes,
    visible: !dismissed && (!allDone || seen),
  };
}

/** "2 of 5 complete · about 10 min left" (no time suffix when nothing is left). */
export function setupSummaryLabel(guide: Pick<SetupGuide, 'completedCount' | 'totalCount' | 'remainingMinutes'>): string {
  const base = `${guide.completedCount} of ${guide.totalCount} complete`;
  return guide.remainingMinutes > 0 ? `${base} · about ${guide.remainingMinutes} min left` : base;
}

/** Deep links carry the step so the destination shell can show the setup callout. */
export function setupStepHref(href: string, key: SetupStepKey): string {
  return `${href}${href.includes('?') ? '&' : '?'}setup=${key}`;
}
