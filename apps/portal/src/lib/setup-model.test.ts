import { describe, expect, it } from 'vitest';
import {
  GUIDE_STEPS_MAX,
  GUIDE_STEPS_MIN,
  buildSetupSteps,
  focusFromProducts,
  parseSetupProfile,
  moreGuideSteps,
  pickGuideSteps,
  readProgressRows,
  summarizeSetup,
  toSetupProducts,
  type SetupProduct,
  type SetupProfile,
  type SetupSignals,
} from './setup-model';

const freshSignals: SetupSignals = {
  memberCount: 1,
  pendingInvites: 0,
  crmEntitled: true,
  wmsEntitled: true,
  crmBoards: 0,
  crmDeals: 0,
  wmsWarehouses: 0,
  wmsProducts: 0,
  wmsOrders: 0,
};

const bothProfile: SetupProfile = {
  focus: 'both',
  businessType: '3pl',
  teamSize: 'small',
  startMode: 'fresh',
};

describe('parseSetupProfile', () => {
  it('round-trips a valid payload', () => {
    expect(parseSetupProfile({ ...bothProfile })).toEqual(bothProfile);
  });

  it('returns null for malformed payloads', () => {
    expect(parseSetupProfile(null)).toBeNull();
    expect(parseSetupProfile('nope')).toBeNull();
    expect(parseSetupProfile({ focus: 'both' })).toBeNull();
    expect(parseSetupProfile({ ...bothProfile, focus: 'erp' })).toBeNull();
  });
});

describe('buildSetupSteps', () => {
  it('shows every step for a fresh org with both modules and no profile', () => {
    const steps = buildSetupSteps(freshSignals, null, {});
    expect(steps.map((step) => step.key)).toEqual([
      'profile',
      'invite_team',
      'crm_workspace',
      'crm_first_deal',
      'wms_warehouse',
      'wms_catalog',
      'wms_first_order',
    ]);
    expect(steps.every((step) => step.key === 'profile' || step.auto)).toBe(true);
  });

  it('filters app steps by wizard focus', () => {
    const wmsOnly = buildSetupSteps(freshSignals, { ...bothProfile, focus: 'wms' }, {});
    expect(wmsOnly.some((step) => step.scope === 'crm')).toBe(false);
    const crmOnly = buildSetupSteps(freshSignals, { ...bothProfile, focus: 'crm' }, {});
    expect(crmOnly.some((step) => step.scope === 'wms')).toBe(false);
  });

  it('filters app steps by entitlement', () => {
    const steps = buildSetupSteps({ ...freshSignals, crmEntitled: false }, null, {});
    expect(steps.some((step) => step.scope === 'crm')).toBe(false);
  });

  it('auto-detects completion from live signals', () => {
    const steps = buildSetupSteps(
      { ...freshSignals, memberCount: 3, crmBoards: 5, crmDeals: 2 },
      bothProfile,
      {},
    );
    const byKey = new Map(steps.map((step) => [step.key, step]));
    expect(byKey.get('profile')?.status).toBe('done');
    expect(byKey.get('invite_team')?.status).toBe('done');
    expect(byKey.get('crm_workspace')?.status).toBe('done');
    expect(byKey.get('crm_first_deal')?.status).toBe('done');
    expect(byKey.get('wms_warehouse')?.status).toBe('todo');
  });

  it('counts a pending invitation as inviting the team', () => {
    const steps = buildSetupSteps({ ...freshSignals, pendingInvites: 1 }, bothProfile, {});
    expect(steps.find((step) => step.key === 'invite_team')?.status).toBe('done');
  });

  it('locks dependent steps until their prerequisite is done, in operational order', () => {
    const steps = buildSetupSteps(freshSignals, bothProfile, {});
    const byKey = new Map(steps.map((step) => [step.key, step]));
    expect(byKey.get('wms_catalog')?.lockedBy).toBe('Create your warehouse');
    expect(byKey.get('wms_first_order')?.lockedBy).toBe('Build your product catalog');
    const afterWarehouse = buildSetupSteps(
      { ...freshSignals, wmsWarehouses: 1 },
      bothProfile,
      {},
    );
    expect(afterWarehouse.find((step) => step.key === 'wms_catalog')?.lockedBy).toBeNull();
  });

  it('a skip override unlocks dependents and counts toward progress', () => {
    const steps = buildSetupSteps(freshSignals, bothProfile, { wms_warehouse: 'skipped' });
    const byKey = new Map(steps.map((step) => [step.key, step]));
    expect(byKey.get('wms_warehouse')?.status).toBe('skipped');
    expect(byKey.get('wms_catalog')?.lockedBy).toBeNull();
  });

  it('live detection beats a stale skip override', () => {
    const steps = buildSetupSteps(
      { ...freshSignals, wmsWarehouses: 2 },
      bothProfile,
      { wms_warehouse: 'skipped' },
    );
    expect(steps.find((step) => step.key === 'wms_warehouse')?.status).toBe('done');
  });

  it('degrades null signals (failed queries) to todo instead of throwing', () => {
    const steps = buildSetupSteps(
      { ...freshSignals, crmBoards: null, wmsWarehouses: null, wmsOrders: null },
      bothProfile,
      {},
    );
    expect(steps.find((step) => step.key === 'crm_workspace')?.status).toBe('todo');
    expect(steps.find((step) => step.key === 'wms_warehouse')?.status).toBe('todo');
  });
});

