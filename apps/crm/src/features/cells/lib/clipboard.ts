/**
 * Cell copy / paste (Ctrl/Cmd+C, Ctrl/Cmd+V on a focused cell).
 *
 * Copy writes human-readable text (status by label name, people by name, dates as ISO) so it
 * pastes cleanly into spreadsheets, and remembers the raw value so a paste back into a column of
 * the same type round-trips exactly (files, connected items, teams…). Paste from other sources is
 * parsed per column type and always validated with the column's write schema.
 */
import { cellValueSchemaFor, type ColumnType } from '@/server/db/schema/cell-values';
import type { ColumnDto, UserSummaryDto } from '@/server/services/contracts/dto';
import { COUNTRIES, countryByCode } from './countries';
import { parseDateInput } from './date-parse';
import { normalizeUrl, isValidEmail, parseNumberInput, toIsoDate } from './format';
import { findLabel, labelsFromSettings } from './labels';
import {
  readCountry,
  readCurrency,
  readDate,
  readEmail,
  readLink,
  readLocation,
  readNumber,
  readPeople,
  readPhone,
  readTags,
  readText,
  readTimeline,
} from './values';
import type { CellCommitValue } from '../types';

export interface ClipboardContext {
  readonly users: readonly UserSummaryDto[];
  readonly now: Date;
}

/** Last value copied from a cell: lets a same-type paste round-trip values text cannot carry. */
interface CopiedCell {
  readonly type: ColumnType;
  readonly text: string;
  readonly value: unknown;
}

let lastCopied: CopiedCell | null = null;

export function rememberCopiedCell(entry: CopiedCell): void {
  lastCopied = entry;
}

/** Plain-text form of a cell value. */
export function cellToText(column: Pick<ColumnDto, 'type' | 'settings'>, value: unknown, ctx: ClipboardContext): string {
  switch (column.type) {
    case 'status': {
      const id = (value as { labelId?: unknown } | null)?.labelId;
      return findLabel(labelsFromSettings(column.settings), id)?.name ?? '';
    }
    case 'dropdown': {
      const labels = labelsFromSettings(column.settings);
      const ids = (value as { labelIds?: unknown } | null)?.labelIds;
      return Array.isArray(ids) ? ids.map((id) => findLabel(labels, id)?.name).filter(Boolean).join(', ') : '';
    }
    case 'people': {
      const byId = new Map(ctx.users.map((user) => [user.id, user.name]));
      return readPeople(value).ids.map((id) => byId.get(id)).filter(Boolean).join(', ');
    }
    case 'date': {
      const date = readDate(value);
      return date ? `${date.date}${date.time ? ` ${date.time}` : ''}` : '';
    }
    case 'timeline': {
      const range = readTimeline(value);
      return range ? `${range.from} – ${range.to}` : '';
    }
    case 'number':
    case 'rating': {
      const number = readNumber(value);
      return number === null ? '' : String(number);
    }
    case 'currency': {
      const amount = readCurrency(value);
      return amount ? `${amount.amount} ${amount.currency}` : '';
    }
    case 'checkbox':
      return value === true ? 'true' : 'false';
    case 'email':
      return readEmail(value)?.email ?? '';
    case 'phone':
      return readPhone(value)?.phone ?? '';
    case 'link':
      return readLink(value)?.url ?? '';
    case 'tags':
      return readTags(value).join(', ');
    case 'location':
      return readLocation(value)?.address ?? '';
    case 'country':
      return countryByCode(readCountry(value))?.name ?? '';
    default:
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') return String(value);
      return readText(value);
  }
}

