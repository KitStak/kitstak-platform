/**
 * Header-row detection and per-column type inference from file contents.
 */
import {
  detectDateOrder,
  isBooleanWord,
  parseCurrency,
  parseDate,
  parseEmail,
  parseNumber,
  parsePhone,
  parseUrl,
} from './parse-values';
import type { ColumnProfile, InferredType, MemberRef } from './types';
import { normalizeHeader } from './text';

/** Likelihood (0–1) that a row is a header: mostly non-numeric, distinct, short labels. */
function headerScore(row: readonly string[]): number {
  const cells = row.map((cell) => cell.trim()).filter(Boolean);
  if (cells.length === 0) return 0;
  const textual = cells.filter(
    (cell) => parseNumber(cell) === null && !parseDate(cell) && !parseEmail(cell) && cell.length <= 60,
  ).length;
  const distinct = new Set(cells.map((cell) => cell.toLowerCase())).size;
  return (textual / cells.length) * (distinct / cells.length) * Math.min(1, cells.length / Math.max(1, row.length));
}

/**
 * Index of the header row among the first rows (title rows above a table are skipped), or
 * -1 when the data has no header (generated "Column 1…" names are used).
 */
export function detectHeaderRow(rows: readonly (readonly string[])[]): number {
  const window = rows.slice(0, 10);
  if (window.length === 0) return -1;
  const widest = Math.max(...window.map((row) => row.filter((cell) => cell.trim()).length));
  let best = -1;
  let bestScore = 0;
  window.forEach((row, index) => {
    const filled = row.filter((cell) => cell.trim()).length;
    if (filled < Math.max(1, Math.ceil(widest * 0.6))) return;
    const score = headerScore(row);
    if (score > bestScore + 0.05) {
      best = index;
      bestScore = score;
    }
  });
  if (best < 0 || bestScore < 0.5) return -1;
  // A header must look different from the data below it.
  const next = rows[best + 1];
  if (next && headerScore(next) >= bestScore && rows.length > best + 2) {
    const third = rows[best + 2];
    if (third && headerScore(third) >= bestScore) return best === 0 ? 0 : -1;
  }
  return best;
}

export function buildHeaders(rows: readonly (readonly string[])[], headerRow: number): string[] {
  const width = Math.max(0, ...rows.map((row) => row.length));
  const header = headerRow >= 0 ? (rows[headerRow] ?? []) : [];
  const seen = new Map<string, number>();
  return Array.from({ length: width }, (_, index) => {
    const base = header[index]?.trim().replace(/\s+/g, ' ').slice(0, 120) || `Column ${index + 1}`;
    const count = seen.get(base.toLowerCase()) ?? 0;
    seen.set(base.toLowerCase(), count + 1);
    return count === 0 ? base : `${base} (${count + 1})`;
  });
}

const STATUS_HINT = /\b(status|stage|priority|state|phase|tier|segment|type|category|source|region|industry|rating|health)\b/;
const TAGS_HINT = /\b(tags?|labels?|keywords?|skills?)\b/;
const COUNTRY_HINT = /\b(country|nation)\b/;
const PEOPLE_HINT = /\b(owner|assignee|assigned|rep|manager|person|people|sales ?rep|account ?owner|am|ae|sdr)\b/;

const COUNTRY_CODE = /^[A-Z]{2}$/;

function share(values: readonly string[], test: (value: string) => boolean): number {
  if (values.length === 0) return 0;
  return values.filter(test).length / values.length;
}

export function memberMatcher(members: readonly MemberRef[]): (value: string) => string | null {
  const byKey = new Map<string, string>();
  for (const member of members) {
    byKey.set(member.email.toLowerCase(), member.userId);
    byKey.set(member.name.trim().toLowerCase(), member.userId);
  }
  return (value) => byKey.get(value.trim().toLowerCase()) ?? null;
}

export interface InferOptions {
  readonly members?: readonly MemberRef[];
}

