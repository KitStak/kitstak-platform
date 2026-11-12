import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  createFormatter,
  formatAge,
  formatDate,
  formatDateTime,
  formatInputDateTime,
  formatMeasure,
  formatMoney,
  formatNumber,
  formatQuantity,
  parseInputDateTime,
} from '@/lib/format';
import {
  COUNTRIES,
  CA_PROVINCES_AND_TERRITORIES,
  US_STATES_AND_TERRITORIES,
  countryName,
  countryOptions,
  subdivisionsFor,
} from '@/lib/countries';
import { STATUS_DOMAINS, TONES, differenceTone, isPartialStatus, statusTone } from '@/lib/status-colors';
import { INTEGRATION_ERRORS, integrationError } from '@/lib/integration-errors';
import { CARRIERS, CHANNELS, findIntegration, isConnectable } from '@/lib/channel-catalog';
import { comboTokens, formatCombo, matchesCombo, parseCombo } from '@/lib/keyboard';
import { createScanDetector } from '@/lib/scan';
import { hasPermission } from '@/lib/permissions-client';
import { applyGridQuery, patchGridQuery, readUrlState, urlParam, writeUrlState } from '@/lib/use-url-state';
import { EMPTY_GRID_QUERY } from '@/server/query/grid-query';

describe('format', () => {
  const d = new Date(2026, 2, 7, 14, 5, 9); // TZ=UTC in tests

  it('formats date-time with the Logiwa default pattern', () => {
    expect(formatDateTime(d)).toBe('3/7/2026 2:05:09 PM');
    expect(formatDate(d)).toBe('3/7/2026');
  });

  it('honours the 24h preference', () => {
    expect(
      formatDateTime(d, { dateFormat: 'M/D/YYYY h:mm:ss A', timeFormat: '24h', numberFormat: '1,025.00' }),
    ).toBe('3/7/2026 14:05:09');
  });

  it('returns an em dash for empty or invalid dates', () => {
    expect(formatDateTime(null)).toBe('—');
    expect(formatDate('not a date')).toBe('—');
  });

  it('round-trips the picker format', () => {
    expect(formatInputDateTime(d)).toBe('2026/03/07 14:05');
    const parsed = parseInputDateTime('2026/03/07 14:05');
    expect(parsed?.getHours()).toBe(14);
    expect(parseInputDateTime('2026/02/30')).toBeNull();
    expect(parseInputDateTime('garbage')).toBeNull();
  });

  it('formats money for grids and summary rails', () => {
    expect(formatMoney(66.03)).toBe('66.03 USD');
    expect(formatMoney(66.03, 'USD', 'summary')).toBe('$66.03');
    expect(formatMoney(-5, 'EUR', 'summary')).toBe('-€5.00');
    expect(formatMoney(1234.5, 'XOF', 'summary')).toBe('XOF 1,234.50');
    expect(formatMoney(null)).toBe('—');
  });

  it('formats numbers with the European preference', () => {
    const eu = createFormatter({ numberFormat: '1.025,00' });
    expect(eu.number(1025, 2)).toBe('1.025,00');
    expect(formatNumber(1025.5)).toBe('1,025.5');
    expect(formatQuantity(1234.6)).toBe('1,235');
  });

  it('formats measures and ages', () => {
    expect(formatMeasure(1.5, 'Pound')).toBe('1.5 lb');
    const now = new Date('2026-03-20T00:00:00Z');
    expect(formatAge('2026-03-04T00:00:00Z', now)).toBe('16d');
    expect(formatAge('2026-03-19T21:00:00Z', now)).toBe('3h');
    expect(formatAge('2026-03-19T23:59:40Z', now)).toBe('now');
    expect(formatAge('2026-03-21T00:00:00Z', now)).toBe('in 1d');
  });

  it('createFormatter ignores undefined preferences', () => {
    expect(createFormatter({ dateFormat: undefined }).prefs.dateFormat).toBe('M/D/YYYY h:mm:ss A');
  });
});

