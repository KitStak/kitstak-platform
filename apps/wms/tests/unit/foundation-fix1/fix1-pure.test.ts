import { describe, expect, it } from 'vitest';
import { codeNameLabel } from '@/lib/utils';
import { validateLogin } from '@/app/login/login-schema';
import { markReadInCache } from '@/components/layout/notifications-cache';
import { mergeShortcutRows, STATIC_SHORTCUTS } from '@/components/layout/help-content';
import { gotoTarget } from '@/components/layout/goto-shortcuts';
import { backTargetFor } from '@/components/layout/not-found-back-link';
import {
  printerOptions,
  printerSaveBlocker,
  SELECT_PRINTER_REASON,
} from '@/components/layout/printers-popover';
import { initialNavState, moveTo, stepMetas, validityPercent } from '@/components/ui/wizard/wizard-state';
import { exportFileName, isValidTimeZone, queueExportSchema } from '@/server/exports/runner';
import { escapeLike } from '@/server/search/match';
import { defaultStationPrinters } from '@/server/repositories/platform-user-prefs';
import type { NotificationView } from '@/components/layout/notification-item';

describe('codeNameLabel', () => {
  it('does not repeat a code the name already starts with', () => {
    expect(codeNameLabel('MLT1', 'MLT1 - Main Fulfillment')).toBe('MLT1 - Main Fulfillment');
    expect(codeNameLabel('KS2', 'Overflow')).toBe('KS2 - Overflow');
    expect(codeNameLabel(null, 'Overflow')).toBe('Overflow');
  });
});

describe('validateLogin', () => {
  it('reports each empty field separately', () => {
    expect(validateLogin({ email: '', password: '' })).toEqual({
      email: 'Email is required',
      password: 'Password is required',
    });
  });
  it('rejects a malformed email and accepts valid input', () => {
    expect(validateLogin({ email: 'nope', password: 'x' })).toEqual({ email: 'Enter a valid email address' });
    expect(validateLogin({ email: ' admin@kitstak.io ', password: 'x' })).toEqual({});
  });
});

const note = (id: string, readAt: string | null): NotificationView => ({
  id,
  kind: 'k',
  title: id,
  body: null,
  href: null,
  severity: 'info',
  readAt,
  createdAt: '2026-11-05T00:00:00.000Z',
});

describe('markReadInCache', () => {
  const entry = {
    data: [note('a', null), note('b', null), note('c', '2026-11-04T00:00:00.000Z')],
    meta: { total: 3, page: 1, pageSize: 10, unread: 2 },
  };

  it('marks the targeted rows read and lowers the unread count without mutating', () => {
    const next = markReadInCache(entry, { ids: ['a'] }, 'NOW');
    expect(next?.data.map((n) => n.readAt)).toEqual(['NOW', null, '2026-11-04T00:00:00.000Z']);
    expect(next?.meta?.unread).toBe(1);
    expect(entry.data[0]?.readAt).toBeNull();
  });

  it('mark all sets unread to zero; undefined stays undefined', () => {
    expect(markReadInCache(entry, { all: true }, 'NOW')?.meta?.unread).toBe(0);
    expect(markReadInCache(undefined, { all: true }, 'NOW')).toBeUndefined();
  });
});

describe('shortcuts sheet', () => {
  it('merges combos that share an action into one row', () => {
    const rows = mergeShortcutRows([
      { description: 'Open global search', combo: '/', group: 'Navigation' },
      { description: 'Open global search', combo: 'mod+k', group: 'Navigation' },
      { description: 'Show keyboard shortcuts', combo: '?', group: 'Navigation' },
    ]);
    expect(rows).toEqual([
      { description: 'Open global search', combos: ['/', 'mod+k'], group: 'Navigation' },
      { description: 'Show keyboard shortcuts', combos: ['?'], group: 'Navigation' },
    ]);
  });

  it('lists go-to sequences and Esc, and resolves sequence targets', () => {
    expect(STATIC_SHORTCUTS.map((s) => s.description)).toEqual(
      expect.arrayContaining(['Go to Dashboard', 'Go to Shipment Orders', 'Close a dialog, menu or drawer']),
    );
    expect(gotoTarget('D')).toBe('/dashboard');
    expect(gotoTarget('o')).toBe('/orders');
    expect(gotoTarget('x')).toBeNull();
  });
});