describe('summarizeSetup', () => {
  it('summarizes a fresh plan', () => {
    const steps = buildSetupSteps(freshSignals, null, {});
    const summary = summarizeSetup(steps);
    expect(summary.doneCount).toBe(0);
    expect(summary.percent).toBe(0);
    expect(summary.allDone).toBe(false);
    expect(summary.nextKey).toBe('profile');
    expect(summary.remainingMinutes).toBe(
      steps.reduce((sum, step) => sum + step.minutes, 0),
    );
  });

  it('skipped steps advance percent but not doneCount', () => {
    const steps = buildSetupSteps(freshSignals, bothProfile, { invite_team: 'skipped' });
    const summary = summarizeSetup(steps);
    expect(summary.doneCount).toBe(1); // profile
    expect(summary.percent).toBeGreaterThan(0);
  });

  it('reports allDone only when everything is genuinely done', () => {
    const steps = buildSetupSteps(
      {
        ...freshSignals,
        memberCount: 2,
        crmBoards: 1,
        crmDeals: 1,
        wmsWarehouses: 1,
        wmsProducts: 4,
        wmsOrders: 1,
      },
      bothProfile,
      {},
    );
    const summary = summarizeSetup(steps);
    expect(summary.allDone).toBe(true);
    expect(summary.allSettled).toBe(true);
    expect(summary.percent).toBe(100);
    expect(summary.nextKey).toBeNull();
  });

  it('skips settle the plan but never earn the celebration', () => {
    const skippedOnly = buildSetupSteps(
      { ...freshSignals, crmBoards: 1, crmDeals: 1 },
      { ...bothProfile, focus: 'crm' },
      { invite_team: 'skipped' },
    );
    const quiet = summarizeSetup(skippedOnly);
    expect(quiet.allSettled).toBe(true);
    expect(quiet.allDone).toBe(false);
    expect(quiet.skippedCount).toBe(1);
  });

  it('solo team size removes the invite step until a teammate shows up', () => {
    const solo = buildSetupSteps(freshSignals, { ...bothProfile, teamSize: 'solo' }, {});
    expect(solo.some((step) => step.key === 'invite_team')).toBe(false);
    const soloWithTeam = buildSetupSteps(
      { ...freshSignals, memberCount: 2 },
      { ...bothProfile, teamSize: 'solo' },
      {},
    );
    expect(soloWithTeam.find((step) => step.key === 'invite_team')?.status).toBe('done');
  });

  it('orders WMS before CRM for 3PLs and distributors', () => {
    const threePl = buildSetupSteps(freshSignals, bothProfile, {});
    const keys = threePl.map((step) => step.key);
    expect(keys.indexOf('wms_warehouse')).toBeLessThan(keys.indexOf('crm_workspace'));
    const brand = buildSetupSteps(freshSignals, { ...bothProfile, businessType: 'brand' }, {});
    const brandKeys = brand.map((step) => step.key);
    expect(brandKeys.indexOf('crm_workspace')).toBeLessThan(brandKeys.indexOf('wms_warehouse'));
  });

  it('skips the next pointer past locked steps', () => {
    const steps = buildSetupSteps(
      { ...freshSignals, memberCount: 2, crmBoards: 1, crmDeals: 1 },
      bothProfile,
      {},
    );
    expect(summarizeSetup(steps).nextKey).toBe('wms_warehouse');
  });
});

