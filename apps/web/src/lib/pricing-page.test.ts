/**
 * The pricing page and the calculator, checked the way a visitor reads them: the rendered text, the
 * links behind the buttons, and the copy rules (docs/billing/SPEC.md sections 0 and 4).
 */
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { parseHandoff } from '@kitstak/billing/handoff';
import { describe, expect, test } from 'vitest';
import { metadata as pricingMetadata } from '@/app/pricing/page';
import sitemap from '@/app/sitemap';
import { Footer } from '@/components/footer';
import { PRIMARY_NAV } from '@/components/nav/nav-data';
import { BillingRules } from '@/components/pricing/billing-rules';
import { BILLING_RULES, CALCULATOR, CARDS_NOTE, HERO, PRICING_FAQ } from '@/components/pricing/pricing-content';
import { PricingExplorer } from '@/components/pricing/pricing-explorer';
import { PriceBand } from '@/components/product/price-band';
import { LINKS, PRODUCT_IDS, ROUTES } from '@/components/site-links';
import { BundleCalculator, PriceCalculator } from '@/components/stak/bundle-calculator';
import { AccountStep } from '@/components/wizard/account-step';
import { CALCULATOR_START } from './calculator';
import { CATALOG, formatMoney, listPrice, quote } from './pricing';
import type { PlanSelection } from './pricing';

const noop = () => {};

