/** Query string readers for /api/v1 routes. Bad values become a VALIDATION error, never a 500. */
import 'server-only';
import { DomainError } from '@/server/errors';

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const bad = (name: string, what: string): DomainError => new DomainError('VALIDATION', `The "${name}" filter must be ${what}.`, { [name]: `Must be ${what}.` });

/** A trimmed string, or null when missing or empty. */
export function str(sp: URLSearchParams, name: string): string | null {
  const value = sp.get(name)?.trim();
  return value ? value : null;
}

export function dateParam(sp: URLSearchParams, name: string): string | null {
  const value = str(sp, name);
  if (value === null) return null;
  if (!DATE_RE.test(value) || Number.isNaN(Date.parse(`${value}T00:00:00Z`))) throw bad(name, 'a date like 2026-11-17');
  return value;
}

export function uuidParam(sp: URLSearchParams, name: string): string | null {
  const value = str(sp, name);
  if (value === null) return null;
  if (!UUID_RE.test(value)) throw bad(name, 'a valid id');
  return value;
}

export function intParam(sp: URLSearchParams, name: string, fallback: number, max: number): number {
  const value = str(sp, name);
  if (value === null) return fallback;
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) throw bad(name, 'a whole number');
  return Math.min(n, max);
}

/** One of `allowed`, or null when missing. */
export function oneOf<T extends string>(sp: URLSearchParams, name: string, allowed: readonly T[]): T | null {
  const value = str(sp, name);
  if (value === null) return null;
  if (!(allowed as readonly string[]).includes(value)) throw bad(name, `one of: ${allowed.join(', ')}`);
  return value as T;
}

/** A comma list where every part is one of `allowed`. */
export function listOf<T extends string>(sp: URLSearchParams, name: string, allowed: readonly T[]): T[] {
  const value = str(sp, name);
  if (value === null) return [];
  const parts = value.split(',').map((part) => part.trim()).filter(Boolean);
  for (const part of parts) if (!(allowed as readonly string[]).includes(part)) throw bad(name, `a comma list of: ${allowed.join(', ')}`);
  return parts as T[];
}

export function flag(sp: URLSearchParams, name: string): boolean {
  const value = sp.get(name);
  return value === '1' || value === 'true';
}

/** `from` and `to`, defaulting to the first day of this month through today (UTC). */
export function rangeParams(sp: URLSearchParams): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const from = dateParam(sp, 'from') ?? `${today.slice(0, 7)}-01`;
  const to = dateParam(sp, 'to') ?? today;
  if (to < from) throw new DomainError('VALIDATION', 'The end day is before the start day.', { to: 'Must be on or after the start day.' });
  return { from, to };
}