describe('countries', () => {
  it('covers ISO countries and US/CA subdivisions', () => {
    expect(COUNTRIES.length).toBeGreaterThanOrEqual(247);
    expect(new Set(COUNTRIES.map((c) => c.code)).size).toBe(COUNTRIES.length);
    expect(US_STATES_AND_TERRITORIES).toHaveLength(62);
    expect(CA_PROVINCES_AND_TERRITORIES).toHaveLength(13);
    expect(countryName('us')).toBe('United States');
    expect(subdivisionsFor('CA')[0]?.code).toBe('AB');
    expect(subdivisionsFor('DE')).toEqual([]);
  });

  it('pins US and CA first in options', () => {
    const options = countryOptions();
    expect(options.slice(0, 2).map((o) => o.value)).toEqual(['US', 'CA']);
    expect(options[2]?.label).toBe('Afghanistan');
  });
});

describe('status colors', () => {
  it('applies domain semantics', () => {
    expect(statusTone('Open', 'shipmentOrder')).toEqual(TONES.green);
    expect(statusTone('Open', 'shipmentPlan')).toEqual(TONES.teal);
    expect(statusTone('Ready to Ship', 'shipmentOrder')).toEqual(TONES.purple);
    expect(statusTone('Started', 'return')).toEqual(TONES.blue);
    expect(statusTone('Completed', 'workOrder')).toEqual(TONES.green);
    expect(statusTone('Cancelled', 'purchaseOrder')).toEqual(TONES.red);
  });

  it('is case-insensitive and falls back to grey', () => {
    expect(statusTone('ON HOLD')).toEqual(TONES.hold);
    expect(statusTone('Something Unknown', 'job')).toEqual(TONES.grey);
  });

  it('covers every shipment order status', () => {
    const so = STATUS_DOMAINS.shipmentOrder as Readonly<Record<string, string>>;
    for (const status of [
      'Open',
      'Ready to Pick',
      'Shipped',
      'Partially Shipped',
      'Delivered',
      'Shortage',
      'On Hold',
      'Cancelled',
    ]) {
      expect(so[status.toLowerCase()]).toBeDefined();
    }
  });

  it('colours receiving differences and detects partial statuses', () => {
    expect(differenceTone(-2)).toEqual(TONES.negativeDiff);
    expect(differenceTone(3)).toEqual(TONES.green);
    expect(isPartialStatus('Partially Shipped')).toBe(true);
    expect(isPartialStatus('Shipped')).toBe(false);
  });
});

describe('integration catalog', () => {
  it('has 15 error codes with full guidance', () => {
    // 15th: "Shipment order code already in use" (automation-integrations REQ-AI-R5-2).
    expect(INTEGRATION_ERRORS).toHaveLength(15);
    for (const e of INTEGRATION_ERRORS) {
      expect(
        e.title && e.explanation && e.recommendedAction && e.guideHref.startsWith('/help/'),
      ).toBeTruthy();
    }
    expect(integrationError('open api error').code).toBe('Open Api Error');
    expect(integrationError('Weird new code').title).toBe('Weird new code');
  });

  it('lists 15 channels and 13 carriers with SVG logos', () => {
    expect(CHANNELS).toHaveLength(15);
    expect(CARRIERS).toHaveLength(13);
    expect(CHANNELS.every((c) => c.logoSvg.startsWith('<svg'))).toBe(true);
    expect(findIntegration('channel', 'Shopify')?.key).toBe('shopify');
    const fba = findIntegration('channel', 'amazon-fba');
    expect(fba && isConnectable(fba)).toBe(false);
  });
});