function text(html: string): string {
  return html
    .replace(/<[^>]+>/g, ' ')
    .replaceAll('&amp;', '&')
    .replaceAll('&#x27;', "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function hrefs(html: string): readonly string[] {
  return [...html.matchAll(/href="([^"]*)"/g)].map((match) => (match[1] ?? '').replaceAll('&amp;', '&'));
}

function testIdText(html: string, id: string): string | null {
  const match = new RegExp(`data-testid="${id}"[^>]*>([^<]*)<`).exec(html);
  return match ? (match[1] ?? '') : null;
}

function calculator(selection: PlanSelection): string {
  return renderToStaticMarkup(createElement(PriceCalculator, { selection, onChange: noop, source: 'pricing' }));
}

const explorer = renderToStaticMarkup(createElement(PricingExplorer));

describe('pricing page: the parts SPEC 4.2 lists', () => {
  test('has the heading and the monthly and yearly switch', () => {
    expect(`${HERO.titleTop} ${HERO.titleBottom}`).toBe('Simple prices. Pay only for the apps you use.');
    expect(text(explorer)).toContain('Simple prices. Pay only for the apps you use.');
    expect(text(explorer)).toContain('Monthly');
    expect(text(explorer)).toContain('Yearly, save 15%');
    expect(explorer.match(/<h1/g)).toHaveLength(1);
  });

  test('has one card for each app with its price in words and a start button', () => {
    for (const id of PRODUCT_IDS) {
      expect(explorer).toContain(`data-testid="price-card-${id}"`);
      expect(testIdText(explorer, `price-card-figure-${id}`)).toBe(listPrice(id));
    }
    const all = text(explorer);
    expect(all).toContain('$29 per user each month');
    expect(all).toContain('$349 per warehouse each month');
    expect(all).toContain('$12 per user each month');
    expect(all).toContain('$29 each month for your whole team. Up to 5 seats.');
    // One label for one action: the four cards and the calculator's bar all say "Start free".
    expect(explorer.match(/>Start free</g)).toHaveLength(PRODUCT_IDS.length + 1);
    expect(text(explorer)).not.toMatch(/Start my free trial|Start free trial|Set up your Stak/);
  });

  test('each start button goes straight to portal sign-up with that app, from the pricing page', () => {
    const starts = hrefs(explorer).filter((href) => href.startsWith(`${LINKS.portal}/signup`));
    const carts = starts.map((href) => parseHandoff(new URL(href).searchParams));

    for (const id of PRODUCT_IDS) {
      expect(carts).toContainEqual({
        selection: { products: [id], seats: 1, warehouses: 1, interval: 'monthly' },
        profile: {},
        source: 'pricing',
      });
    }
  });

  test('under the total: the trial line, the trial button with the cart, and "Help me choose"', () => {
    const html = calculator(CALCULATOR_START);

    expect(testIdText(html, 'quote-total')).toBe('$395.20');
    expect(text(html)).toContain('14 days free. No card needed.');
    expect(text(html)).toContain('Start free');
    const start = hrefs(html).find((href) => href.startsWith(`${LINKS.portal}/signup`));
    expect(parseHandoff(new URL(start ?? '').searchParams)).toEqual({
      selection: CALCULATOR_START,
      profile: {},
      source: 'pricing',
    });
    expect(text(html)).toContain('Help me choose');
    expect(hrefs(html)).toContain('/get-started?stack=crm%2Cwms&seats=5&warehouses=1&billing=monthly');
  });

  test('explains billing in four parts, with the worked example from the catalog', () => {
    const rules = text(renderToStaticMarkup(createElement(BillingRules)));

    expect(BILLING_RULES).toHaveLength(4);
    expect(rules).toContain(
      'Add 1 CRM seat halfway through the month and you pay $14.50 today, then $29 more each month.',
    );
    expect(rules).toContain(`You get ${CATALOG.trialDays} days with full access`);
    expect(rules).toMatch(/Cancel any time/);
    expect(rules).toMatch(/Your data stays yours/);
  });

  test('answers the four questions the spec names, in its words', () => {
    const answerTo = (question: string) => PRICING_FAQ.find((item) => item.question === question)?.answer;

    expect(answerTo('What happens when my trial ends?')).toBe(
      'Your apps become view only. Nothing is deleted. Pick a plan to keep working.',
    );
    expect(answerTo('Can I change seats later?')).toBe('Yes. Any time. You pay only for the days left.');
    expect(answerTo('Can I cancel?')).toBe(
      'Yes. Two clicks in Billing. You keep access until the end of the period.',
    );
    expect(answerTo('Do I need a demo to buy the WMS?')).toBe('No. Start the trial and add warehouses yourself.');
  });

  test('is in the header, the footer and the sitemap', () => {
    expect(ROUTES.pricing).toBe('/pricing');
    expect(PRIMARY_NAV).toContainEqual({ href: '/pricing', label: 'Pricing' });
    expect(hrefs(renderToStaticMarkup(createElement(Footer)))).toContain('/pricing');
    expect(sitemap().map((entry) => entry.url)).toContain('https://kitstak.com/pricing');
    expect(pricingMetadata.alternates).toEqual({ canonical: '/pricing' });
  });
});

describe('calculator: the same lines as the portal picker', () => {
  test('monthly: one math line per app, the bundle discount as dollars, the total', () => {
    const html = calculator(CALCULATOR_START);

    expect(testIdText(html, 'quote-line-crm')).toBe('CRM: 5 users x $29 = $145 per month');
    expect(testIdText(html, 'quote-line-wms')).toBe('WMS: 1 warehouse x $349 = $349 per month');
    expect(testIdText(html, 'quote-list')).toBe('$494.00');
    expect(testIdText(html, 'quote-bundle-discount')).toBe('-$98.80');
    expect(testIdText(html, 'quote-yearly-discount')).toBeNull();
    expect(testIdText(html, 'quote-total')).toBe('$395.20');
    expect(text(html)).toContain('You save $98.80 each month.');
  });

  test('yearly: both discounts, the yearly total and the per month view', () => {
    const html = calculator({ ...CALCULATOR_START, interval: 'yearly' });

    expect(testIdText(html, 'quote-list')).toBe('$5,928.00');
    expect(testIdText(html, 'quote-yearly-discount')).toBe('-$889.20');
    expect(testIdText(html, 'quote-bundle-discount')).toBe('-$1,007.76');
    expect(testIdText(html, 'quote-total')).toBe('$4,031.04');
    expect(testIdText(html, 'quote-monthly-equivalent')).toBe('$335.92');
    expect(text(html)).toContain('per year');
    expect(text(html)).toContain('That is $335.92 per month.');
  });

  test('every total on screen is the shared quote, to the cent, for every stack', () => {
    const count = 2 ** PRODUCT_IDS.length;
    for (let bits = 1; bits < count; bits += 1) {
      for (const interval of ['monthly', 'yearly'] as const) {
        const selection: PlanSelection = {
          products: PRODUCT_IDS.filter((_id, bit) => (bits >> bit) & 1),
          seats: 7,
          warehouses: 3,
          interval,
        };
        expect(testIdText(calculator(selection), 'quote-total')).toBe(formatMoney(quote(selection).totalCents));
      }
    }
  });

  test('one app: nudges toward the bundle; no app: says what to do and offers no dead button', () => {
    const one = calculator({ ...CALCULATOR_START, products: ['crm'] });
    const none = calculator({ ...CALCULATOR_START, products: [] });

    expect(text(one)).toContain('Add a second app and save 20% on both.');
    expect(text(none)).toContain('Pick an app to see your price.');
    expect(text(none)).toContain('Pick at least one app.');
    expect(none).toMatch(/<button[^>]*disabled=""[^>]*data-testid="plan-submit"/);
    expect(hrefs(none).filter((href) => href.includes('/signup'))).toEqual([]);
  });

  test('a team bigger than Pulse covers gets the plain note, not a made up price', () => {
    const html = calculator({ products: ['pulse'], seats: 9, warehouses: 1, interval: 'monthly' });

    expect(testIdText(html, 'quote-total')).toBe('$29.00');
    expect(text(html)).toContain('The Pulse price covers up to 5 seats. For a bigger team, talk to us .');
  });

  test('app rows are real switches and the steppers are labeled', () => {
    const html = calculator(CALCULATOR_START);

    expect(html.match(/role="switch"/g)).toHaveLength(PRODUCT_IDS.length);
    expect(html.match(/aria-checked="true"/g)).toHaveLength(2);
    for (const label of ['Fewer people', 'More people', 'Fewer warehouses', 'More warehouses']) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain('aria-label="People"');
    expect(html).toContain('role="radiogroup"');
  });

  test('the calculator on the products page opens with the same cart', () => {
    expect(testIdText(renderToStaticMarkup(createElement(BundleCalculator)), 'quote-total')).toBe('$395.20');
  });
});

describe('product pages', () => {
  test.each(PRODUCT_IDS)('the %s price band starts a trial with that app and shows the catalog price', (id) => {
    const html = renderToStaticMarkup(createElement(PriceBand, { product: id, included: [] }));
    const start = hrefs(html).find((href) => href.startsWith(`${LINKS.portal}/signup`));

    expect(text(html)).toContain(listPrice(id));
    expect(text(html)).toContain('Start free');
    expect(text(html)).toContain('14 days free. No card needed.');
    expect(parseHandoff(new URL(start ?? '').searchParams)).toEqual({
      selection: { products: [id], seats: 1, warehouses: 1, interval: 'monthly' },
      profile: {},
      source: 'product',
    });
    expect(hrefs(html)).toContain(`/pricing?stack=${id}#calculator`);
  });
});

describe('wizard account step', () => {
  const html = renderToStaticMarkup(
    createElement(AccountStep, {
      account: { name: '', email: '', company: '' },
      errors: {},
      onChange: noop,
    }),
  );

  test('asks for name, work email and company with the right browser hints', () => {
    expect(html).toMatch(/autocomplete="name"/i);
    expect(html).toMatch(/type="email"[^>]*autocomplete="email"/i);
    expect(html).toMatch(/autocomplete="organization"/i);
    expect(html.match(/<input/g)).toHaveLength(3);
  });

  test('says what happens next: a password, the free trial, the setup plan', () => {
    const all = text(html);

    expect(all).toContain('What happens next');
    expect(all).toContain('Pick a password');
    expect(all).toContain('Start your free trial 14 days free. No card needed.');
    expect(all).toContain('Follow your setup plan');
  });
});

/* ------------------------------------------------------------------ Copy rules */

/** No em dash, no en dash, no double hyphen, no placeholder words. */
const BANNED = /[—–]|--|coming soon|lorem|preliminary/i;

function sentences(copy: string): readonly string[] {
  return copy
    .split(/(?<=[.?!])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 0);
}

function words(sentence: string): number {
  return sentence.split(/\s+/).filter((word) => /[A-Za-z0-9$]/.test(word)).length;
}

describe('copy rules on the new pricing surfaces', () => {
  const written = [
    HERO.kicker,
    `${HERO.titleTop} ${HERO.titleBottom}`,
    HERO.lead,
    CARDS_NOTE,
    CALCULATOR.title,
    CALCULATOR.lead,
    ...BILLING_RULES.flatMap((rule) => [rule.title, ...rule.lines]),
    ...PRICING_FAQ.flatMap((item) => [item.question, item.answer]),
    String(pricingMetadata.description),
  ];
  const rendered = [
    text(explorer),
    text(calculator(CALCULATOR_START)),
    text(calculator({ ...CALCULATOR_START, interval: 'yearly' })),
    text(calculator({ ...CALCULATOR_START, products: [] })),
    text(calculator({ products: ['pulse'], seats: 9, warehouses: 1, interval: 'monthly' })),
    text(renderToStaticMarkup(createElement(BillingRules))),
    text(renderToStaticMarkup(createElement(PriceBand, { product: 'pulse', included: [] }))),
  ];

  test('no em dash, en dash, double hyphen or placeholder words', () => {
    for (const copy of [...written, ...rendered]) expect(copy).not.toMatch(BANNED);
  });

  test('every sentence is 20 words or fewer', () => {
    for (const copy of written) {
      for (const sentence of sentences(copy)) {
        expect(words(sentence), sentence).toBeLessThanOrEqual(20);
      }
    }
  });

  test('every dollar figure on the pricing page shows its cents unless it is a whole dollar list price', () => {
    const figures = rendered.join(' ').match(/-?\$[\d,]+(\.\d+)?/g) ?? [];
    const listPrices = new Set<string>(PRODUCT_IDS.map(listPrice));
    // "$145" and "$349" inside a math line are list price times quantity, written by the shared quote.
    const mathFigures = new Set(
      rendered
        .join(' ')
        .match(/= \$[\d,]+ per month/g)
        ?.map((part) => part.replace('= ', '').replace(' per month', '')) ?? [],
    );

    expect(figures.length).toBeGreaterThan(20);
    for (const figure of figures) {
      if (/\.\d{2}$/.test(figure)) continue;
      expect(listPrices.has(figure) || mathFigures.has(figure), figure).toBe(true);
    }
  });
});
