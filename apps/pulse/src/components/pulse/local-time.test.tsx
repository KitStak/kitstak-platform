/**
 * The first paint of a moment in time must not depend on the machine's time zone or clock:
 * the server and the browser have to print the same text, or React logs a hydration error.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { LocalTime, RelativeTime, formatMoment } from './local-time';

const ISO = '2026-11-15T03:30:00.000Z';

describe('formatMoment', () => {
  it('prints the same UTC text on every machine when not local', () => {
    expect(formatMoment(ISO, 'day', false)).toBe('Nov 15, 2026');
    expect(formatMoment(ISO, 'dayTime', false)).toBe('Nov 15, 2026, 3:30 AM');
    expect(formatMoment(null, 'day', false)).toBe('');
    expect(formatMoment('not a date', 'day', false)).toBe('');
  });
});

describe('first paint', () => {
  afterEach(() => vi.useRealTimers());

  it('RelativeTime shows the day, whatever the clock says, so server and browser agree', () => {
    const texts = ['2026-11-15T04:00:00Z', '2026-11-19T23:59:00Z', '2027-03-01T12:00:00Z'].map((now) => {
      vi.useFakeTimers({ now: new Date(now) });
      return renderToStaticMarkup(<RelativeTime iso={ISO} />);
    });
    expect(new Set(texts).size).toBe(1);
    expect(texts[0]).toContain('>Nov 15, 2026<');
    expect(texts[0]).toContain(`dateTime="${ISO}"`);
    expect(texts[0]).not.toMatch(/ago|yesterday|just now/);
  });

  it('LocalTime shows UTC until the page is live', () => {
    expect(renderToStaticMarkup(<LocalTime iso={ISO} />)).toContain('>Nov 15, 2026, 3:30 AM<');
    expect(renderToStaticMarkup(<LocalTime iso={ISO} style="day" />)).toContain('>Nov 15, 2026<');
    expect(renderToStaticMarkup(<LocalTime iso={null} />)).toBe('');
  });
});
