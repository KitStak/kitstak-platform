/** Helpers shared by the tools: output shaping, redaction and local row filtering. */
import { z } from 'zod';
import { MAX_PAGE_SIZE } from './config.js';
import { isRecord } from './client.js';

export const READ_ONLY = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: true,
};

export function json(value: unknown) {
  return { content: [{ type: 'text' as const, text: JSON.stringify(redact(value), null, 2) }] };
}

export function fail(message: string) {
  return { content: [{ type: 'text' as const, text: message }], isError: true };
}

const SECRET_KEY = /pass(word)?|pwd|secret|token|api_?key|credential/i;

/** Replaces any secret-looking field with "[redacted]", at any depth. */
export function redact(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redact);
  if (!isRecord(value)) return value;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) out[k] = SECRET_KEY.test(k) ? '[redacted]' : redact(v);
  return out;
}

/** Drops null, empty-string and empty-array fields so rows stay readable. */
export function compact(row: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row)) {
    if (v == null || v === '' || (Array.isArray(v) && v.length === 0)) continue;
    out[k] = Array.isArray(v) ? v.map((x) => (isRecord(x) ? compact(x) : x)) : isRecord(v) ? compact(v) : v;
  }
  return out;
}

/** Keeps only `keys` (when present), plus anything `extra` adds. */
export function pick(row: Record<string, unknown>, keys: readonly string[]): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const k of keys) {
    const v = field(row, k);
    if (v != null && v !== '') out[k] = v;
  }
  return out;
}

/** Case-insensitive top-level field lookup. */
export function field(row: Record<string, unknown>, key: string): unknown {
  if (key in row) return row[key];
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(row)) if (k.toLowerCase() === lower) return v;
  return undefined;
}

export function firstField(row: Record<string, unknown>, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = field(row, k);
    if (v != null && v !== '') return v;
  }
  return undefined;
}

/** "Ready To Ship", "ReadyToShip" and "ready_to_ship" all normalize to "readytoship". */
export function norm(v: unknown): string {
  return String(v ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '');
}

export const GUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const pageArg = z
  .number()
  .int()
  .min(1)
  .max(10_000)
  .optional()
  .describe('1-based page number (default 1).');
export const pageSizeArg = z
  .number()
  .int()
  .min(1)
  .max(MAX_PAGE_SIZE)
  .optional()
  .describe(`Rows per page (default 50, max ${MAX_PAGE_SIZE}).`);
export const dateArg = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
  .optional();
export const fullArg = z
  .boolean()
  .optional()
  .describe('Return every field Logiwa sends instead of the short summary (default false).');
