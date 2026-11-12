import { afterEach, describe, expect, it } from 'vitest';
import {
  ANCHOR_MS,
  clockMs,
  dateOf,
  installRuntime,
  isRuntimeInstalled,
  isWeekend,
  seededUuid,
  setClock,
  uninstallRuntime,
  utcAt,
  weekdayOf,
} from '@/server/db/seed/runtime';
import { mulberry32 } from '@/server/db/seed-data';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

afterEach(() => uninstallRuntime());

describe('seed runtime', () => {
  it('freezes new Date() and Date.now() at the virtual clock and ticks 1 ms per read', () => {
    installRuntime(1, Date.UTC(2026, 9, 1, 12));
    const a = new Date();
    const b = Date.now();
    expect(a.toISOString()).toBe('2026-10-01T12:00:00.001Z');
    expect(b).toBe(Date.UTC(2026, 9, 1, 12) + 2);
    setClock(Date.UTC(2026, 9, 2));
    expect(new Date().toISOString()).toBe('2026-10-02T00:00:00.001Z');
    expect(clockMs()).toBe(Date.UTC(2026, 9, 2) + 1);
  });

  it('keeps explicit Date construction real and instanceof working', () => {
    installRuntime(1, 0);
    const d = new Date('2026-11-05T16:00:00.000Z');
    expect(d.getTime()).toBe(ANCHOR_MS);
    expect(d).toBeInstanceOf(Date);
    expect(new Date(2026, 0, 1).getFullYear()).toBe(2026);
  });

  it('returns deterministic v4-shaped UUIDs and restores the real ones on uninstall', () => {
    installRuntime(42, 0);
    const first = [crypto.randomUUID(), crypto.randomUUID()];
    uninstallRuntime();
    installRuntime(42, 0);
    expect([crypto.randomUUID(), crypto.randomUUID()]).toEqual(first);
    expect(first[0]).toMatch(UUID_V4);
    uninstallRuntime();
    expect(isRuntimeInstalled()).toBe(false);
    expect(crypto.randomUUID()).not.toBe(first[0]);
    expect(Date.now()).toBeGreaterThan(ANCHOR_MS - 400 * 86_400_000);
  });

  it('refuses to install twice and setClock without install', () => {
    expect(() => setClock(0)).toThrow(/not installed/);
    installRuntime(1, 0);
    expect(() => installRuntime(1, 0)).toThrow(/already installed/);
  });

  it('formats seeded UUIDs from any generator', () => {
    expect(seededUuid(mulberry32(7))).toMatch(UUID_V4);
  });

  it('computes anchor-relative times', () => {
    expect(utcAt(0, 16)).toBe(ANCHOR_MS);
    expect(dateOf(utcAt(5, 3))).toBe('2026-10-31');
    expect(weekdayOf(ANCHOR_MS)).toBe(4);
    expect(isWeekend(utcAt(5, 12))).toBe(true);
    expect(isWeekend(ANCHOR_MS)).toBe(false);
  });
});
