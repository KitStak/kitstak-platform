/**
 * While PULSE_IS_LIVE is false, nothing on the site may lead a visitor toward an account for Pulse.
 * These checks render the places that carry start links and read every link in them. They fail if a
 * Pulse start link is live while the flag is false. Once the flag is true they check the opposite:
 * the normal start flow is back with no other change.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { metadata as getStartedMetadata } from '@/app/get-started/page';
import { Footer } from '@/components/footer';
import { MobileMenu } from '@/components/nav/mobile-menu';
import { PRODUCT_NAV } from '@/components/nav/nav-data';
import { ProductsMenu } from '@/components/nav/products-menu';
import { PriceBand } from '@/components/product/price-band';
import { Lineup, StackHero, StartSteps } from '@/components/products/products-sections';
import { CLOSING, FAQ } from '@/components/pulse/pulse-content';
import { PulseBundleSection } from '@/components/pulse/pulse-section-bundle';
import {
  COMING_SOON,
  FULL_STACK,
  PRODUCT_IDS,
  PULSE_IS_LIVE,
  ROUTES,
  STARTABLE_STACK,
  availabilityLabel,
  getStartedHref,
  isAppLive,
  startLink,
  toStack,
  walkthroughHref,
} from '@/components/site-links';
import type { Stack } from '@/components/site-links';
import { BundleCalculator } from '@/components/stak/bundle-calculator';
import { StackStep } from '@/components/wizard/wizard-steps';
import { DEFAULT_ANSWERS, applyPrefill, handoffUrl, parseAnswers, trialUrl, wizardHref } from './stak';

const noop = () => {};

/** Every place outside the /pulse page file that renders a start link or names Pulse as a product. */
const SURFACES: Readonly<Record<string, string>> = {
  'products hero': renderToStaticMarkup(createElement(StackHero)),
  'products cards': renderToStaticMarkup(createElement(Lineup)),
  'products start steps': renderToStaticMarkup(createElement(StartSteps)),
  'bundle calculator': renderToStaticMarkup(createElement(BundleCalculator)),
  'pulse price band': renderToStaticMarkup(createElement(PriceBand, { product: 'pulse', included: [] })),
  'pulse bundle band': renderToStaticMarkup(createElement(PulseBundleSection, { visual: null })),
  'products menu': renderToStaticMarkup(
    createElement(ProductsMenu, { id: 'menu', isOpen: true, pathname: '/', onNavigate: noop }),
  ),
  'mobile drawer': renderToStaticMarkup(
    createElement(MobileMenu, { id: 'drawer', isOpen: true, pathname: '/', onClose: noop }),
  ),
  footer: renderToStaticMarkup(createElement(Footer)),
  'wizard stack step': renderToStaticMarkup(
    createElement(StackStep, { answers: DEFAULT_ANSWERS, update: noop }),
  ),
};

function hrefs(html: string): readonly string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replaceAll('&amp;', '&'));
}

/** True for a link that leads toward a Pulse account: the wizard or sign-up with Pulse, or the app. */
function isPulseStartLink(href: string): boolean {
  if (href.includes('pulse.kitstak.app')) return true;
  const url = new URL(href, 'https://kitstak.com');
  const carried = `${url.searchParams.get('stack') ?? ''},${url.searchParams.get('products') ?? ''}`;
  const isStartFlow = url.pathname === ROUTES.getStarted || url.pathname === '/signup';
  return isStartFlow && carried.split(',').includes('pulse');
}

/** Every non-empty set of products, in stack order. */
function everyStack(): readonly Stack[] {
  const count = 2 ** PRODUCT_IDS.length;
  return Array.from({ length: count - 1 }, (_, i) =>
    toStack(PRODUCT_IDS.filter((_id, bit) => ((i + 1) >> bit) & 1)),
  );
}

