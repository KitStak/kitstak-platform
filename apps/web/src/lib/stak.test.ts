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
import { parseHandoff, parseHandoffIdentity } from '@kitstak/billing/handoff';
import { quote } from './pricing';
import {
  DEFAULT_ANSWERS,
  accountErrors,
  applyPrefill,
  asksOnlyForUnopenedProducts,
  canLeaveStep,
  handoffUrl,
  parseAnswers,
  selectionOf,
  trialUrl,
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

describe('accountErrors', () => {
  test('returns no errors for a complete account', () => {
    expect(accountErrors({ name: 'Dana Reyes', email: 'dana@example.com', company: 'Northwind' })).toEqual(
      {},
    );
  });

  test('flags every missing field, in the words portal sign-up uses', () => {
    expect(accountErrors({ name: ' ', email: '', company: '' })).toEqual({
      name: 'Enter your full name.',
      email: 'Enter a valid work email.',
      company: 'Enter your company or team name.',
    });
  });

  test('flags a malformed email', () => {
    expect(accountErrors({ name: 'Dana', email: 'dana@', company: 'Northwind' }).email).toBeDefined();
  });

  test('uses the same lengths as portal sign-up, so what passes here passes there', () => {
    const ok = { name: 'Dana Reyes', email: 'a@b.co', company: 'Northwind' };

    expect(accountErrors({ ...ok, name: 'D' }).name).toBe('Enter your full name.');
    expect(accountErrors({ ...ok, name: 'x'.repeat(100) }).name).toBeUndefined();
    expect(accountErrors({ ...ok, name: 'x'.repeat(101) }).name).toBe('Use 100 characters or fewer.');
    expect(accountErrors({ ...ok, company: 'N' }).company).toBe('Enter your company or team name.');
    expect(accountErrors({ ...ok, company: 'x'.repeat(80) }).company).toBeUndefined();
    expect(accountErrors({ ...ok, company: 'x'.repeat(81) }).company).toBe('Use 80 characters or fewer.');
  });
});

describe('handoffUrl', () => {
  const dana = { name: 'Dana Reyes', email: 'dana@northwind.example', company: 'Northwind Supply' };

  test('carries the whole cart and the business answers in the query', () => {
    const url = new URL(
      handoffUrl(
        answers({
          products: ['crm', 'wms'],
          businessType: '3pl',
          teamSize: 'medium',
          seats: 25,
          warehouses: 2,
          billing: 'yearly',
          guided: true,
        }),
      ),
    );

    expect(url.pathname).toBe('/signup');
    expect(Object.fromEntries(url.searchParams)).toEqual({
      products: 'crm,wms',
      seats: '25',
      warehouses: '2',
      billing: 'yearly',
      businessType: '3pl',
      teamSize: 'medium',
      startMode: 'fresh',
      guided: '1',
      src: 'wizard',
    });
    expect(url.hash).toBe('');
  });

  test('round trips through the portal codec: what the wizard sends is what sign-up reads', () => {
    const wizard = answers({
      products: ['crm', 'wms'],
      businessType: 'brand',
      teamSize: 'small',
      seats: 5,
      warehouses: 1,
      billing: 'monthly',
      startMode: 'sample',
    });

    const url = new URL(handoffUrl(wizard, dana));
    const read = parseHandoff(url.searchParams);

    expect(read).toEqual({
      selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' },
      profile: { businessType: 'brand', teamSize: 'small', startMode: 'sample', guided: false },
      source: 'wizard',
    });
    // The portal prices the cart it read. It is the price the wizard showed.
    expect(read.selection).toEqual(selectionOf(wizard));
    expect(quote(read.selection!).totalCents).toBe(39520);
  });

  test('round trips every stack, size and period the wizard can build', () => {
    const stacks = [['pulse'], ['crm'], ['wms', 'projects'], FULL_STACK] as const;
    for (const products of stacks) {
      for (const billing of ['monthly', 'yearly'] as const) {
        const wizard = answers({ products, businessType: 'other', seats: 500, warehouses: 50, billing });
        const read = parseHandoff(new URL(handoffUrl(wizard)).searchParams);

        expect(read.selection).toEqual(selectionOf(wizard));
        expect(read.selection?.products).toEqual(startableStack(products));
      }
    }
  });

  test('puts name, email and company after the "#", never in the query', () => {
    const link = handoffUrl(answers({ products: ['crm'], businessType: 'brand' }), dana);
    const url = new URL(link);

    expect(parseHandoffIdentity(url.hash)).toEqual(dana);
    // Everything before the "#" is what a server or a log can see.
    const sentToServer = link.split('#')[0] ?? '';
    for (const personal of ['Dana', 'Reyes', 'dana', 'northwind', 'Northwind', 'Supply']) {
      expect(sentToServer).not.toContain(personal);
    }
    expect([...url.searchParams.keys()]).not.toEqual(expect.arrayContaining(['name', 'email', 'company']));
  });

  test('holds no price', () => {
    const link = handoffUrl(answers({ products: FULL_STACK, businessType: '3pl', seats: 10 }), dana);

    expect(link).not.toMatch(/\$|cents|price|total|amount/i);
  });

  test('sends Pulse to sign-up only once the Pulse app is open', () => {
    const alone = new URL(handoffUrl(answers({ products: ['pulse'], businessType: '3pl' })));
    const whole = new URL(handoffUrl(answers({ products: FULL_STACK, businessType: '3pl' })));

    expect(alone.searchParams.get('products')).toBe(PULSE_IS_LIVE ? 'pulse' : null);
    expect(whole.searchParams.get('products')).toBe(startableStack(FULL_STACK).join(','));
  });

  test('leaves the business type out until it is answered', () => {
    const url = new URL(handoffUrl(answers({ products: ['projects'] })));

    expect(url.searchParams.get('businessType')).toBeNull();
    expect(url.searchParams.get('products')).toBe('projects');
  });
});

describe('trialUrl', () => {
  test('goes straight to sign-up with the cart and says where the click came from', () => {
    const url = new URL(trialUrl({ products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' }, 'pricing'));

    expect(url.pathname).toBe('/signup');
    expect(parseHandoff(url.searchParams)).toEqual({
      selection: { products: ['crm', 'wms'], seats: 5, warehouses: 1, interval: 'monthly' },
      profile: {},
      source: 'pricing',
    });
    expect(url.hash).toBe('');
  });

  test('cleans a cart that is out of range', () => {
    const url = new URL(trialUrl({ products: ['wms'], seats: 0, warehouses: 9999, interval: 'yearly' }, 'product'));

    expect(parseHandoff(url.searchParams).selection).toEqual({
      products: ['wms'],
      seats: 1,
      warehouses: 50,
      interval: 'yearly',
    });
  });

  test('an empty cart opens plain sign-up', () => {
    const url = new URL(trialUrl({ products: [], seats: 5, warehouses: 1, interval: 'monthly' }, 'pricing'));

    expect(parseHandoff(url.searchParams).selection).toBeNull();
    expect(url.searchParams.get('products')).toBeNull();
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

  test('reads the period, and the old word for yearly', () => {
    expect(parseAnswers({ billing: 'monthly' }).billing).toBe('monthly');
    expect(parseAnswers({ billing: 'yearly' }).billing).toBe('yearly');
    expect(parseAnswers({ billing: 'annual' }).billing).toBe('yearly');
    expect(parseAnswers({ billing: 'weekly' }).billing).toBe(DEFAULT_ANSWERS.billing);
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
    const href = wizardHref({ stack: FULL_STACK, seats: 7, warehouses: 2, billing: 'yearly' });
    const params = new URL(href, 'https://kitstak.com').searchParams;

    const open = startableStack(FULL_STACK);

    expect(params.get('stack')).toBe(open.join(','));
    expect(params.get('billing')).toBe('yearly');
    expect(applyPrefill(DEFAULT_ANSWERS, params)).toMatchObject({
      products: open,
      seats: 7,
      warehouses: 2,
      billing: 'yearly',
    });
    // A link made before the rename still says `annual`.
    expect(applyPrefill(DEFAULT_ANSWERS, new URLSearchParams({ billing: 'annual' })).billing).toBe('yearly');
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
