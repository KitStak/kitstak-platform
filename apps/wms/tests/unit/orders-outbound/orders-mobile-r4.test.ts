/**
 * Round 4 WMS polish: phone-card humanized dates, the channel payment status chip
 * (tone map + column widths) and the spinner-friendly pending treatment helpers.
 */
import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FORMAT_PREFERENCES,
  EMPTY_VALUE,
  createFormatter,
  formatHumanDateTime,
} from '@/lib/format';
import { TONES, isPartialStatus, statusTone } from '@/lib/status-colors';
import { buildOrderColumns, headerFitWidth } from '@/components/orders/orders-columns';

describe('phone card date (format.humanDateTime)', () => {
  const now = new Date(2026, 10, 12, 12, 0, 0); // Nov 12, 2026 local

  it("renders this year's timestamps as 'Nov 12, 3:54 AM'", () => {
    expect(formatHumanDateTime(new Date(2026, 10, 12, 3, 54), DEFAULT_FORMAT_PREFERENCES, now)).toBe(
      'Nov 12, 3:54 AM',
    );
  });

  it('adds the year only when it is not the current year', () => {
    expect(formatHumanDateTime(new Date(2025, 0, 5, 15, 4), DEFAULT_FORMAT_PREFERENCES, now)).toBe(
      'Jan 5, 2025, 3:04 PM',
    );
  });

  it('honors the 24h preference', () => {
    expect(
      formatHumanDateTime(
        new Date(2026, 10, 12, 15, 4),
        { ...DEFAULT_FORMAT_PREFERENCES, timeFormat: '24h' },
        now,
      ),
    ).toBe('Nov 12, 15:04');
  });

  it('renders the shared em dash for empty or invalid values', () => {
    expect(formatHumanDateTime(null)).toBe(EMPTY_VALUE);
    expect(formatHumanDateTime('not a date')).toBe(EMPTY_VALUE);
  });

  it('is exposed on the formatter used by useFormat()', () => {
    const fmt = createFormatter();
    expect(typeof fmt.humanDateTime).toBe('function');
    expect(fmt.humanDateTime(null)).toBe(EMPTY_VALUE);
  });
});

describe('channel payment status chip', () => {
  it('maps paid / unpaid / partial / terminal tones', () => {
    expect(statusTone('paid', 'payment')).toEqual(TONES.green);
    expect(statusTone('UNPAID', 'payment')).toEqual(TONES.red);
    expect(statusTone('partially paid', 'payment')).toEqual(TONES.amber);
    expect(statusTone('partially refunded', 'payment')).toEqual(TONES.amber);
    expect(statusTone('pending', 'payment')).toEqual(TONES.amber);
    expect(statusTone('authorized', 'payment')).toEqual(TONES.blue);
    expect(statusTone('refunded', 'payment')).toEqual(TONES.grey);
    expect(statusTone('voided', 'payment')).toEqual(TONES.grey);
  });

  it('a partially_* channel value, normalized to spaces, draws the half dot', () => {
    expect(isPartialStatus('partially_refunded'.replaceAll('_', ' '))).toBe(true);
  });

  it('narrows the payment column (short "Payment" header, full label kept) and widens Client', () => {
    const cols = buildOrderColumns('backlog');
    const payment = cols.find((c) => c.id === 'channelPaymentStatus');
    const client = cols.find((c) => c.id === 'clientName');
    expect(payment?.header).toBe('Payment');
    expect(payment?.meta?.label).toBe('Channel payment status');
    expect(payment?.meta?.clip).toBe(false);
    expect(payment?.size ?? 0).toBeLessThanOrEqual(140);
    expect(payment?.minSize).toBe(headerFitWidth('Payment'));
    expect(client?.size ?? 0).toBeGreaterThanOrEqual(220);
  });
});
