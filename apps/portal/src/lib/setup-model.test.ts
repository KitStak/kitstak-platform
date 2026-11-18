import { describe, expect, it } from 'vitest';
import {
  buildSetupSteps,
  parseSetupProfile,
  summarizeSetup,
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
