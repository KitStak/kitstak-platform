import { describe, expect, it } from 'vitest';
import { clockLabel, isQuietNow, quietOf, quietSentence } from './quiet-hours';

const at = (iso: string) => new Date(iso);

describe('quiet hours', () => {
  it('reads a stored window and ignores a broken one', () => {
    expect(quietOf({ quiet: { from: '18:00', to: '06:00' } })).toEqual({ from: '18:00', to: '06:00', weekends: false });
    expect(quietOf({ quiet: { from: '25:00', to: '06:00' } })).toBeNull();
    expect(quietOf({ clientId: 'x' })).toBeNull();
    expect(quietOf({ quiet: { weekends: true } })).toEqual({ from: '00:00', to: '00:00', weekends: true });
  });

  it('handles a window that crosses midnight', () => {
    const quiet = { from: '18:00', to: '06:00' };
    expect(isQuietNow(quiet, 'UTC', at('2026-11-18T19:30:00Z'))).toBe(true);
    expect(isQuietNow(quiet, 'UTC', at('2026-11-18T05:59:00Z'))).toBe(true);
    expect(isQuietNow(quiet, 'UTC', at('2026-11-18T06:00:00Z'))).toBe(false);
    expect(isQuietNow(quiet, 'UTC', at('2026-11-18T12:00:00Z'))).toBe(false);
  });

  it('handles a same day window and the workspace time zone', () => {
    const quiet = { from: '12:00', to: '13:00' };
    expect(isQuietNow(quiet, 'UTC', at('2026-11-18T12:30:00Z'))).toBe(true);
    // 12:30 UTC is 7:30 in New York.
    expect(isQuietNow(quiet, 'America/New_York', at('2026-11-18T12:30:00Z'))).toBe(false);
    expect(isQuietNow(quiet, 'America/New_York', at('2026-11-18T17:30:00Z'))).toBe(true);
    expect(isQuietNow(quiet, 'Not/AZone', at('2026-11-18T12:30:00Z'))).toBe(true);
  });

  it('can be quiet all weekend', () => {
    const quiet = { from: '18:00', to: '06:00', weekends: true };
    expect(isQuietNow(quiet, 'UTC', at('2026-11-21T12:00:00Z'))).toBe(true);
    expect(isQuietNow(quiet, 'UTC', at('2026-11-23T12:00:00Z'))).toBe(false);
    expect(isQuietNow(null, 'UTC')).toBe(false);
  });

  it('says it in words', () => {
    expect(clockLabel('18:00')).toBe('6:00 PM');
    expect(clockLabel('00:30')).toBe('12:30 AM');
    expect(quietSentence({ from: '18:00', to: '06:00', weekends: true })).toBe('Quiet from 6:00 PM to 6:00 AM, and on weekends');
    expect(quietSentence(null)).toBe('No quiet hours');
  });
});
