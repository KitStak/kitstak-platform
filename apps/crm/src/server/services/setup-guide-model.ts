/**
 * Pure derivation logic for the CRM "Getting started" guide (setup-guide module).
 *
 * Follows the cross-app onboarding contract (docs/integration/ONBOARDING.md):
 *   - Per-step precedence: done (live-detected) > skipped > locked > ready.
 *   - `doneCount` counts done only; ring percent = settled (done + skipped) / total.
 *   - Celebration requires `doneCount === totalCount`; all-settled-with-skips is a
 *     quiet "wrapped up" state, never confetti.
 *   - Rollout guard: `visible = !dismissed && (!allDone || seen)` — an org that was
 *     already fully set up before this shipped never sees the guide.
 *
 * Step completion is DERIVED live from real org data (boards, items, members,
 * dashboards) — never stored. `core.onboarding_progress` rows only record what the
 * system cannot observe: explicit skips (`status: 'skipped'` per step) and the guide
 * row (stepKey 'guide': `completed` = seen marker, `dismissed` = hidden). Live
 * detection always beats a stale skip.
 *
 * Pure module (no db imports) so the client can share the types and the unit tests
 * need no database.
 */

export const SETUP_GUIDE_SCOPE = 'crm' as const;

/** Org-level guide row (not a step): status 'completed' = seen, 'dismissed' = hidden. */
export const SETUP_GUIDE_ROW_KEY = 'guide' as const;
/** @deprecated alias kept for existing imports; prefer SETUP_GUIDE_ROW_KEY. */
export const SETUP_GUIDE_DISMISS_KEY = SETUP_GUIDE_ROW_KEY;

export const SETUP_STEP_KEYS = [
  'crm_workspace',
  'crm_first_deal',
  'invite_team',
  'crm_dashboard',
] as const;
export type SetupStepKey = (typeof SETUP_STEP_KEYS)[number];

export type SetupStepAction = 'templates' | 'pipeline' | 'invite' | 'dashboards';
export type SetupStepStatus = 'ready' | 'done' | 'skipped' | 'locked';

export interface SetupGuideStepDto {
  readonly key: SetupStepKey;
  readonly title: string;
  readonly description: string;
  readonly status: SetupStepStatus;
  /** What the row's CTA opens (wizard or navigation; resolved client-side). */
  readonly action: SetupStepAction;
  /** Navigation target for the action when one exists (e.g. the deals board id). */
  readonly targetId: string | null;
  /** Rough effort estimate shown on actionable rows ("~N min"). */
  readonly minutes: number;
  /** Completion detected from real data → done rows read "Done · detected". */
  readonly auto: boolean;
  /** Title of the prerequisite blocking this step (status 'locked' only). */
  readonly lockedBy: string | null;
}

export interface SetupGuideDto {
  readonly steps: readonly SetupGuideStepDto[];
  /** Steps completed for real (live signal). Skips NEVER count here. */
  readonly doneCount: number;
  readonly skippedCount: number;
  readonly totalCount: number;
  /** Settled (done + skipped) / total, 0–100 — what the progress ring shows. */
  readonly percent: number;
  /** Every step genuinely done → the only state that may celebrate. */
  readonly allDone: boolean;
  /** Every step done or skipped (quiet "wrapped up" row when not allDone). */
  readonly allSettled: boolean;
  /** Minutes left across ready + locked steps. */
  readonly remainingMinutes: number;
  /** Org-level guide row says the guide rendered while incomplete (rollout guard). */
  readonly seen: boolean;
  /** Org-level "Dismiss guide" was used. */
  readonly dismissed: boolean;
  /** Rollout guard: `!dismissed && (!allDone || seen)`. The card renders only this. */
  readonly visible: boolean;
}

interface StepDefinition {
  readonly key: SetupStepKey;
  readonly title: string;
  readonly description: string;
  readonly action: SetupStepAction;
  readonly minutes: number;
  /** Earlier step that must be done or skipped first (locked otherwise). */
  readonly requires?: SetupStepKey;
}

/** Canonical titles come from the portal contract table; crm_dashboard is CRM-only. */
export const SETUP_GUIDE_STEPS: readonly StepDefinition[] = [
  {
    key: 'crm_workspace',
    title: 'Create your CRM workspace',
    description: 'Start from a template — leads, deals, contacts and accounts, wired together.',
    action: 'templates',
    minutes: 2,
  },
  {
    key: 'crm_first_deal',
    title: 'Add your first deal',
    description: 'Add a deal to your pipeline and watch stages, totals and forecasts come alive.',
    action: 'pipeline',
    minutes: 1,
    requires: 'crm_workspace',
  },
  {
    key: 'invite_team',
    title: 'Invite your team',
    description: 'Bring colleagues in so deals, activities and accounts have owners.',
    action: 'invite',
    minutes: 2,
  },
  {
    key: 'crm_dashboard',
    title: 'Create a dashboard',
    description: 'See pipeline value, win rate and team performance at a glance.',
    action: 'dashboards',
    minutes: 1,
    requires: 'crm_workspace',
  },
];