describe('KitStak Projects steps', () => {
  const withProjects: SetupSignals = { ...freshSignals, projectsEntitled: true, pmProjects: 0, pmAssignedTasks: 0, pmLinks: 0 };

  it('adds the Projects steps after the app steps when Projects is licensed', () => {
    const keys = buildSetupSteps(withProjects, null, {}).map((step) => step.key);
    expect(keys.slice(-3)).toEqual(['projects_first_project', 'projects_assign_task', 'projects_connect']);
  });

  it('leaves Projects out when the module is not licensed', () => {
    const steps = buildSetupSteps(freshSignals, null, {});
    expect(steps.some((step) => step.scope === 'projects')).toBe(false);
  });

  it('locks the follow-up steps until the first project exists, then detects them', () => {
    const before = buildSetupSteps(withProjects, null, {});
    expect(before.find((step) => step.key === 'projects_assign_task')?.lockedBy).toBe('Start your first project');
    const after = buildSetupSteps({ ...withProjects, pmProjects: 2, pmAssignedTasks: 5, pmLinks: 1 }, null, {});
    expect(after.filter((step) => step.scope === 'projects').every((step) => step.status === 'done')).toBe(true);
  });

  it('only offers the connect step when there is a CRM or WMS to connect to', () => {
    const steps = buildSetupSteps({ ...withProjects, crmEntitled: false, wmsEntitled: false }, null, {});
    expect(steps.map((step) => step.key)).not.toContain('projects_connect');
    expect(steps.map((step) => step.key)).toContain('projects_first_project');
  });
});

describe('KitStak Pulse steps', () => {
  const withPulse: SetupSignals = { ...freshSignals, pulseEntitled: true, pulseLaborRates: 0, pulseJobs: 0, pulseEntries: 0, pulseLinks: 0 };

  it('adds the Pulse steps last when Pulse is licensed', () => {
    const keys = buildSetupSteps(withPulse, null, {}).map((step) => step.key);
    expect(keys.slice(-4)).toEqual(['pulse_labor_rate', 'pulse_first_job', 'pulse_first_entry', 'pulse_connect']);
  });

  it('leaves Pulse out when the module is not licensed', () => {
    const steps = buildSetupSteps(freshSignals, null, {});
    expect(steps.some((step) => step.scope === 'pulse')).toBe(false);
  });

  it('locks logging and linking until the first job exists, then detects every step', () => {
    const before = buildSetupSteps(withPulse, null, {});
    expect(before.find((step) => step.key === 'pulse_first_entry')?.lockedBy).toBe('Add your first job');
    expect(before.find((step) => step.key === 'pulse_connect')?.lockedBy).toBe('Add your first job');
    expect(before.find((step) => step.key === 'pulse_labor_rate')?.lockedBy).toBeNull();
    const after = buildSetupSteps({ ...withPulse, pulseLaborRates: 1, pulseJobs: 3, pulseEntries: 12, pulseLinks: 2 }, null, {});
    expect(after.filter((step) => step.scope === 'pulse').every((step) => step.status === 'done')).toBe(true);
  });

  it('works alone: no link step when there is no CRM or WMS to link to', () => {
    const steps = buildSetupSteps({ ...withPulse, crmEntitled: false, wmsEntitled: false }, null, {});
    const keys = steps.map((step) => step.key);
    expect(keys).not.toContain('pulse_connect');
    expect(keys).toContain('pulse_first_job');
  });

  it('a failed Pulse read leaves the steps to do, never done', () => {
    const steps = buildSetupSteps({ ...withPulse, pulseLaborRates: null, pulseJobs: null, pulseEntries: null, pulseLinks: null }, null, {});
    expect(steps.filter((step) => step.scope === 'pulse').every((step) => step.status === 'todo')).toBe(true);
  });
});