function splitList(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

/** Parse pasted text for a column. `undefined` means it can't be pasted there. */
export function textToCell(
  column: Pick<ColumnDto, 'type' | 'settings'>,
  text: string,
  ctx: ClipboardContext,
): CellCommitValue | undefined {
  if (lastCopied && lastCopied.type === column.type && lastCopied.text === text) {
    return validate(column.type, lastCopied.value ?? null);
  }
  const raw = text.trim();
  if (!raw) return column.type === 'name' ? undefined : column.type === 'checkbox' ? false : null;
  return validate(column.type, parseText(column, raw, ctx));
}

function parseText(column: Pick<ColumnDto, 'type' | 'settings'>, raw: string, ctx: ClipboardContext): unknown {
  const lower = raw.toLowerCase();
  switch (column.type) {
    case 'name':
    case 'text':
    case 'long_text':
      return column.type === 'long_text' ? raw : raw.replace(/\s*\n\s*/g, ' ');
    case 'status': {
      const label = labelsFromSettings(column.settings).find((entry) => entry.name.trim().toLowerCase() === lower);
      return label ? { labelId: label.id } : undefined;
    }
    case 'dropdown': {
      const labels = labelsFromSettings(column.settings);
      const ids = splitList(raw).map((name) => labels.find((entry) => entry.name.trim().toLowerCase() === name.toLowerCase())?.id);
      return ids.length && ids.every(Boolean) ? { labelIds: [...new Set(ids as string[])] } : undefined;
    }
    case 'people': {
      const ids = splitList(raw).map(
        (name) => ctx.users.find((user) => user.name.toLowerCase() === name.toLowerCase() || user.email?.toLowerCase() === name.toLowerCase())?.id,
      );
      return ids.length && ids.every(Boolean) ? { ids: [...new Set(ids as string[])] } : undefined;
    }
    case 'number': {
      const parsed = parseNumberInput(raw);
      return parsed.ok ? parsed.value : undefined;
    }
    case 'rating': {
      const parsed = Number.parseInt(raw, 10);
      const max = (column.settings as { max?: number } | null)?.max ?? 5;
      return Number.isInteger(parsed) && parsed >= 0 && parsed <= max ? parsed : undefined;
    }
    case 'currency': {
      const parsed = parseNumberInput(raw.replace(/\s*[A-Z]{3}$/, ''));
      const code = /([A-Z]{3})$/.exec(raw)?.[1] ?? (column.settings as { currency?: string } | null)?.currency ?? 'USD';
      return parsed.ok && parsed.value !== null ? { amount: parsed.value, currency: code } : undefined;
    }
    case 'checkbox':
      if (['true', 'yes', 'y', '1', 'x', '✓', 'checked', 'done'].includes(lower)) return true;
      if (['false', 'no', 'n', '0', 'unchecked'].includes(lower)) return false;
      return undefined;
    case 'date': {
      const iso = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{2}:\d{2}))?/.exec(raw);
      if (iso?.[1]) return iso[2] ? { date: iso[1], time: iso[2] } : { date: iso[1] };
      const date = parseDateInput(raw, ctx.now);
      return date ? { date: toIsoDate(date) } : undefined;
    }
    case 'timeline': {
      const match = /^(\d{4}-\d{2}-\d{2})\s*(?:–|-|to)\s*(\d{4}-\d{2}-\d{2})$/.exec(raw);
      return match?.[1] && match[2] ? { from: match[1] <= match[2] ? match[1] : match[2], to: match[1] <= match[2] ? match[2] : match[1] } : undefined;
    }
    case 'email':
      return isValidEmail(raw) ? { email: raw } : undefined;
    case 'link': {
      const url = normalizeUrl(raw);
      return url ? { url } : undefined;
    }
    case 'phone':
      return /^[+\d][\d\s().-]{5,}$/.test(raw) ? { phone: raw.replace(/[^\d+]/g, '') } : undefined;
    case 'tags':
      return { tags: [...new Set(splitList(raw).map((tag) => tag.replace(/^#/, '')))] };
    case 'location':
      return { address: raw };
    case 'country': {
      const country = COUNTRIES.find((entry) => entry.code.toLowerCase() === lower || entry.name.toLowerCase() === lower);
      return country ? { code: country.code } : undefined;
    }
    default:
      return undefined;
  }
}

function validate(type: ColumnType, value: unknown): CellCommitValue | undefined {
  if (value === undefined) return undefined;
  const result = cellValueSchemaFor(type).safeParse(value);
  return result.success ? (result.data as CellCommitValue) : undefined;
}
