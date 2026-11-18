/**
 * Pulse appears everywhere the other apps do. These checks fail when a placement is dropped or a
 * list of products falls out of step with `PRODUCT_IDS`.
 */
import { describe, expect, test } from 'vitest';
import sitemap from '@/app/sitemap';
import { TOPICS } from '@/components/contact/contact-model';
import { planFor } from '@/components/licensing/licensing-plans';
import { PRODUCT_NAV, PRODUCT_PATHS, isCurrentPath } from '@/components/nav/nav-data';
import { SECTIONS } from '@/components/pulse/pulse-content';
import { FULL_STACK, LINKS, PRODUCT_IDS, ROUTES, START_NAME, toStack } from '@/components/site-links';
import type { Stack } from '@/components/site-links';
import { PRICING, PRICING_IS_PLACEHOLDER } from './pricing';
import { PULSE_NEEDS } from './stak';

/** Every non-empty set of products, in stack order. */
function everyStack(): readonly Stack[] {
  const count = 2 ** PRODUCT_IDS.length;
  return Array.from({ length: count - 1 }, (_, i) =>
    toStack(PRODUCT_IDS.filter((_id, bit) => ((i + 1) >> bit) & 1)),
  );
}

/** The copy rule shared with the product: no em dash, no en dash, no double hyphen. */
const BANNED = /[\u2014\u2013]|--/;

describe('Pulse in the shared site data', () => {
  test('is the fourth product, after Projects, matching the entitlements order', () => {
    expect(PRODUCT_IDS).toEqual(['crm', 'wms', 'projects', 'pulse']);
    expect(FULL_STACK.at(-1)).toBe('pulse');
  });

  test('has a route, an app origin and a start label', () => {
    expect(ROUTES.pulse).toBe('/pulse');
    expect(LINKS.pulse).toBe('https://pulse.kitstak.app');
    expect(START_NAME.pulse).toBe('Pulse');
  });

  test('carries its confirmed price beside the placeholder prices of the other products', () => {
    expect(PRICING_IS_PLACEHOLDER).toBe(true);
    // Pulse is the one confirmed price: $29 flat per organization, covering up to 5 seats.
    expect(PRICING.pulse).toMatchObject({
      name: 'KitStak Pulse',
      basis: 'flat_per_org',
      unit: 'organization',
      monthlyCents: 2900,
      includedSeats: 5,
      isConfirmed: true,
    });
  });
});

describe('Pulse in navigation', () => {
  const pulse = PRODUCT_NAV.find((product) => product.id === 'pulse');

  test('is listed with the other products, last', () => {
    expect(PRODUCT_NAV.map((product) => product.id)).toEqual(['wms', 'crm', 'projects', 'pulse']);
    expect(pulse).toMatchObject({ href: '/pulse', name: 'KitStak Pulse', tag: 'Pulse' });
  });

  test('deep links only to sections the Pulse page really has', () => {
    const ids = SECTIONS.map((section) => section.id);

    expect(pulse?.links).toHaveLength(4);
    for (const link of pulse?.links ?? []) {
      const [path, hash] = link.href.split('#');
      expect(path).toBe(ROUTES.pulse);
      expect(ids).toContain(hash);
    }
  });

  test('lights the Products menu on the Pulse page', () => {
    expect(PRODUCT_PATHS).toContain(ROUTES.pulse);
    expect(isCurrentPath('/pulse', ROUTES.pulse)).toBe(true);
  });

  test('is in the sitemap at the same priority as the other product pages', () => {
    const entries = sitemap();
    const priority = (path: string) =>
      entries.find((entry) => entry.url === `https://kitstak.com${path}`)?.priority;

    expect(priority('/pulse')).toBe(priority('/crm'));
    expect(priority('/pulse')).toBeDefined();
  });

  test('has its own contact topic', () => {
    expect(TOPICS.map((topic) => topic.id)).toContain('pulse');
  });
});

describe('licensing plans', () => {
  test('every combination of products has its own plan', () => {
    const stacks = everyStack();
    const titles = stacks.map((stack) => planFor(stack).title);

    expect(stacks).toHaveLength(15);
    // "The whole stack" names both the three older apps together and all four.
    expect(new Set(titles).size).toBe(14);
    for (const stack of stacks) {
      const plan = planFor(stack);
      expect(plan.body.length).toBeGreaterThan(40);
      expect(plan.included.length).toBeGreaterThanOrEqual(4);
      expect(new Set(plan.included).size).toBe(plan.included.length);
    }
  });

  test('names Pulse whenever it is switched on, and never when it is off', () => {
    for (const stack of everyStack()) {
      const plan = planFor(stack);
      const text = [plan.title, plan.body, ...plan.included].join(' ');
      if (stack.includes('pulse')) expect(text).toMatch(/Pulse|job profit/i);
      else expect(text).not.toMatch(/Pulse/);
    }
  });

  test('Pulse on its own promises nothing that needs another app', () => {
    const plan = planFor(['pulse']);

    expect(plan.title).toBe('Pulse on its own');
    expect(plan.included.join(' ')).not.toMatch(/deal|work order|project/i);
  });
});

describe('copy rules in Pulse placements', () => {
  test('no em dash, en dash or double hyphen', () => {
    const pulseNav = PRODUCT_NAV.find((product) => product.id === 'pulse');
    const strings = [
      pulseNav?.blurb ?? '',
      ...(pulseNav?.links.map((link) => link.label) ?? []),
      ...PULSE_NEEDS.flatMap((need) => [need.label, need.note]),
      ...TOPICS.flatMap((topic) => [topic.label, topic.note, topic.prompt, topic.action, topic.subject]),
      ...everyStack().flatMap((stack) => {
        const plan = planFor(stack);
        return [plan.title, plan.body, ...plan.included];
      }),
    ];

    for (const text of strings) expect(text).not.toMatch(BANNED);
  });
});