describe('readProgressRows', () => {
  it('ignores the guide rows that CRM and WMS keep for their own guides', () => {
    const rows = [
      { scope: 'portal', stepKey: 'guide', status: 'dismissed', payload: {} },
      { scope: 'wms', stepKey: 'guide', status: 'completed', payload: {} },
    ];
    expect(readProgressRows(rows)).toMatchObject({ dismissed: true, seen: true });
    expect(readProgressRows([...rows].reverse())).toMatchObject({ dismissed: true, seen: true });
  });

  it('is not seen or dismissed when only another app has a guide row', () => {
    const rows = [{ scope: 'crm', stepKey: 'guide', status: 'dismissed', payload: {} }];
    expect(readProgressRows(rows)).toMatchObject({ dismissed: false, seen: false });
  });

  it('reads the profile and step overrides', () => {
    const rows = [
      { scope: 'portal', stepKey: 'profile', status: 'completed', payload: bothProfile },
      { scope: 'portal', stepKey: 'invite_team', status: 'skipped', payload: {} },
    ];
    const result = readProgressRows(rows);
    expect(result.profile).toEqual(bothProfile);
    expect(result.overrides).toMatchObject({ profile: 'completed', invite_team: 'skipped' });
  });
});

/* ===== Four app signup and the plan step (docs/billing/SPEC.md section 5.7) ===== */

const ALL_PRODUCTS: readonly SetupProduct[] = ['crm', 'wms', 'projects', 'pulse'];

/** Signals for a brand new team in a free trial with the given apps. */
function trialSignals(products: readonly SetupProduct[], overrides: Partial<SetupSignals> = {}): SetupSignals {
  return {
    memberCount: 1,
    pendingInvites: 0,
    crmEntitled: products.includes('crm'),
    wmsEntitled: products.includes('wms'),
    crmBoards: 0,
    crmDeals: 0,
    wmsWarehouses: 0,
    wmsProducts: 0,
    wmsOrders: 0,
    projectsEntitled: products.includes('projects'),
    pmProjects: 0,
    pmAssignedTasks: 0,
    pmLinks: 0,
    pulseEntitled: products.includes('pulse'),
    pulseLaborRates: 0,
    pulseJobs: 0,
    pulseEntries: 0,
    pulseLinks: 0,
    billing: { state: 'trial', trialEndsLabel: 'Dec 7' },
    ...overrides,
  };
}

function profileFor(products: readonly SetupProduct[], overrides: Partial<SetupProfile> = {}): SetupProfile {
  return {
    focus: focusFromProducts(products),
    businessType: 'brand',
    teamSize: 'small',
    startMode: 'fresh',
    products,
    ...overrides,
  };
}

/** Every mix of the four apps with at least one app: 15 carts. */
function everyStack(): SetupProduct[][] {
  const stacks: SetupProduct[][] = [];
  for (let mask = 1; mask < 16; mask += 1) {
    stacks.push(ALL_PRODUCTS.filter((_, index) => (mask >> index) & 1));
  }
  return stacks;
}