describe('404 back target', () => {
  it('derives the list from the first URL segment', () => {
    expect(backTargetFor('/orders/does-not-exist-xyz')).toEqual({
      label: 'Back to Shipment Orders',
      href: '/orders',
    });
    expect(backTargetFor('/nope/thing')).toBeNull();
    expect(backTargetFor('/orders')).toBeNull();
  });
});

describe('printers popover', () => {
  it('blocks Save until one printer is chosen', () => {
    expect(printerSaveBlocker({ barcodePrinter: ' ', laserPrinter: '' })).toBe(SELECT_PRINTER_REASON);
    expect(printerSaveBlocker({ barcodePrinter: 'Z1', laserPrinter: '' })).toBeNull();
    expect(printerSaveBlocker({ barcodePrinter: 'x'.repeat(121), laserPrinter: '' })).toMatch(/at most/);
  });

  it('offers registered printers plus the current value', () => {
    expect(printerOptions(['A', 'B'], 'C').map((o) => o.value)).toEqual(['A', 'B', 'C']);
    expect(printerOptions(undefined, '').length).toBe(0);
    expect(defaultStationPrinters('MLT1').barcode[0]).toBe('MLT1-ZEBRA-PACK-01');
  });
});

describe('wizard completion from validity', () => {
  const steps = [
    { key: 'a', label: 'A' },
    { key: 'b', label: 'B' },
    { key: 'c', label: 'C', isOptional: true },
  ];

  it('counts required steps only', () => {
    expect(validityPercent(steps, [false, false, true])).toBe(0);
    expect(validityPercent(steps, [true, false, true])).toBe(50);
    expect(validityPercent(steps, [true, true, false])).toBe(100);
  });

  it('checks valid steps in free mode but not unreached ones in linear mode', () => {
    expect(
      stepMetas(steps, initialNavState('free', 3), 'free', [true, true, true]).map((m) => m.status),
    ).toEqual(['active', 'complete', 'complete']);
    expect(
      stepMetas(steps, initialNavState('linear', 3), 'linear', [true, true, true]).map((m) => m.status),
    ).toEqual(['active', 'upcoming', 'upcoming']);
    const reached = moveTo(moveTo(initialNavState('linear', 3), 1), 2);
    expect(
      stepMetas(steps, { ...reached, current: 2 }, 'linear', [true, true, true]).map((m) => m.status),
    ).toEqual(['complete', 'complete', 'active']);
  });
});

describe('export naming', () => {
  it("stamps the file in the requester's time zone", () => {
    const at = new Date('2026-11-06T04:28:00.000Z');
    expect(exportFileName('Shipment Orders', at)).toBe('Shipment Orders 2026-11-06 0428.xlsx');
    expect(exportFileName('Shipment Orders', at, 'America/Chicago')).toBe(
      'Shipment Orders 2026-11-05 2228.xlsx',
    );
    expect(exportFileName('X', at, 'Not/AZone')).toBe('X 2026-11-06 0428.xlsx');
  });

  it('validates the time zone at the boundary', () => {
    expect(isValidTimeZone('Europe/Istanbul')).toBe(true);
    expect(queueExportSchema.safeParse({ gridKey: 'orders-backlog', timeZone: 'Mars/Base' }).success).toBe(
      false,
    );
    expect(queueExportSchema.parse({ gridKey: 'orders-backlog', timeZone: 'UTC' }).timeZone).toBe('UTC');
  });
});

describe('escapeLike', () => {
  it('escapes LIKE wildcards and the escape character', () => {
    expect(escapeLike('50%_off\\')).toBe('50\\%\\_off\\\\');
  });
});
