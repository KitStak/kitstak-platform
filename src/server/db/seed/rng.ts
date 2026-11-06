/** Deterministic pseudo-random helpers for the seed (mulberry32). */

export interface Rng {
  /** Float in [0, 1). */
  next(): number;
  int(min: number, max: number): number;
  pick<T>(list: readonly T[]): T;
  pickWeighted<T>(entries: ReadonlyArray<readonly [T, number]>): T;
  chance(probability: number): boolean;
  sample<T>(list: readonly T[], count: number): T[];
  uuid(): string;
}

export function createRng(seed: number): Rng {
  let state = seed >>> 0;
  const next = (): number => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4_294_967_296;
  };
  const int = (min: number, max: number): number => Math.floor(next() * (max - min + 1)) + min;
  const pick = <T>(list: readonly T[]): T => {
    if (list.length === 0) throw new Error('pick() from an empty list');
    return list[Math.floor(next() * list.length)] as T;
  };
  return {
    next,
    int,
    pick,
    pickWeighted<T>(entries: ReadonlyArray<readonly [T, number]>): T {
      const total = entries.reduce((sum, [, weight]) => sum + weight, 0);
      let roll = next() * total;
      for (const [value, weight] of entries) {
        roll -= weight;
        if (roll <= 0) return value;
      }
      return (entries.at(-1) as readonly [T, number])[0];
    },
    chance: (probability: number) => next() < probability,
    sample<T>(list: readonly T[], count: number): T[] {
      const copy = [...list];
      for (let index = copy.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(next() * (index + 1));
        [copy[index], copy[swap]] = [copy[swap] as T, copy[index] as T];
      }
      return copy.slice(0, Math.max(0, Math.min(count, copy.length)));
    },
    uuid(): string {
      const hex = Array.from({ length: 32 }, () => Math.floor(next() * 16).toString(16));
      hex[12] = '4';
      hex[16] = ((Math.floor(next() * 4) + 8) as number).toString(16);
      const s = hex.join('');
      return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`;
    },
  };
}

const DAY_MS = 86_400_000;

/** ISO date (`YYYY-MM-DD`) `days` from `anchor` (UTC). */
export function isoDay(anchor: Date, days: number): string {
  return new Date(anchor.getTime() + days * DAY_MS).toISOString().slice(0, 10);
}

/** Timestamp `days` (fractional allowed) before `anchor`. */
export function daysAgo(anchor: Date, days: number): Date {
  return new Date(anchor.getTime() - days * DAY_MS);
}

/** Start of the UTC day for `date`. */
export function startOfDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

/** Last day (ISO) of the calendar quarter containing `date`, offset by `quarters`. */
export function quarterEnd(date: Date, quarters = 0): string {
  const quarter = Math.floor(date.getUTCMonth() / 3) + quarters;
  const year = date.getUTCFullYear() + Math.floor(quarter / 4);
  const month = (((quarter % 4) + 4) % 4) * 3 + 3;
  return new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
}