describe('products on the setup profile', () => {
  it('keeps known apps in catalog order and drops junk', () => {
    expect(toSetupProducts(['pulse', 'erp', 'crm', 'crm', 7])).toEqual(['crm', 'pulse']);
    expect(toSetupProducts('crm')).toEqual([]);
  });

  it('derives the old focus answer from the apps', () => {
    expect(focusFromProducts(['crm'])).toBe('crm');
    expect(focusFromProducts(['wms', 'pulse'])).toBe('wms');
    expect(focusFromProducts(['crm', 'wms'])).toBe('both');
    expect(focusFromProducts(['projects', 'pulse'])).toBe('both');
    expect(focusFromProducts([])).toBe('both');
  });

  it('round trips products and still reads profiles saved without them', () => {
    const withProducts = profileFor(['crm', 'pulse']);
    expect(parseSetupProfile({ ...withProducts })).toEqual(withProducts);
    expect(parseSetupProfile({ ...bothProfile })).toEqual(bothProfile);
    expect(parseSetupProfile({ ...bothProfile, products: ['wms', 'nope'] })).toEqual({ ...bothProfile, products: ['wms'] });
  });
});

describe('the "Pick your plan" step', () => {
  it('is the last step during a free trial and names the end date', () => {
    const steps = buildSetupSteps(trialSignals(['crm', 'wms']), profileFor(['crm', 'wms']), {});
    const last = steps[steps.length - 1];
    expect(last?.key).toBe('billing_plan');
    expect(last?.title).toBe('Pick your plan');
    expect(last?.status).toBe('todo');
    expect(last?.cta).toBe('Pick a plan');
    expect(last?.description).toBe('Pick a plan any time before Dec 7. No charge until then.');
  });

  it('stays last when the warehouse steps come first', () => {
    const steps = buildSetupSteps(trialSignals(ALL_PRODUCTS), profileFor(ALL_PRODUCTS, { businessType: '3pl' }), {});
    expect(steps[steps.length - 1]?.key).toBe('billing_plan');
    expect(steps.filter((step) => step.key === 'billing_plan')).toHaveLength(1);
  });

  it('is done when a card is on file or the plan is paid', () => {
    const steps = buildSetupSteps(
      trialSignals(['crm'], { billing: { state: 'done', trialEndsLabel: 'Dec 7' } }),
      profileFor(['crm']),
      {},
    );
    expect(steps.find((step) => step.key === 'billing_plan')?.status).toBe('done');
  });

  it('says so when the free trial has ended', () => {
    const steps = buildSetupSteps(
      trialSignals(['crm'], { billing: { state: 'trial_ended', trialEndsLabel: 'Dec 7' } }),
      profileFor(['crm']),
      {},
    );
    expect(steps.find((step) => step.key === 'billing_plan')?.description).toBe(
      'Your free trial has ended. Pick a plan to keep working.',
    );
  });

  it('is not shown to teams on a manual grant or with no trial', () => {
    for (const billing of [undefined, null]) {
      const steps = buildSetupSteps(trialSignals(['crm', 'wms'], { billing }), profileFor(['crm', 'wms']), {});
      expect(steps.some((step) => step.key === 'billing_plan')).toBe(false);
    }
    // The signals older callers build (no billing key at all) are unchanged.
    expect(buildSetupSteps(freshSignals, bothProfile, {}).some((step) => step.key === 'billing_plan')).toBe(false);
  });

  it('can be skipped like any other step, and a skip never counts as done', () => {
    const steps = buildSetupSteps(trialSignals(['crm']), profileFor(['crm']), { billing_plan: 'skipped' });
    expect(steps.find((step) => step.key === 'billing_plan')?.status).toBe('skipped');
    expect(summarizeSetup(steps).allDone).toBe(false);
  });
});

