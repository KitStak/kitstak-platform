import { describe, expect, test } from 'vitest';
import {
  FULL_STACK,
  PULSE_IS_LIVE,
  getStartedHref,
  parseStack,
  startableStack,
  toggleProduct,
  walkthroughHref,
} from '@/components/site-links';
import {
  DEFAULT_ANSWERS,
  accountErrors,
  applyPrefill,
  asksOnlyForUnopenedProducts,
  canLeaveStep,
  handoffUrl,
  parseAnswers,
  portalFocus,
  setupPlan,
  wizardHref,
  withTeamSize,
} from './stak';
import type { StakAnswers } from './stak';

const answers = (patch: Partial<StakAnswers>): StakAnswers => ({ ...DEFAULT_ANSWERS, ...patch });

describe('parseStack', () => {
  test('reads single products and comma lists in stack order', () => {
    expect(parseStack('crm')).toEqual(['crm']);
    expect(parseStack('projects,crm')).toEqual(['crm', 'projects']);
    expect(parseStack('crm,wms,projects')).toEqual(['crm', 'wms', 'projects']);
  });

  test('reads Pulse on its own and puts it last in a mix', () => {
    expect(parseStack('pulse')).toEqual(['pulse']);
    expect(parseStack('pulse,crm')).toEqual(['crm', 'pulse']);
    expect(parseStack('pulse,projects,wms,crm')).toEqual(FULL_STACK);
  });

  test('keeps old "both" links working', () => {
    expect(parseStack('both')).toEqual(['crm', 'wms']);
  });

  test('drops anything unknown', () => {
    expect(parseStack('erp')).toEqual([]);
    expect(parseStack('crm,erp,crm')).toEqual(['crm']);
    expect(parseStack(null)).toEqual([]);
    expect(parseStack(undefined)).toEqual([]);
  });
});

describe('toggleProduct and getStartedHref', () => {
  test('switches a product on and off without reordering or mutating', () => {
    const before = ['crm'] as const;

    const on = toggleProduct(before, 'projects');
    const off = toggleProduct(on, 'crm');

    expect(on).toEqual(['crm', 'projects']);
    expect(off).toEqual(['projects']);
    expect(before).toEqual(['crm']);
  });

  test('links into the wizard with the stack in canonical order', () => {
    expect(getStartedHref('projects')).toBe('/get-started?stack=projects');
    expect(getStartedHref(['projects', 'crm'])).toBe('/get-started?stack=crm,projects');
    expect(getStartedHref()).toBe('/get-started');
  });

  test('links into the wizard with Pulse only once the Pulse app is open', () => {
    // While Pulse is coming soon it never rides into the wizard, and alone it goes to the walkthrough.
    expect(getStartedHref('pulse')).toBe(PULSE_IS_LIVE ? '/get-started?stack=pulse' : walkthroughHref('pulse'));
    expect(getStartedHref(['pulse', 'wms'])).toBe(
      PULSE_IS_LIVE ? '/get-started?stack=wms,pulse' : '/get-started?stack=wms',
    );
    expect(getStartedHref(FULL_STACK)).toBe(
      PULSE_IS_LIVE ? '/get-started?stack=crm,wms,projects,pulse' : '/get-started?stack=crm,wms,projects',
    );
    expect(toggleProduct(['crm', 'pulse'], 'wms')).toEqual(['crm', 'wms', 'pulse']);
  });
});

describe('portalFocus', () => {
  test('maps the stack onto the portal profile, which only knows the CRM and the WMS', () => {
    expect(portalFocus(['crm', 'wms', 'projects'])).toBe('both');
    expect(portalFocus(['wms', 'projects'])).toBe('wms');
    expect(portalFocus(['projects'])).toBeNull();
    expect(portalFocus(['pulse'])).toBeNull();
    expect(portalFocus(['crm', 'pulse'])).toBe('crm');
  });
});