/** Profile one column (values exclude the header row). */
export function profileColumn(
  index: number,
  header: string,
  values: readonly string[],
  options: InferOptions = {},
): ColumnProfile {
  const nonEmptyValues = values.map((value) => value.trim()).filter(Boolean);
  const distinctMap = new Map<string, string>();
  for (const value of nonEmptyValues) {
    const key = value.toLowerCase();
    if (!distinctMap.has(key)) distinctMap.set(key, value);
  }
  const distinct = [...distinctMap.values()];
  const sample = nonEmptyValues.slice(0, 500);
  const dateOrder = detectDateOrder(sample);
  const hint = normalizeHeader(header);
  const base = {
    index,
    header,
    samples: distinct.slice(0, 3),
    nonEmpty: nonEmptyValues.length,
    distinct: distinct.slice(0, 200),
    distinctCount: distinct.length,
    dateOrder,
    currency: null as string | null,
  };
  if (sample.length === 0) return { ...base, inferred: 'text', confidence: 0 };

  const matchMember = options.members?.length ? memberMatcher(options.members) : null;
  const candidates: { type: InferredType; score: number; currency?: string | null }[] = [];
  const push = (type: InferredType, score: number, currency?: string | null) =>
    candidates.push({ type, score, currency });

  push('email', share(sample, (value) => parseEmail(value) !== null));
  push('link', share(sample, (value) => parseUrl(value) !== null));
  if (matchMember) {
    const people = share(sample, (value) => value.split(/[,;]/).every((part) => matchMember(part) !== null));
    // Teammate matches beat plain emails when the header reads like an owner/assignee.
    push('people', PEOPLE_HINT.test(hint) ? people * 1.05 : people * 0.95);
  }
  const currencies = sample.map((value) => parseCurrency(value));
  const withSymbol = currencies.filter((parsed) => parsed?.hadSymbol).length / sample.length;
  if (withSymbol >= 0.5) {
    const codes = currencies.map((parsed) => parsed?.currency).filter(Boolean) as string[];
    const top = mostCommon(codes);
    push('currency', currencies.filter(Boolean).length / sample.length, top);
  }
  const numberShare = share(sample, (value) => parseNumber(value) !== null);
  const looksLikeId = /\b(id|zip|postal|code|phone|tel|mobile|fax|sku)\b/.test(hint);
  push('number', looksLikeId ? numberShare * 0.5 : numberShare * 0.97);
  const dateShare = share(sample, (value) => parseDate(value, dateOrder) !== null && !/^\d+$/.test(value));
  push('date', dateShare);
  const phoneShare = share(sample, (value) => parsePhone(value) !== null && parseDate(value, dateOrder) === null);
  const phoneHint = /\b(phone|tel|mobile|cell|fax|whatsapp)\b/.test(hint);
  push('phone', phoneHint ? phoneShare : numberShare > 0.9 ? phoneShare * 0.5 : phoneShare * 0.9);
  if (distinct.length <= 3 && distinct.every(isBooleanWord)) push('checkbox', 0.99);
  if (COUNTRY_HINT.test(hint)) push('country', Math.max(0.6, share(sample, (value) => COUNTRY_CODE.test(value))));
  if (TAGS_HINT.test(hint)) push('tags', 0.9);

  const avgLength = sample.reduce((sum, value) => sum + value.length, 0) / sample.length;
  const repeats = nonEmptyValues.length / Math.max(1, distinct.length);
  const statusLike =
    distinct.length <= 20 &&
    avgLength <= 32 &&
    (repeats >= 1.5 || (STATUS_HINT.test(hint) && distinct.length <= nonEmptyValues.length));
  if (statusLike) push('status', STATUS_HINT.test(hint) ? 0.95 : distinct.length <= 8 ? 0.85 : 0.75);
  if (avgLength > 120 || sample.some((value) => value.includes('\n'))) push('long_text', 0.8);

  const best = candidates.filter((candidate) => candidate.score >= 0.8).sort((a, b) => b.score - a.score)[0];
  if (!best) return { ...base, inferred: 'text', confidence: 1 };
  return { ...base, inferred: best.type, confidence: Math.min(1, best.score), currency: best.currency ?? null };
}

function mostCommon(values: readonly string[]): string | null {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  let best: string | null = null;
  let max = 0;
  for (const [value, count] of counts) {
    if (count > max) {
      best = value;
      max = count;
    }
  }
  return best;
}

/** Profile every column of a sheet. `dataRows` exclude the header row. */
export function profileColumns(
  headers: readonly string[],
  dataRows: readonly (readonly string[])[],
  options: InferOptions = {},
): ColumnProfile[] {
  return headers.map((header, index) =>
    profileColumn(
      index,
      header,
      dataRows.map((row) => row[index] ?? ''),
      options,
    ),
  );
}
