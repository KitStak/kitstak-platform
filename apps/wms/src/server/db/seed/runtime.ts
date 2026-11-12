/**
 * Seed runtime: a virtual clock and deterministic UUIDs.
 *
 * The domain engines stamp rows with `new Date()` and give them ids from
 * `crypto.randomUUID()`. While the runtime is installed, both are virtual:
 * - `new Date()` / `Date.now()` return the replay time set with `setClock()`. Each read
 *   advances it by 1 ms, so rows written inside one event keep a stable order.
 * - `crypto.randomUUID()` returns UUIDs from a seeded generator.
 * As a result `db:reset` produces the same history, the same ids and the same screenshots
 * every time.
 *
 * Only the seed process (and the seed unit test, which uninstalls it again) installs this.
 */
import { mulberry32 } from "../seed-data";

/** "Now" for the seeded tenant: 2026-11-05 16:00 UTC (11:00 in Louisville). */
export const ANCHOR_MS = Date.UTC(2026, 10, 5, 16, 0, 0);
export const DAY_MS = 86_400_000;
export const HOUR_MS = 3_600_000;
export const MINUTE_MS = 60_000;

type UuidString = `${string}-${string}-${string}-${string}-${string}`;

const RealDate = globalThis.Date;

interface RuntimeState {
  baseMs: number;
  tick: number;
  readonly uuid: () => number;
  readonly originalRandomUuid: PropertyDescriptor | undefined;
}

let state: RuntimeState | null = null;

function virtualNow(): number {
  if (!state) return RealDate.now();
  state.tick += 1;
  return state.baseMs + state.tick;
}

class VirtualDate extends RealDate {
  constructor(...args: unknown[]) {
    if (args.length === 0) {
      super(virtualNow());
    } else {
      super(...(args as ConstructorParameters<DateConstructor>));
    }
  }

  static override now(): number {
    return virtualNow();
  }
}

function hex(n: number, width: number): string {
  return Math.floor(n).toString(16).padStart(width, "0").slice(-width);
}

/** RFC 4122 v4-shaped UUID from a seeded PRNG. */
export function seededUuid(next: () => number): UuidString {
  const words = Array.from({ length: 4 }, () => next() * 0x1_0000_0000);
  const h = words.map((w) => hex(w, 8)).join("");
  const variant = ((Number.parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-4${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

export function isRuntimeInstalled(): boolean {
  return state !== null;
}

/** Installs the virtual clock and seeded UUIDs. Throws when already installed. */
export function installRuntime(seed: number, startMs: number): void {
  if (state) throw new Error("Seed runtime is already installed");
  const cryptoObj = globalThis.crypto;
  const uuid = mulberry32(seed ^ 0x5eed);
  state = { baseMs: startMs, tick: 0, uuid, originalRandomUuid: Object.getOwnPropertyDescriptor(cryptoObj, "randomUUID") };
  globalThis.Date = VirtualDate as DateConstructor;
  Object.defineProperty(cryptoObj, "randomUUID", { value: () => seededUuid(uuid), configurable: true, writable: true });
}

/** Restores the real `Date` and `crypto.randomUUID`. Safe to call when not installed. */
export function uninstallRuntime(): void {
  if (!state) return;
  const cryptoObj = globalThis.crypto;
  if (state.originalRandomUuid) Object.defineProperty(cryptoObj, "randomUUID", state.originalRandomUuid);
  else Reflect.deleteProperty(cryptoObj, "randomUUID");
  globalThis.Date = RealDate;
  state = null;
}

/** Moves the virtual clock to `ms` (it may move backwards between independent events). */
export function setClock(ms: number): void {
  if (!state) throw new Error("Seed runtime is not installed");
  state.baseMs = ms;
  state.tick = 0;
}

/** Current virtual time without advancing it. */
export function clockMs(): number {
  if (!state) return RealDate.now();
  return state.baseMs + state.tick;
}

/* ------------------------------------------------------------ time helpers */

/** Epoch ms of `daysAgo` days before the anchor day, at `hour:minute` UTC. */
export function utcAt(daysAgo: number, hour: number, minute = 0): number {
  const anchor = new RealDate(ANCHOR_MS);
  return RealDate.UTC(anchor.getUTCFullYear(), anchor.getUTCMonth(), anchor.getUTCDate() - daysAgo, hour, minute, 0);
}

export const isoOf = (ms: number): string => new RealDate(ms).toISOString();

/** YYYY-MM-DD (UTC) of an instant. */
export const dateOf = (ms: number): string => isoOf(ms).slice(0, 10);

/** 0 = Sunday ... 6 = Saturday (UTC). */
export const weekdayOf = (ms: number): number => new RealDate(ms).getUTCDay();

export const isWeekend = (ms: number): boolean => {
  const d = weekdayOf(ms);
  return d === 0 || d === 6;
};