describe('canLeaveStep', () => {
  test('blocks the stack step until a product is chosen', () => {
    expect(canLeaveStep('stack', answers({ products: [] }))).toBe(false);
    expect(canLeaveStep('stack', answers({ products: ['projects'] }))).toBe(true);
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
    const plan = setupPlan(answers({ products: ['crm'], businessType: 'brand' }));

    expect(plan[0]).toMatchObject({ key: 'profile', isDone: true });
  });

  test('drops the invite step for a solo team', () => {
    const plan = setupPlan(answers({ products: ['crm', 'wms'], businessType: 'brand', teamSize: 'solo' }));

    expect(plan.map((s) => s.key)).not.toContain('invite_team');
  });

  test('puts warehouse steps first for a 3PL', () => {
    const keys = setupPlan(answers({ products: ['crm', 'wms'], businessType: '3pl' })).map((s) => s.key);

    expect(keys.indexOf('create_warehouse')).toBeLessThan(keys.indexOf('create_workspace'));
  });

  test('puts CRM steps first for a brand', () => {
    const keys = setupPlan(answers({ products: ['crm', 'wms'], businessType: 'brand' })).map((s) => s.key);

    expect(keys.indexOf('create_workspace')).toBeLessThan(keys.indexOf('create_warehouse'));
  });

  test('only includes steps for the chosen products', () => {
    const crmOnly = setupPlan(answers({ products: ['crm'], businessType: 'brand' })).map((s) => s.app);
    const wmsOnly = setupPlan(answers({ products: ['wms'], businessType: '3pl' })).map((s) => s.app);

    expect(crmOnly).not.toContain('WMS');
    expect(crmOnly).not.toContain('Projects');
    expect(wmsOnly).not.toContain('CRM');
  });

  test('adds the Projects first-run last, named after the chosen template', () => {
    const plan = setupPlan(
      answers({
        products: ['crm', 'projects'],
        businessType: 'brand',
        projectTemplates: ['client-onboarding'],
      }),
    );

    expect(plan.at(-1)).toMatchObject({ key: 'first_project', app: 'Projects' });
    expect(plan.at(-1)?.note).toMatch(/Client onboarding/);
  });

  test('works for a Projects-only stack', () => {
    const apps = setupPlan(answers({ products: ['projects'], businessType: 'other' })).map((s) => s.app);

    expect(apps).toEqual(['Portal', 'Portal', 'Projects']);
  });

  test('adds the Pulse first job last, after every other app', () => {
    const plan = setupPlan(answers({ products: FULL_STACK, businessType: '3pl' }));

    expect(plan.at(-1)).toMatchObject({ key: 'first_job', app: 'Pulse', isDone: false });
    expect(plan.at(-2)).toMatchObject({ app: 'Projects' });
  });

  test('works for a Pulse-only stack and follows the way the team wants to start', () => {
    const note = (startMode: StakAnswers['startMode']) =>
      setupPlan(answers({ products: ['pulse'], businessType: '3pl', startMode })).at(-1)?.note;

    expect(setupPlan(answers({ products: ['pulse'], businessType: '3pl' })).map((s) => s.app)).toEqual([
      'Portal',
      'Portal',
      'Pulse',
    ]);
    expect(note('sample')).toMatch(/sample data/);
    expect(note('import')).toMatch(/import/i);
    expect(note('fresh')).toMatch(/labor rate/);
  });

  test('leaves Pulse out when it is not chosen', () => {
    const apps = setupPlan(answers({ products: ['crm', 'wms', 'projects'], businessType: 'brand' })).map(
      (s) => s.app,
    );

    expect(apps).not.toContain('Pulse');
  });

  test('describes the catalog step as an import when importing data', () => {
    const plan = setupPlan(answers({ products: ['wms'], businessType: '3pl', startMode: 'import' }));

    expect(plan.find((s) => s.key === 'build_catalog')?.note).toMatch(/import/i);
  });
});

describe('accountErrors', () => {
  test('returns no errors for a complete account', () => {
    expect(accountErrors({ name: 'Dana Reyes', email: 'dana@example.com', company: 'Northwind' })).toEqual(
      {},
    );
  });

  test('flags every missing field', () => {
    const errors = accountErrors({ name: ' ', email: '', company: '' });

    expect(Object.keys(errors).sort()).toEqual(['company', 'email', 'name']);
  });

  test('flags a malformed email', () => {
    expect(accountErrors({ name: 'Dana', email: 'dana@', company: 'Northwind' }).email).toBeDefined();
  });

  test('flags over-long input', () => {
    expect(
      accountErrors({ name: 'x'.repeat(200), email: 'a@b.co', company: 'Northwind' }).name,
    ).toBeDefined();
  });
});

describe('handoffUrl', () => {
  test('carries the setup answers and no personal details', () => {
    const url = new URL(
      handoffUrl(answers({ products: ['crm', 'wms'], businessType: '3pl', teamSize: 'medium' })),
    );

    expect(url.pathname).toBe('/signup');
    expect(url.searchParams.get('focus')).toBe('both');
    expect(url.searchParams.get('products')).toBe('crm,wms');
    expect(url.searchParams.get('businessType')).toBe('3pl');
    expect(url.searchParams.get('teamSize')).toBe('medium');
    expect(url.searchParams.get('startMode')).toBe('fresh');
    expect([...url.searchParams.keys()].sort()).toEqual([
      'businessType',
      'focus',
      'products',
      'startMode',
      'teamSize',
    ]);
  });

  test('sends Pulse to sign-up only once the Pulse app is open, and never a focus for it', () => {
    const alone = new URL(handoffUrl(answers({ products: ['pulse'], businessType: '3pl' })));
    const whole = new URL(handoffUrl(answers({ products: FULL_STACK, businessType: '3pl' })));

    expect(alone.searchParams.get('focus')).toBeNull();
    expect(alone.searchParams.get('products')).toBe(PULSE_IS_LIVE ? 'pulse' : null);
    expect(whole.searchParams.get('focus')).toBe('both');
    expect(whole.searchParams.get('products')).toBe(startableStack(FULL_STACK).join(','));
  });

  test('sends no focus for a Projects-only stack', () => {
    const url = new URL(handoffUrl(answers({ products: ['projects'], businessType: 'other' })));

    expect(url.searchParams.get('focus')).toBeNull();
    expect(url.searchParams.get('products')).toBe('projects');
  });
});