describe('keyboard', () => {
  const ev = (
    key: string,
    mods: Partial<Record<'ctrlKey' | 'metaKey' | 'altKey' | 'shiftKey', boolean>> = {},
  ) => ({ key, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, ...mods });

  it('maps mod to the platform modifier', () => {
    expect(parseCombo('mod+k', true)).toMatchObject({ key: 'k', meta: true, ctrl: false });
    expect(parseCombo('mod+k', false)).toMatchObject({ key: 'k', meta: false, ctrl: true });
  });

  it('matches events', () => {
    expect(matchesCombo(ev('k', { ctrlKey: true }), parseCombo('mod+k', false))).toBe(true);
    expect(matchesCombo(ev('k'), parseCombo('mod+k', false))).toBe(false);
    expect(matchesCombo(ev('?', { shiftKey: true }), parseCombo('?', false))).toBe(true);
    expect(matchesCombo(ev('Escape'), parseCombo('esc', false))).toBe(true);
  });

  it('formats combos per platform', () => {
    expect(formatCombo('mod+shift+k', false)).toBe('Ctrl+Shift+K');
    expect(comboTokens('mod+k', true)).toEqual(['⌘', 'K']);
  });
});

describe('scan detector', () => {
  const feedAll = (keys: readonly string[], gap: number) => {
    const detector = createScanDetector();
    let t = 0;
    let result: string | null = null;
    for (const key of keys) {
      t += gap;
      result = detector.feed({ key, timeStamp: t });
    }
    return result;
  };

  it('detects fast bursts ending in Enter', () => {
    expect(feedAll([...'SKU-12345', 'Enter'], 10)).toBe('SKU-12345');
  });

  it('ignores human-speed typing and short bursts', () => {
    expect(feedAll([...'SKU-12345', 'Enter'], 120)).toBeNull();
    expect(feedAll([...'AB', 'Enter'], 10)).toBeNull();
  });
});

describe('permissions', () => {
  it('checks all/any modes', () => {
    const granted = new Set(['orders.view', 'orders.edit']);
    expect(hasPermission(granted, 'orders.view')).toBe(true);
    expect(hasPermission(granted, ['orders.view', 'orders.delete'])).toBe(false);
    expect(hasPermission(granted, ['orders.view', 'orders.delete'], 'any')).toBe(true);
    expect(hasPermission(['a'], [])).toBe(true);
  });
});

describe('url state helpers', () => {
  const defs = {
    tab: urlParam.enum(['all', 'open'], 'all'),
    page: urlParam.int(1),
    q: urlParam.string(),
    on: urlParam.bool(),
  };

  it('reads typed values with defaults', () => {
    expect(readUrlState(defs, new URLSearchParams('tab=open&page=3&on=1'))).toEqual({
      tab: 'open',
      page: 3,
      q: '',
      on: true,
    });
    expect(readUrlState(defs, new URLSearchParams('tab=bogus&page=x'))).toEqual({
      tab: 'all',
      page: 1,
      q: '',
      on: false,
    });
  });

  it('writes values, dropping defaults and keeping foreign params', () => {
    const next = writeUrlState(defs, new URLSearchParams('keep=1&tab=open'), { tab: 'all', page: 2 });
    expect(next.toString()).toBe('keep=1&page=2');
  });

  it('applies grid queries canonically and resets the page on filter changes', () => {
    const patched = patchGridQuery({ ...EMPTY_GRID_QUERY, page: 4 }, { q: 'SO1' });
    expect(patched.page).toBe(1);
    expect(patchGridQuery({ ...EMPTY_GRID_QUERY, page: 4 }, { page: 5 }).page).toBe(5);
    const params = applyGridQuery(new URLSearchParams('tab=open&f.status=in:Open&page=3'), {
      ...patched,
      sort: [{ field: 'orderDate', dir: 'desc' }],
    });
    expect(params.toString()).toBe('tab=open&q=SO1&sort=-orderDate');
  });
});

describe('zod interop sanity', () => {
  it('zod 4 is available for form schemas', () => {
    expect(z.object({ a: z.string() }).safeParse({ a: 'x' }).success).toBe(true);
  });
});