/** Write actions accepted by POST /setup-guide (zod schema lives in setup-guide.ts). */
export type SetupGuideActionInput =
  | { readonly action: 'skip' | 'unskip'; readonly stepKey: SetupStepKey }
  | { readonly action: 'dismiss' | 'restore' };

/** Live facts read from the org's real data (see setup-guide.ts for the queries). */
export interface SetupGuideSignals {
  /** Org has at least one non-deleted, non-archived board. */
  readonly hasBoard: boolean;
  /** At least one top-level item on a live (non-deleted, non-archived) deals board. */
  readonly hasDeal: boolean;
  /** More than one ACTIVE member (deactivated roles excluded), or a pending unexpired invitation. */
  readonly hasTeam: boolean;
  /** Org has at least one non-deleted dashboard. */
  readonly hasDashboard: boolean;
  /** Oldest live deals board (CTA navigation target for the pipeline step). */
  readonly dealsBoardId: string | null;
}

/** Org-level `core.onboarding_progress` row (scope 'crm', user_id NULL). */
export interface SetupProgressRow {
  readonly stepKey: string;
  readonly status: 'completed' | 'skipped' | 'dismissed';
}

function liveDone(key: SetupStepKey, signals: SetupGuideSignals): boolean {
  switch (key) {
    case 'crm_workspace':
      return signals.hasBoard;
    case 'crm_first_deal':
      return signals.hasDeal;
    case 'invite_team':
      return signals.hasTeam;
    case 'crm_dashboard':
      return signals.hasDashboard;
  }
}

export function isSetupStepKey(value: string): value is SetupStepKey {
  return (SETUP_STEP_KEYS as readonly string[]).includes(value);
}

/** Combine live signals with stored progress rows into the guide DTO. */
export function buildSetupGuide(
  signals: SetupGuideSignals,
  rows: readonly SetupProgressRow[],
): SetupGuideDto {
  const skipped = new Set(
    rows
      .filter((row) => row.status === 'skipped' && isSetupStepKey(row.stepKey))
      .map((row) => row.stepKey),
  );
  // Contract: done = live-detected OR stored 'completed' (another app may record it).
  const storedDone = new Set(
    rows
      .filter((row) => row.status === 'completed' && isSetupStepKey(row.stepKey))
      .map((row) => row.stepKey),
  );
  const guideRow = rows.find((row) => row.stepKey === SETUP_GUIDE_ROW_KEY);
  const dismissed = guideRow?.status === 'dismissed';
  const seen = guideRow?.status === 'completed';

  const doneKey = (key: SetupStepKey): boolean => liveDone(key, signals) || storedDone.has(key);
  const settledKey = (key: SetupStepKey): boolean => doneKey(key) || skipped.has(key);
  const titleOf = (key: SetupStepKey): string =>
    SETUP_GUIDE_STEPS.find((definition) => definition.key === key)?.title ?? key;

  const steps: SetupGuideStepDto[] = SETUP_GUIDE_STEPS.map((definition) => {
    const done = doneKey(definition.key);
    const blockedBy =
      definition.requires !== undefined && !settledKey(definition.requires)
        ? definition.requires
        : null;
    const status: SetupStepStatus = done
      ? 'done'
      : skipped.has(definition.key)
        ? 'skipped'
        : blockedBy !== null
          ? 'locked'
          : 'ready';
    return {
      key: definition.key,
      title: definition.title,
      description: definition.description,
      status,
      action: definition.action,
      targetId: definition.action === 'pipeline' ? signals.dealsBoardId : null,
      minutes: definition.minutes,
      auto: true,
      lockedBy: status === 'locked' && blockedBy !== null ? titleOf(blockedBy) : null,
    };
  });

  const doneCount = steps.filter((step) => step.status === 'done').length;
  const skippedCount = steps.filter((step) => step.status === 'skipped').length;
  const totalCount = steps.length;
  const settled = doneCount + skippedCount;
  const percent = totalCount === 0 ? 0 : Math.round((settled / totalCount) * 100);
  const allDone = totalCount > 0 && doneCount === totalCount;
  const allSettled = totalCount > 0 && settled === totalCount;
  const remainingMinutes = steps
    .filter((step) => step.status === 'ready' || step.status === 'locked')
    .reduce((sum, step) => sum + step.minutes, 0);
  const visible = !dismissed && (!allDone || seen);
  return {
    steps,
    doneCount,
    skippedCount,
    totalCount,
    percent,
    allDone,
    allSettled,
    remainingMinutes,
    seen,
    dismissed,
    visible,
  };
}
