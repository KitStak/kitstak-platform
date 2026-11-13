import { describe, expect, it } from 'vitest';
import {
  deriveSetupGuide,
  SETUP_GUIDE_KEY,
  SETUP_STEP_KEYS,
  SETUP_STEPS,
  setupStepHref,
  setupSummaryLabel,
  type SetupGuideInput,
  type SetupStepKey,
} from './setup-guide-model';

const counts = (overrides: Partial<Record<SetupStepKey, number>> = {}): SetupGuideInput['counts'] => ({
  wms_warehouse: 0,
  wms_locations: 0,
  wms_client: 0,
  wms_catalog: 0,
  wms_first_order: 0,
  ...overrides,
});

const derive = (
  c: Partial<Record<SetupStepKey, number>> = {},
  rows: SetupGuideInput['rows'] = [],
) => deriveSetupGuide({ counts: counts(c), rows });

const statusOf = (guide: ReturnType<typeof derive>, key: SetupStepKey) =>
  guide.steps.find((s) => s.key === key)?.status;

const ALL_DONE_COUNTS = {
  wms_warehouse: 1,
  wms_locations: 1,
  wms_client: 1,
  wms_catalog: 1,
  wms_first_order: 1,
} as const;

describe('deriveSetupGuide', () => {
  it('keeps the operational order: warehouse, locations, client, catalog, first order', () => {
    // Arrange / Act
    const guide = derive();

    // Assert
    expect(guide.steps.map((s) => s.key)).toEqual([...SETUP_STEP_KEYS]);
    expect(SETUP_STEPS.map((s) => s.key)).toEqual([...SETUP_STEP_KEYS]);
  });

  it('uses the canonical contract step titles exactly', () => {
    expect(SETUP_STEPS.map((s) => s.title)).toEqual([
      'Create your warehouse',
      'Add storage locations',
      'Add your first client',
      'Build your product catalog',
      'Create your first order',
    ]);
  });

  it('starts a fresh install with only the warehouse step actionable', () => {
    const guide = derive();

    expect(statusOf(guide, 'wms_warehouse')).toBe('ready');
    expect(statusOf(guide, 'wms_locations')).toBe('locked');
    expect(statusOf(guide, 'wms_client')).toBe('locked');
    expect(statusOf(guide, 'wms_catalog')).toBe('locked');
    expect(statusOf(guide, 'wms_first_order')).toBe('locked');
    expect(guide.completedCount).toBe(0);
    expect(guide.visible).toBe(true);
  });

  it('unlocks locations and clients once a warehouse exists, but not the catalog', () => {
    const guide = derive({ wms_warehouse: 1 });

    expect(statusOf(guide, 'wms_warehouse')).toBe('done');
    expect(statusOf(guide, 'wms_locations')).toBe('ready');
    expect(statusOf(guide, 'wms_client')).toBe('ready');
    expect(statusOf(guide, 'wms_catalog')).toBe('locked');
    expect(statusOf(guide, 'wms_first_order')).toBe('locked');
  });

  it('names the unmet dependency on locked rows', () => {
    const guide = derive({ wms_warehouse: 1 });

    const catalog = guide.steps.find((s) => s.key === 'wms_catalog');
    expect(catalog?.lockedBy).toBe('Add your first client');
    const ready = guide.steps.find((s) => s.key === 'wms_locations');
    expect(ready?.lockedBy).toBeNull();
  });

  it('keeps the catalog locked behind a client and the first order behind products', () => {
    expect(statusOf(derive({ wms_warehouse: 1, wms_client: 1 }), 'wms_catalog')).toBe('ready');
    expect(statusOf(derive({ wms_warehouse: 1, wms_client: 1 }), 'wms_first_order')).toBe('locked');
    expect(
      statusOf(derive({ wms_warehouse: 1, wms_client: 1, wms_catalog: 1 }), 'wms_first_order'),
    ).toBe('ready');
  });

  it('marks an explicitly skipped step as skipped', () => {
    const guide = derive({ wms_warehouse: 1 }, [{ stepKey: 'wms_locations', status: 'skipped' }]);

    expect(statusOf(guide, 'wms_locations')).toBe('skipped');
    // Skips never count as completed, but they do settle.
    expect(guide.completedCount).toBe(1);
    expect(guide.skippedCount).toBe(1);
    expect(guide.settledCount).toBe(2);
  });

  it('UNLOCKS dependents when their prerequisite is skipped (no skip-trap)', () => {
    // Mid-chain skip: warehouse done, client skipped → the catalog must open up.
    const guide = derive({ wms_warehouse: 1 }, [{ stepKey: 'wms_client', status: 'skipped' }]);

    expect(statusOf(guide, 'wms_client')).toBe('skipped');
    expect(statusOf(guide, 'wms_catalog')).toBe('ready');
    // The first order still waits on the catalog (neither done nor skipped).
    expect(statusOf(guide, 'wms_first_order')).toBe('locked');
  });

  it('unlocks the whole chain when every prerequisite is skipped in turn', () => {
    const guide = derive({}, [
      { stepKey: 'wms_warehouse', status: 'skipped' },
      { stepKey: 'wms_client', status: 'skipped' },
      { stepKey: 'wms_catalog', status: 'skipped' },
    ]);

    expect(statusOf(guide, 'wms_locations')).toBe('ready');
    expect(statusOf(guide, 'wms_first_order')).toBe('ready');
  });

  it('lets live detection beat a stale skip', () => {
    const guide = derive({ wms_warehouse: 1, wms_locations: 4 }, [
      { stepKey: 'wms_locations', status: 'skipped' },
    ]);

    expect(statusOf(guide, 'wms_locations')).toBe('done');
    expect(guide.completedCount).toBe(2);
    expect(guide.skippedCount).toBe(0);
  });

  it('honors a stored completed row as done (contract: done = detected OR stored completed)', () => {
    const guide = derive({}, [{ stepKey: 'wms_warehouse', status: 'completed' }]);

    expect(statusOf(guide, 'wms_warehouse')).toBe('done');
    expect(statusOf(guide, 'wms_locations')).toBe('ready');
    expect(guide.completedCount).toBe(1);
  });

  it('shows a skipped-but-still-locked step as skipped (the user chose to hide it)', () => {
    const guide = derive({}, [{ stepKey: 'wms_locations', status: 'skipped' }]);

    expect(statusOf(guide, 'wms_locations')).toBe('skipped');
  });

  it('hides the guide only on an org-level dismissal row', () => {
    expect(derive().dismissed).toBe(false);
    const dismissed = derive({}, [{ stepKey: SETUP_GUIDE_KEY, status: 'dismissed' }]);
    expect(dismissed.dismissed).toBe(true);
    expect(dismissed.visible).toBe(false);
    // A 'guide' seen row (or a dismissal stored on a step key) does not hide it.
    expect(derive({}, [{ stepKey: SETUP_GUIDE_KEY, status: 'completed' }]).visible).toBe(true);
    expect(derive({}, [{ stepKey: 'wms_locations', status: 'dismissed' }]).visible).toBe(true);
  });

  it('celebrates only when every step is detected complete, never on skips', () => {
    const partial = derive({ wms_warehouse: 1, wms_locations: 1, wms_client: 1, wms_catalog: 1 });
    expect(partial.allDone).toBe(false);

    const all = derive(ALL_DONE_COUNTS);
    expect(all.allDone).toBe(true);
    expect(all.completedCount).toBe(5);
    expect(all.remainingMinutes).toBe(0);
    // Skipping everything is NOT the celebration: nothing real exists yet.
    const allSkipped = derive(
      {},
      SETUP_STEP_KEYS.map((stepKey) => ({ stepKey, status: 'skipped' })),
    );
    expect(allSkipped.allDone).toBe(false);
  });

  it('reports all-settled-with-skips as wrapped up (allSettled, not allDone)', () => {
    const guide = derive({ wms_warehouse: 1, wms_locations: 1, wms_client: 1 }, [
      { stepKey: 'wms_catalog', status: 'skipped' },
      { stepKey: 'wms_first_order', status: 'skipped' },
    ]);

    expect(guide.allDone).toBe(false);
    expect(guide.allSettled).toBe(true);
    expect(guide.skippedCount).toBe(2);
    expect(guide.settledCount).toBe(5);
    expect(guide.remainingMinutes).toBe(0);
    // Still visible (no dismissal): the quiet wrap-up row, never a frozen checklist.
    expect(guide.visible).toBe(true);
  });

  it('rollout guard: an already-finished install never sees the guide without a seen marker', () => {
    // Mature install on deploy day: everything detected done, no 'guide' row ever written.
    const mature = derive(ALL_DONE_COUNTS);
    expect(mature.allDone).toBe(true);
    expect(mature.seen).toBe(false);
    expect(mature.visible).toBe(false);

    // An install that used the guide (seen marker written) earns its celebration.
    const earned = derive(ALL_DONE_COUNTS, [{ stepKey: SETUP_GUIDE_KEY, status: 'completed' }]);
    expect(earned.seen).toBe(true);
    expect(earned.visible).toBe(true);

    // Dismissed always wins.
    const dismissed = derive(ALL_DONE_COUNTS, [{ stepKey: SETUP_GUIDE_KEY, status: 'dismissed' }]);
    expect(dismissed.visible).toBe(false);

    // Incomplete installs are visible with or without the marker.
    expect(derive({ wms_warehouse: 1 }).visible).toBe(true);
  });

  it('ignores unknown step keys and unknown statuses', () => {
    const guide = derive({}, [
      { stepKey: 'crm_pipeline', status: 'skipped' },
      { stepKey: 'wms_warehouse', status: 'bogus' },
    ]);

    expect(statusOf(guide, 'wms_warehouse')).toBe('ready');
    expect(guide.completedCount).toBe(0);
  });

  it('counts remaining minutes for undone, unskipped steps (locked included)', () => {
    const total = SETUP_STEPS.reduce((sum, s) => sum + s.minutes, 0);
    expect(derive().remainingMinutes).toBe(total);

    const warehouse = SETUP_STEPS.find((s) => s.key === 'wms_warehouse');
    const locations = SETUP_STEPS.find((s) => s.key === 'wms_locations');
    const guide = derive({ wms_warehouse: 1 }, [{ stepKey: 'wms_locations', status: 'skipped' }]);
    expect(guide.remainingMinutes).toBe(total - (warehouse?.minutes ?? 0) - (locations?.minutes ?? 0));
  });
});

describe('setupSummaryLabel', () => {
  it('reads "2 of 5 complete · about N min left" while work remains', () => {
    expect(setupSummaryLabel({ completedCount: 2, totalCount: 5, remainingMinutes: 10 })).toBe(
      '2 of 5 complete · about 10 min left',
    );
  });

  it('drops the time suffix when nothing is left', () => {
    expect(setupSummaryLabel({ completedCount: 5, totalCount: 5, remainingMinutes: 0 })).toBe(
      '5 of 5 complete',
    );
  });
});

describe('setupStepHref', () => {
  it('appends the setup step key for the in-context callout', () => {
    expect(setupStepHref('/settings/warehouses', 'wms_warehouse')).toBe(
      '/settings/warehouses?setup=wms_warehouse',
    );
  });

  it('keeps an existing query string intact', () => {
    expect(setupStepHref('/orders?view=open', 'wms_first_order')).toBe(
      '/orders?view=open&setup=wms_first_order',
    );
  });
});