describe('isPulseStartLink', () => {
  test('knows a Pulse start link when it sees one', () => {
    expect(isPulseStartLink('/get-started?stack=pulse')).toBe(true);
    expect(isPulseStartLink('/get-started?stack=crm,wms,projects,pulse&seats=3')).toBe(true);
    expect(isPulseStartLink('https://kitstak.app/signup?products=wms,pulse')).toBe(true);
    expect(isPulseStartLink('https://pulse.kitstak.app')).toBe(true);
    expect(isPulseStartLink('/get-started?stack=crm,wms,projects')).toBe(false);
    expect(isPulseStartLink('/pulse#profit')).toBe(false);
    expect(isPulseStartLink(ROUTES.demo)).toBe(false);
    expect(isPulseStartLink(walkthroughHref('pulse'))).toBe(false);
  });
});

describe.skipIf(PULSE_IS_LIVE)('while Pulse is coming soon', () => {
  test.each(Object.entries(SURFACES))('%s has no live Pulse start link', (_name, html) => {
    expect(hrefs(html).filter(isPulseStartLink)).toEqual([]);
    expect(html).not.toMatch(/Start with Pulse/);
  });

  test('no link builder returns a Pulse start link for any stack', () => {
    for (const stack of everyStack()) {
      const links = [
        getStartedHref(stack),
        wizardHref({ stack, seats: 5, warehouses: 1, billing: 'yearly' }),
        trialUrl({ products: stack, seats: 5, warehouses: 1, interval: 'monthly' }, 'pricing'),
        handoffUrl({ ...DEFAULT_ANSWERS, products: stack }),
      ];
      expect(links.filter(isPulseStartLink)).toEqual([]);
    }
    expect(isPulseStartLink(getStartedHref('pulse'))).toBe(false);
  });

  test('a Pulse only stack goes to the walkthrough form, not the wizard', () => {
    const pulseWalkthrough = '/contact?topic=demo&product=pulse';

    expect(getStartedHref('pulse')).toBe(pulseWalkthrough);
    expect(getStartedHref(['pulse'])).toBe(pulseWalkthrough);
    expect(wizardHref({ stack: ['pulse'], seats: 5, warehouses: 1, billing: 'yearly' })).toBe(
      pulseWalkthrough,
    );
    expect(startLink('pulse')).toEqual({ href: pulseWalkthrough, label: 'Book a walkthrough' });
  });

  test('the wizard will not take Pulse from a link or from saved answers', () => {
    expect(applyPrefill(DEFAULT_ANSWERS, new URLSearchParams({ stack: 'pulse' })).products).toEqual([]);
    expect(applyPrefill(DEFAULT_ANSWERS, new URLSearchParams({ stack: 'crm,pulse' })).products).toEqual([
      'crm',
    ]);
    expect(parseAnswers({ products: ['wms', 'pulse'] }).products).toEqual(['wms']);
    expect(parseAnswers({ products: ['pulse'] }).products).toEqual([]);
    expect(STARTABLE_STACK).toEqual(['crm', 'wms', 'projects']);
  });

  test('the wizard shows Pulse as a labeled row with no box to tick', () => {
    const html = SURFACES['wizard stack step'] ?? '';

    expect(html.match(/type="checkbox"/g)).toHaveLength(STARTABLE_STACK.length + 1);
    expect(html).toContain(`KitStak Pulse<span class="${html.match(/_soon_\w+/)?.[0]}">Coming soon</span>`);
  });

  test('says exactly "Coming soon" wherever Pulse is offered', () => {
    expect(COMING_SOON).toBe('Coming soon');
    expect(availabilityLabel('pulse')).toBe('Coming soon');
    expect(PRODUCT_NAV.find((product) => product.id === 'pulse')?.status).toBe('Coming soon');
    for (const name of [
      'products cards',
      'bundle calculator',
      'pulse price band',
      'products menu',
      'mobile drawer',
      'wizard stack step',
    ]) {
      expect(SURFACES[name]).toContain('>Coming soon<');
    }
    expect(SURFACES['products cards']).toContain('href="/contact?topic=demo&amp;product=pulse">Book a walkthrough<');
  });

  test('the Pulse page copy says it is coming soon and does not read as open today', () => {
    const start = FAQ.find((item) => item.question === 'How do I start?')?.answer ?? '';

    expect(start.startsWith('Pulse is coming soon.')).toBe(true);
    expect(start).toMatch(/Book a walkthrough/);
    expect(start).toMatch(
      /When it opens, you can load sample data, import your spreadsheets or type your first job\./,
    );
    expect(start).not.toMatch(/right away/);
    expect(CLOSING.note.startsWith('Coming soon.')).toBe(true);
    // The closing note also says what the walkthrough gives you.
    expect(CLOSING.note).toMatch(/Book a walkthrough and we will show you Pulse on sample data\./);
  });

  test('the Pulse page says "Coming soon" at the top, beside the product name', () => {
    const page = readFileSync(path.resolve(__dirname, '../app/pulse/page.tsx'), 'utf8');

    expect(page).toContain("badge={availabilityLabel('pulse') ?? undefined}");
  });

  test('the wizard page does not offer Pulse as a choice in its description', () => {
    expect(String(getStartedMetadata.description)).not.toMatch(/Pulse/);
    expect(String(getStartedMetadata.description)).toMatch(/the CRM, the WMS, Projects or any mix/);
  });
});