describe('pickGuideSteps (must have 27: a quick start of 3 to 5 steps tied to the chosen apps)', () => {
  it('lists 3 to 5 steps for every mix of apps and every team size, in a free trial', () => {
    for (const products of everyStack()) {
      for (const teamSize of ['solo', 'small', 'medium', 'large'] as const) {
        for (const businessType of ['3pl', 'brand'] as const) {
          for (const profile of [profileFor(products, { teamSize, businessType }), null]) {
            const picked = pickGuideSteps(buildSetupSteps(trialSignals(products), profile, {}));
            const label = `${products.join('+')} ${teamSize} ${businessType} ${profile ? 'answered' : 'skipped'}`;
            expect(picked.length, label).toBeGreaterThanOrEqual(GUIDE_STEPS_MIN);
            expect(picked.length, label).toBeLessThanOrEqual(GUIDE_STEPS_MAX);
          }
        }
      }
    }
  });

  it('starts on the business answers, only lists steps for the apps the team picked, and ends on the plan', () => {
    for (const products of everyStack()) {
      const picked = pickGuideSteps(buildSetupSteps(trialSignals(products), profileFor(products), {}));
      expect(picked[0]?.key).toBe('profile');
      expect(picked[picked.length - 1]?.key).toBe('billing_plan');
      for (const step of picked) {
        if (step.scope === 'portal') continue;
        expect(products, `${step.key} for ${products.join('+')}`).toContain(step.scope);
      }
    }
  });

  it('gives every picked app its first step before any app gets a second one', () => {
    const picked = pickGuideSteps(buildSetupSteps(trialSignals(ALL_PRODUCTS), profileFor(ALL_PRODUCTS, { teamSize: 'solo' }), {}));
    expect(picked.map((step) => step.key)).toEqual(['profile', 'crm_workspace', 'wms_warehouse', 'projects_first_project', 'billing_plan']);
  });

  it('never shows a step above the one that unlocks it', () => {
    for (const products of everyStack()) {
      const all = buildSetupSteps(trialSignals(products), profileFor(products), {});
      const picked = pickGuideSteps(all);
      const order = all.map((step) => step.key);
      const positions = picked.map((step) => order.indexOf(step.key));
      expect(positions).toEqual([...positions].sort((a, b) => a - b));
      for (const step of picked) {
        if (step.lockedBy === null) continue;
        const unlocker = all.find((candidate) => candidate.title === step.lockedBy);
        expect(picked.some((candidate) => candidate.key === unlocker?.key)).toBe(true);
      }
    }
  });

  it('the reference cart (CRM and WMS, a 3PL team) reads the same on the welcome screen and on the launcher', () => {
    const profile = profileFor(['crm', 'wms'], { businessType: '3pl' });
    const picked = pickGuideSteps(buildSetupSteps(trialSignals(['crm', 'wms']), profile, {}));
    expect(picked.map((step) => step.title)).toEqual([
      'Tell us about your business',
      'Invite your team',
      'Create your warehouse',
      'Create your CRM workspace',
      'Pick your plan',
    ]);
    // The answers were just given, so the first step is already done and adds no minutes.
    expect(picked[0]?.status).toBe('done');
    expect(summarizeSetup(picked)).toMatchObject({ doneCount: 1, totalCount: 5, remainingMinutes: 9 });
  });

  it('does not reshuffle as steps are done: the same five keys before and after', () => {
    const profile = profileFor(['crm', 'pulse']);
    const before = pickGuideSteps(buildSetupSteps(trialSignals(['crm', 'pulse']), profile, {}));
    const after = pickGuideSteps(
      buildSetupSteps({ ...trialSignals(['crm', 'pulse']), memberCount: 3, crmBoards: 2, crmDeals: 4, pulseLaborRates: 1 }, profile, {}),
    );
    expect(after.map((step) => step.key)).toEqual(before.map((step) => step.key));
    expect(before).toHaveLength(5);
  });

  it('every step is in the quick start or in "more steps", never in both and never lost', () => {
    for (const products of everyStack()) {
      const all = buildSetupSteps(trialSignals(products), profileFor(products), {});
      const picked = pickGuideSteps(all).map((step) => step.key);
      const more = moreGuideSteps(all).map((step) => step.key);
      expect([...picked, ...more].sort()).toEqual(all.map((step) => step.key).sort());
      expect(picked.filter((key) => more.includes(key))).toEqual([]);
    }
  });

  it('a team with no trial (a manual grant) has no plan step in the quick start', () => {
    const all = buildSetupSteps({ ...trialSignals(['crm']), billing: null }, profileFor(['crm']), {});
    expect(pickGuideSteps(all).some((step) => step.key === 'billing_plan')).toBe(false);
  });
});
