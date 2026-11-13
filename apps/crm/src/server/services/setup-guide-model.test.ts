import { describe, expect, it } from 'vitest';
import {
  buildSetupGuide,
  isSetupStepKey,
  SETUP_GUIDE_ROW_KEY,
  SETUP_STEP_KEYS,
  type SetupGuideSignals,
  type SetupProgressRow,
} from './setup-guide-model';

function signals(overrides: Partial<SetupGuideSignals> = {}): SetupGuideSignals {
  return {
    hasBoard: false,
    hasDeal: false,
    hasTeam: false,
    hasDashboard: false,
    dealsBoardId: null,
    ...overrides,
  };
}

const statusByKey = (guide: ReturnType<typeof buildSetupGuide>) =>
  new Map(guide.steps.map((step) => [step.key, step.status]));

describe('buildSetupGuide', () => {
  it('starts a brand-new org with ready steps, locking the ones behind the workspace', () => {
    // Arrange + Act
    const guide = buildSetupGuide(signals(), []);

    // Assert
    expect(guide.steps.map((step) => step.key)).toEqual([...SETUP_STEP_KEYS]);
    const byKey = statusByKey(guide);
    expect(byKey.get('crm_workspace')).toBe('ready');
    expect(byKey.get('invite_team')).toBe('ready');
    // crm_first_deal and crm_dashboard require the workspace (done or skipped).
    expect(byKey.get('crm_first_deal')).toBe('locked');
    expect(byKey.get('crm_dashboard')).toBe('locked');
    expect(guide.doneCount).toBe(0);
    expect(guide.totalCount).toBe(4);
    expect(guide.percent).toBe(0);
    expect(guide.allDone).toBe(false);
    expect(guide.allSettled).toBe(false);
    expect(guide.dismissed).toBe(false);
  });

  it('uses the canonical contract titles', () => {
    const guide = buildSetupGuide(signals(), []);

    const titles = new Map(guide.steps.map((step) => [step.key, step.title]));
    expect(titles.get('crm_workspace')).toBe('Create your CRM workspace');
    expect(titles.get('crm_first_deal')).toBe('Add your first deal');
    expect(titles.get('invite_team')).toBe('Invite your team');
    expect(titles.get('crm_dashboard')).toBe('Create a dashboard');
  });

  it('names the prerequisite that locks a step', () => {
    const guide = buildSetupGuide(signals(), []);

    const deal = guide.steps.find((step) => step.key === 'crm_first_deal');
    expect(deal?.lockedBy).toBe('Create your CRM workspace');
    const workspace = guide.steps.find((step) => step.key === 'crm_workspace');
    expect(workspace?.lockedBy).toBeNull();
  });

  it('unlocks dependents when the prerequisite is done OR skipped', () => {
    const doneGuide = buildSetupGuide(signals({ hasBoard: true }), []);
    expect(statusByKey(doneGuide).get('crm_first_deal')).toBe('ready');

    const skipRows: SetupProgressRow[] = [{ stepKey: 'crm_workspace', status: 'skipped' }];
    const skippedGuide = buildSetupGuide(signals(), skipRows);
    expect(statusByKey(skippedGuide).get('crm_first_deal')).toBe('ready');
    expect(statusByKey(skippedGuide).get('crm_dashboard')).toBe('ready');
  });

  it('derives done status from live signals and counts done only', () => {
    const guide = buildSetupGuide(signals({ hasBoard: true, hasTeam: true }), []);

    const byKey = statusByKey(guide);
    expect(byKey.get('crm_workspace')).toBe('done');
    expect(byKey.get('invite_team')).toBe('done');
    expect(byKey.get('crm_first_deal')).toBe('ready');
    expect(guide.doneCount).toBe(2);
    expect(guide.percent).toBe(50);
  });

  it('counts skipped steps toward percent but NEVER toward doneCount', () => {
    const rows: SetupProgressRow[] = [{ stepKey: 'crm_dashboard', status: 'skipped' }];

    const guide = buildSetupGuide(signals({ hasBoard: true }), rows);

    const dashboard = guide.steps.find((step) => step.key === 'crm_dashboard');
    expect(dashboard?.status).toBe('skipped');
    expect(guide.doneCount).toBe(1); // only the live-done workspace step
    expect(guide.skippedCount).toBe(1);
    expect(guide.percent).toBe(50); // (done + skipped) / 4
  });

  it('lets live detection beat a stale skip', () => {
    const rows: SetupProgressRow[] = [
      { stepKey: 'crm_workspace', status: 'skipped' },
      { stepKey: 'crm_first_deal', status: 'skipped' },
    ];

    const guide = buildSetupGuide(signals({ hasBoard: true, hasDeal: true }), rows);

    expect(statusByKey(guide).get('crm_workspace')).toBe('done');
    expect(statusByKey(guide).get('crm_first_deal')).toBe('done');
    expect(guide.doneCount).toBe(2);
  });

  it('celebrates ONLY when every step is genuinely done', () => {
    const guide = buildSetupGuide(
      signals({ hasBoard: true, hasDeal: true, hasTeam: true, hasDashboard: true }),
      [{ stepKey: SETUP_GUIDE_ROW_KEY, status: 'completed' }],
    );

    expect(guide.doneCount).toBe(4);
    expect(guide.percent).toBe(100);
    expect(guide.allDone).toBe(true);
    expect(guide.allSettled).toBe(true);
  });

  it('treats all-settled-with-skips as wrapped up, never as a celebration', () => {
    const rows: SetupProgressRow[] = [{ stepKey: 'invite_team', status: 'skipped' }];

    const guide = buildSetupGuide(
      signals({ hasBoard: true, hasDeal: true, hasDashboard: true }),
      rows,
    );

    expect(guide.percent).toBe(100);
    expect(guide.doneCount).toBe(3);
    expect(guide.skippedCount).toBe(1);
    expect(guide.allSettled).toBe(true);
    expect(guide.allDone).toBe(false); // → quiet "wrapped up" row, no confetti
    expect(guide.visible).toBe(true); // incomplete (not allDone), so visible
  });

  it('sums remaining minutes across ready and locked steps only', () => {
    const fresh = buildSetupGuide(signals(), []);
    // workspace 2 + deal 1 + invite 2 + dashboard 1
    expect(fresh.remainingMinutes).toBe(6);

    const partial = buildSetupGuide(signals({ hasBoard: true, hasTeam: true }), []);
    expect(partial.remainingMinutes).toBe(2); // deal 1 + dashboard 1
  });

  describe('rollout guard (seen marker)', () => {
    it('hides the guide from an org that was already fully set up (no seen row)', () => {
      const guide = buildSetupGuide(
        signals({ hasBoard: true, hasDeal: true, hasTeam: true, hasDashboard: true }),
        [],
      );

      expect(guide.allDone).toBe(true);
      expect(guide.seen).toBe(false);
      expect(guide.visible).toBe(false); // no surprise celebration
    });

    it('keeps an all-done guide visible when the seen marker exists', () => {
      const guide = buildSetupGuide(
        signals({ hasBoard: true, hasDeal: true, hasTeam: true, hasDashboard: true }),
        [{ stepKey: SETUP_GUIDE_ROW_KEY, status: 'completed' }],
      );

      expect(guide.seen).toBe(true);
      expect(guide.visible).toBe(true); // celebration is earned, not accidental
    });

    it('shows an incomplete guide even without a seen row', () => {
      const guide = buildSetupGuide(signals({ hasBoard: true }), []);

      expect(guide.seen).toBe(false);
      expect(guide.visible).toBe(true);
    });

    it('dismissed always hides, seen or not', () => {
      const dismissedRows: SetupProgressRow[] = [
        { stepKey: SETUP_GUIDE_ROW_KEY, status: 'dismissed' },
      ];

      expect(buildSetupGuide(signals(), dismissedRows).visible).toBe(false);
      expect(
        buildSetupGuide(
          signals({ hasBoard: true, hasDeal: true, hasTeam: true, hasDashboard: true }),
          dismissedRows,
        ).visible,
      ).toBe(false);
    });
  });

  it('reports dismissed from the guide row without treating it as a step', () => {
    const rows: SetupProgressRow[] = [
      { stepKey: SETUP_GUIDE_ROW_KEY, status: 'dismissed' },
      { stepKey: 'not_a_real_step', status: 'skipped' },
    ];

    const guide = buildSetupGuide(signals(), rows);

    expect(guide.dismissed).toBe(true);
    expect(guide.totalCount).toBe(4);
    expect(guide.steps.some((step) => step.status === 'skipped')).toBe(false);
  });

  it('treats a guide row with status completed as seen, not dismissed', () => {
    const rows: SetupProgressRow[] = [{ stepKey: SETUP_GUIDE_ROW_KEY, status: 'completed' }];

    const guide = buildSetupGuide(signals(), rows);
    expect(guide.dismissed).toBe(false);
    expect(guide.seen).toBe(true);
  });

  it('exposes the deals board id only on the pipeline step', () => {
    const guide = buildSetupGuide(signals({ dealsBoardId: 'board-1' }), []);

    for (const step of guide.steps) {
      expect(step.targetId).toBe(step.action === 'pipeline' ? 'board-1' : null);
    }
  });

  it('marks every step as auto-detected (done rows read "Done · detected")', () => {
    const guide = buildSetupGuide(signals(), []);
    expect(guide.steps.every((step) => step.auto)).toBe(true);
  });
});

describe('isSetupStepKey', () => {
  it('accepts known step keys and rejects the guide row key', () => {
    expect(isSetupStepKey('crm_workspace')).toBe(true);
    expect(isSetupStepKey(SETUP_GUIDE_ROW_KEY)).toBe(false);
    expect(isSetupStepKey('')).toBe(false);
  });
});
