/**
 * The go-live switches for Crew and Ledger (CREW_IS_LIVE, LEDGER_IS_LIVE in site-links.ts).
 *
 * Turning one on is blocked by exactly two things, and this file checks both:
 *  1. Billing: the app must be a `ProductId`, sold through portal sign-up with Stripe prices and an
 *     entitlements module. Its price moves from PLANNED_PRODUCTS into CATALOG.products.
 *  2. Screenshots: every slot in crew-shots.ts or ledger-shots.ts has a real file on disk.
 * Everything else on the site already follows the switch. The checklist is in
 * docs/crew/REFERENCE.md and docs/ledger/REFERENCE.md section 11.
 */
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, test } from 'vitest';
import { CREW_SHOTS } from '@/components/crew/crew-shots';
import { Footer } from '@/components/footer';
import { LEDGER_SHOTS } from '@/components/ledger/ledger-shots';
import { PLANNED_NAV, PRODUCT_NAV } from '@/components/nav/nav-data';
import type { AppShotSlot } from '@/components/product/app-shot';
import { ComingSoon } from '@/components/products/coming-soon';
import {
  ANNOUNCED_APP_IDS,
  COMING_SOON,
  COMING_SOON_APPS,
  NOTIFY_LABEL,
  STARTABLE_STACK,
  availabilityLabel,
  comingSoonSentence,
  isAppLive,
  isProductId,
  liveSwitch,
  notifyHref,
  startLink,
} from '@/components/site-links';
import type { AnnouncedAppId } from '@/components/site-links';

const SHOTS: Readonly<Record<AnnouncedAppId, Readonly<Record<string, AppShotSlot>>>> = {
  crew: CREW_SHOTS,
  ledger: LEDGER_SHOTS,
};

/** The slots of an app that still have no real screenshot on disk. */
function missingShots(app: AnnouncedAppId): readonly string[] {
  return Object.entries(SHOTS[app])
    .filter(([, slot]) => {
      if (!slot.file || !slot.alt || !slot.width || !slot.height) return true;
      const onDisk = path.join(process.cwd(), 'public', slot.file);
      return !existsSync(onDisk) || statSync(onDisk).size > 200 * 1024;
    })
    .map(([key]) => key);
}

describe.each(ANNOUNCED_APP_IDS)('%s go-live switch', (app) => {
  test('is on only when billing can sell the app', () => {
    if (liveSwitch(app)) expect(isProductId(app), `${app}: move its price into CATALOG.products first`).toBe(true);
  });

  test('is on only when every screenshot slot has a real file under 200 KB', () => {
    if (liveSwitch(app)) expect(missingShots(app), `${app}: screenshots still missing`).toEqual([]);
  });

  test('a slot with a file also has its size and alt text', () => {
    for (const [key, slot] of Object.entries(SHOTS[app])) {
      if (!slot.file) continue;
      expect(slot.alt, `${app}.${key} alt`).toBeTruthy();
      expect(slot.width && slot.height, `${app}.${key} size`).toBeTruthy();
    }
  });

  test('every page follows the switch', () => {
    const live = isAppLive(app);
    expect(availabilityLabel(app)).toBe(live ? null : COMING_SOON);
    expect(COMING_SOON_APPS.includes(app)).toBe(!live);
    expect(PRODUCT_NAV.some((product) => product.id === app)).toBe(live);
    expect(PLANNED_NAV.some((product) => product.id === app)).toBe(!live);
    if (live) {
      expect(startLink(app).label).toBe(`Start with ${app === 'crew' ? 'Crew' : 'Ledger'}`);
      expect(STARTABLE_STACK).toContain(app);
    } else {
      expect(startLink(app)).toEqual({ href: notifyHref(app), label: NOTIFY_LABEL });
    }
  });
});

describe('before launch', () => {
  test('an app billing cannot sell is never live, whatever its switch says', () => {
    for (const app of ANNOUNCED_APP_IDS) {
      if (!isProductId(app)) expect(isAppLive(app)).toBe(false);
    }
  });

  test('no start or sign-up link carries an app that is not live', () => {
    const footer = renderToStaticMarkup(createElement(Footer));
    for (const app of COMING_SOON_APPS) {
      expect(footer).not.toMatch(new RegExp(`products=[^"]*${app}`));
      expect(STARTABLE_STACK as readonly string[]).not.toContain(app);
    }
  });

  test('the coming soon cards and sentence list exactly the apps still waiting', () => {
    const cards = renderToStaticMarkup(createElement(ComingSoon));
    for (const app of ANNOUNCED_APP_IDS) {
      expect(cards.includes(`KitStak ${app === 'crew' ? 'Crew' : 'Ledger'}`)).toBe(!isAppLive(app));
    }
    expect(comingSoonSentence() === '').toBe(COMING_SOON_APPS.length === 0);
  });
});

describe('the two blockers today', () => {
  test('both switches are off, both apps wait on billing, and no screenshot is taken yet', () => {
    // When one of these changes, update docs/<app>/REFERENCE.md section 11 to match.
    expect(ANNOUNCED_APP_IDS.map(liveSwitch)).toEqual([false, false]);
    expect(ANNOUNCED_APP_IDS.map((app) => isProductId(app))).toEqual([false, false]);
    expect(missingShots('crew')).toHaveLength(Object.keys(CREW_SHOTS).length);
    expect(missingShots('ledger')).toHaveLength(Object.keys(LEDGER_SHOTS).length);
  });
});