describe('parseAnswers', () => {
  test('round-trips valid answers', () => {
    const saved = answers({
      products: ['wms', 'projects'],
      businessType: 'distributor',
      warehouses: 3,
      wmsNeeds: ['returns'],
      projectTemplates: ['warehouse-go-live'],
    });

    expect(parseAnswers(JSON.parse(JSON.stringify(saved)))).toEqual(saved);
  });

  test('round-trips Pulse answers and keeps only real Pulse choices', () => {
    const saved = answers({
      products: ['wms', 'pulse'],
      businessType: '3pl',
      pulseNeeds: ['job_profit', 'csv'],
    });

    // A saved stack keeps Pulse only once the Pulse app is open.
    expect(parseAnswers(JSON.parse(JSON.stringify(saved)))).toEqual({
      ...saved,
      products: startableStack(saved.products),
    });
    expect(parseAnswers({ pulseNeeds: ['at_risk', 'payroll'] }).pulseNeeds).toEqual(['at_risk']);
  });

  test('upgrades answers saved with the old focus field', () => {
    expect(parseAnswers({ focus: 'both' }).products).toEqual(['crm', 'wms']);
  });

  test('keeps only real Projects templates', () => {
    expect(parseAnswers({ projectTemplates: ['sprint', 'made-up'] }).projectTemplates).toEqual(['sprint']);
  });

  test('falls back to defaults for junk', () => {
    expect(parseAnswers(null)).toEqual(DEFAULT_ANSWERS);
    expect(parseAnswers('nope')).toEqual(DEFAULT_ANSWERS);
    expect(parseAnswers({ products: ['erp'], seats: 'many', wmsNeeds: [1, 'bogus', 'returns'] })).toEqual({
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

describe('asksOnlyForUnopenedProducts', () => {
  const ask = (query: string) => asksOnlyForUnopenedProducts(new URLSearchParams(query));

  test('is true only for a link whose every product is coming soon', () => {
    expect(ask('stack=pulse')).toBe(!PULSE_IS_LIVE);
    expect(ask('stack=wms,pulse')).toBe(false);
    expect(ask('stack=crm')).toBe(false);
  });

  test('is false for a link with no stack, or one that names no product', () => {
    expect(ask('')).toBe(false);
    expect(ask('seats=4')).toBe(false);
    expect(ask('stack=nothing')).toBe(false);
  });
});

describe('wizardHref and applyPrefill', () => {
  test('round-trips a priced stack through the query string', () => {
    const href = wizardHref({
      stack: ['crm', 'wms', 'projects'],
      seats: 12,
      warehouses: 3,
      billing: 'monthly',
    });
    const params = new URL(href, 'https://kitstak.com').searchParams;

    const result = applyPrefill(DEFAULT_ANSWERS, params);

    expect(result).toMatchObject({
      products: ['crm', 'wms', 'projects'],
      seats: 12,
      warehouses: 3,
      billing: 'monthly',
    });
  });

  test('round-trips a stack with Pulse through the query string', () => {
    const href = wizardHref({ stack: FULL_STACK, seats: 7, warehouses: 2, billing: 'annual' });
    const params = new URL(href, 'https://kitstak.com').searchParams;

    const open = startableStack(FULL_STACK);

    expect(params.get('stack')).toBe(open.join(','));
    expect(applyPrefill(DEFAULT_ANSWERS, params)).toMatchObject({ products: open, seats: 7, warehouses: 2 });
    expect(applyPrefill(DEFAULT_ANSWERS, new URLSearchParams({ stack: 'pulse' })).products).toEqual(
      startableStack(['pulse']),
    );
  });

  test('keeps the base answers when the query is empty', () => {
    const base = answers({ products: ['crm'], seats: 9 });

    expect(applyPrefill(base, new URLSearchParams())).toEqual(base);
  });

  test('ignores malformed values', () => {
    const params = new URLSearchParams({ stack: 'erp', seats: 'lots', warehouses: '-4', billing: 'weekly' });

    const result = applyPrefill(DEFAULT_ANSWERS, params);

    expect(result.products).toEqual([]);
    expect(result.seats).toBe(DEFAULT_ANSWERS.seats);
    expect(result.warehouses).toBe(1);
    expect(result.billing).toBe(DEFAULT_ANSWERS.billing);
  });
});