describe.skipIf(!PULSE_IS_LIVE)('once Pulse is open', () => {
  test('the normal start flow is back', () => {
    expect(getStartedHref('pulse')).toBe('/get-started?stack=pulse');
    expect(getStartedHref(FULL_STACK)).toBe('/get-started?stack=crm,wms,projects,pulse');
    expect(startLink('pulse')).toEqual({ href: '/get-started?stack=pulse', label: 'Start with Pulse' });
    expect(STARTABLE_STACK).toEqual(FULL_STACK);
    expect(availabilityLabel('pulse')).toBeNull();
    expect(SURFACES['products cards']).toContain('Start with Pulse');
    expect(Object.values(SURFACES).join('')).not.toContain('Coming soon');
    expect(CLOSING.note).not.toMatch(/coming soon/i);
  });
});

describe('availability in general', () => {
  test('the other three apps are open and carry no label', () => {
    for (const id of ['crm', 'wms', 'projects'] as const) {
      expect(isAppLive(id)).toBe(true);
      expect(availabilityLabel(id)).toBeNull();
      expect(startLink(id).href).toBe(`/get-started?stack=${id}`);
    }
    expect(isAppLive('pulse')).toBe(PULSE_IS_LIVE);
  });

  test('the site never says "not open to new accounts yet"', () => {
    expect(Object.values(SURFACES).join('\n')).not.toMatch(/not open to new accounts/i);
    expect([...FAQ.map((item) => item.answer), CLOSING.note].join('\n')).not.toMatch(
      /not open to new accounts/i,
    );
  });
});

/* Source guard: a start link must come from the shared builders, which leave Pulse out while it is closed. */

const srcRoot = path.resolve(__dirname, '..');

function sourceFiles(dir: string): readonly string[] {
  return readdirSync(dir).flatMap((name) => {
    const file = path.join(dir, name);
    if (statSync(file).isDirectory()) return name === 'generated' ? [] : sourceFiles(file);
    return /\.tsx?$/.test(name) && !/\.test\.ts$/.test(name) ? [file] : [];
  });
}

describe('start links in source', () => {
  const files = sourceFiles(srcRoot).map((file) => ({
    name: path.relative(srcRoot, file).split(path.sep).join('/'),
    source: readFileSync(file, 'utf8'),
  }));

  test('only site-links.ts builds a wizard link with a stack by hand', () => {
    const offenders = files
      .filter(({ source }) => /get-started\?|\?stack=\$|stack=(crm|wms|projects|pulse)/.test(source))
      .map(({ name }) => name);

    expect(offenders).toEqual(['components/site-links.ts']);
  });

  test('every file that links to the Pulse app or names its start button checks the flag', () => {
    const offenders = files
      .filter(({ source }) => /LINKS\.pulse|Start with Pulse|getStartedHref\('pulse'\)/.test(source))
      .filter(({ source }) => !/PULSE_IS_LIVE|isAppLive/.test(source))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });
});
