import { describe, expect, test } from 'vitest';
import {
  DEFAULT_ANSWERS,
  accountErrors,
  applyPrefill,
  canLeaveStep,
  handoffUrl,
  parseAnswers,
  parseStack,
  setupPlan,
  wizardHref,
  withTeamSize,
} from './stak';
import type { StakAnswers } from './stak';

const answers = (patch: Partial<StakAnswers>): StakAnswers => ({ ...DEFAULT_ANSWERS, ...patch });

describe('parseStack', () => {
  test('accepts the three stack choices', () => {
    expect(parseStack('crm')).toBe('crm');
    expect(parseStack('wms')).toBe('wms');
    expect(parseStack('both')).toBe('both');
  });

  test('rejects anything else', () => {
    expect(parseStack('erp')).toBeNull();
    expect(parseStack(null)).toBeNull();
    expect(parseStack(undefined)).toBeNull();
  });
});

describe('canLeaveStep', () => {
  test('blocks the stack step until a stack is chosen', () => {
    expect(canLeaveStep('stack', answers({ focus: null }))).toBe(false);
    expect(canLeaveStep('stack', answers({ focus: 'wms' }))).toBe(true);
  });

  test('blocks the business step until a business type is chosen', () => {
    expect(canLeaveStep('business', answers({ businessType: null }))).toBe(false);
    expect(canLeaveStep('business', answers({ businessType: '3pl' }))).toBe(true);
  });

  test('never blocks the optional steps', () => {
    expect(canLeaveStep('shape', DEFAULT_ANSWERS)).toBe(true);
    expect(canLeaveStep('launch', DEFAULT_ANSWERS)).toBe(true);
  });
});

describe('withTeamSize', () => {
  test('sets a matching default seat count without mutating the input', () => {
    const before = answers({ teamSize: 'small', seats: 5 });

    const after = withTeamSize(before, 'medium');

    expect(after.teamSize).toBe('medium');
    expect(after.seats).toBe(25);
    expect(before.seats).toBe(5);
  });
});

describe('setupPlan', () => {
  test('marks the business profile as already done', () => {
    const plan = setupPlan(answers({ focus: 'crm', businessType: 'brand' }));

    expect(plan[0]).toMatchObject({ key: 'profile', isDone: true });
  });

  test('drops the invite step for a solo team', () => {
    const plan = setupPlan(answers({ focus: 'both', businessType: 'brand', teamSize: 'solo' }));

    expect(plan.map((s) => s.key)).not.toContain('invite_team');
  });

  test('puts warehouse steps first for a 3PL', () => {
    const keys = setupPlan(answers({ focus: 'both', businessType: '3pl' })).map((s) => s.key);

    expect(keys.indexOf('create_warehouse')).toBeLessThan(keys.indexOf('create_workspace'));
  });

  test('puts CRM steps first for a brand', () => {
    const keys = setupPlan(answers({ focus: 'both', businessType: 'brand' })).map((s) => s.key);

    expect(keys.indexOf('create_workspace')).toBeLessThan(keys.indexOf('create_warehouse'));
  });

  test('only includes steps for the chosen product', () => {
    const crmOnly = setupPlan(answers({ focus: 'crm', businessType: 'brand' })).map((s) => s.app);
    const wmsOnly = setupPlan(answers({ focus: 'wms', businessType: '3pl' })).map((s) => s.app);

    expect(crmOnly).not.toContain('WMS');
    expect(wmsOnly).not.toContain('CRM');
  });

  test('describes the catalog step as an import when importing data', () => {
    const plan = setupPlan(answers({ focus: 'wms', businessType: '3pl', startMode: 'import' }));

    expect(plan.find((s) => s.key === 'build_catalog')?.note).toMatch(/import/i);
  });
});

describe('accountErrors', () => {
  test('returns no errors for a complete account', () => {
    expect(accountErrors({ name: 'Dana Reyes', email: 'dana@example.com', company: 'Northwind' })).toEqual({});
  });

  test('flags every missing field', () => {
    const errors = accountErrors({ name: ' ', email: '', company: '' });

    expect(Object.keys(errors).sort()).toEqual(['company', 'email', 'name']);
  });

  test('flags a malformed email', () => {
    expect(accountErrors({ name: 'Dana', email: 'dana@', company: 'Northwind' }).email).toBeDefined();
  });

  test('flags over-long input', () => {
    expect(accountErrors({ name: 'x'.repeat(200), email: 'a@b.co', company: 'Northwind' }).name).toBeDefined();
  });
});

describe('handoffUrl', () => {
  test('carries the setup answers and no personal details', () => {
    const url = new URL(handoffUrl(answers({ focus: 'both', businessType: '3pl', teamSize: 'medium' })));

    expect(url.pathname).toBe('/signup');
    expect(url.searchParams.get('focus')).toBe('both');
    expect(url.searchParams.get('businessType')).toBe('3pl');
    expect(url.searchParams.get('teamSize')).toBe('medium');
    expect(url.searchParams.get('startMode')).toBe('fresh');
    expect([...url.searchParams.keys()].sort()).toEqual(['businessType', 'focus', 'startMode', 'teamSize']);
  });
});

describe('parseAnswers', () => {
  test('round-trips valid answers', () => {
    const saved = answers({ focus: 'wms', businessType: 'distributor', warehouses: 3, wmsNeeds: ['returns'] });

    expect(parseAnswers(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  test('falls back to defaults for junk', () => {
    expect(parseAnswers(null)).toEqual(DEFAULT_ANSWERS);
    expect(parseAnswers('nope')).toEqual(DEFAULT_ANSWERS);
    expect(parseAnswers({ focus: 'erp', seats: 'many', wmsNeeds: [1, 'bogus', 'returns'] })).toEqual({
      ...DEFAULT_ANSWERS,
      wmsNeeds: ['returns'],
    });
  });

  test('clamps saved quantities into range', () => {
    const parsed = parseAnswers({ seats: 100000, warehouses: 0 });

    expect(parsed.seats).toBe(500);
    expect(parsed.warehouses).toBe(1);
  });
});

describe('wizardHref and applyPrefill', () => {
  test('round-trips a priced stack through the query string', () => {
    const href = wizardHref({ stack: 'both', seats: 12, warehouses: 3, billing: 'monthly' });
    const params = new URL(href, 'https://kitstak.com').searchParams;

    const result = applyPrefill(DEFAULT_ANSWERS, params);

    expect(result).toMatchObject({ focus: 'both', seats: 12, warehouses: 3, billing: 'monthly' });
  });

  test('keeps the base answers when the query is empty', () => {
    const base = answers({ focus: 'crm', seats: 9 });

    expect(applyPrefill(base, new URLSearchParams())).toEqual(base);
  });

  test('ignores malformed values', () => {
    const params = new URLSearchParams({ stack: 'erp', seats: 'lots', warehouses: '-4', billing: 'weekly' });

    const result = applyPrefill(DEFAULT_ANSWERS, params);

    expect(result.focus).toBeNull();
    expect(result.seats).toBe(DEFAULT_ANSWERS.seats);
    expect(result.warehouses).toBe(1);
    expect(result.billing).toBe(DEFAULT_ANSWERS.billing);
  });
});
