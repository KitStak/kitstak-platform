/**
 * Pure mapping from a stored/computed cell value to something renderable. Used by the read-only
 * board overview; the editable board table owns its own cell components.
 */
import type { ColumnDto, ItemDto, UserSummaryDto } from '@/server/services/contracts/dto';

export type CellDisplay =
  | { readonly kind: 'empty' }
  | { readonly kind: 'text'; readonly text: string; readonly align?: 'start' | 'end' }
  | { readonly kind: 'label'; readonly label: string; readonly color: string }
  | { readonly kind: 'labels'; readonly labels: readonly { label: string; color: string }[] }
  | { readonly kind: 'people'; readonly people: readonly UserSummaryDto[] }
  | { readonly kind: 'check'; readonly checked: boolean };

interface LabelSetting {
  readonly id: string;
  readonly name: string;
  readonly color: string;
}

const EMPTY: CellDisplay = { kind: 'empty' };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function labelsOf(column: ColumnDto): readonly LabelSetting[] {
  const settings: unknown = column.settings;
  if (!isRecord(settings) || !Array.isArray(settings.labels)) return [];
  return settings.labels.filter(
    (label): label is LabelSetting =>
      isRecord(label) &&
      typeof label.id === 'string' &&
      typeof label.name === 'string' &&
      typeof label.color === 'string',
  );
}

function stringArray(value: unknown): readonly string[] {
  return Array.isArray(value) ? value.filter((entry): entry is string => typeof entry === 'string') : [];
}

const DATE_FORMAT: Intl.DateTimeFormatOptions = {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
  timeZone: 'UTC',
};

export function formatIsoDate(value: unknown): string | null {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(value)) return null;
  const time = Date.parse(value.length === 10 ? `${value}T00:00:00Z` : value);
  return Number.isNaN(time) ? null : new Date(time).toLocaleDateString('en-US', DATE_FORMAT);
}

export function formatNumber(value: number, currency?: string): string {
  if (currency) {
    try {
      return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(
        value,
      );
    } catch {
      return `${value.toLocaleString('en-US')} ${currency}`;
    }
  }
  return value.toLocaleString('en-US', { maximumFractionDigits: 2 });
}

function displayLabel(column: ColumnDto, labelId: unknown): CellDisplay {
  const label = labelsOf(column).find((entry) => entry.id === labelId);
  return label ? { kind: 'label', label: label.name, color: label.color } : EMPTY;
}

/** Computed columns arrive as scalars or wrapped: `{ result }` (formula/mirror), `{ value }`, `{ at }` (logs). */
function displayComputed(value: unknown): CellDisplay {
  if (typeof value === 'number') return { kind: 'text', text: formatNumber(value), align: 'end' };
  if (typeof value === 'string' && value) return { kind: 'text', text: formatIsoDate(value) ?? value };
  if (!isRecord(value)) return EMPTY;
  if ('result' in value) return displayComputed(value.result);
  if ('value' in value) return displayComputed(value.value);
  if (typeof value.at === 'string') return displayComputed(value.at);
  return EMPTY;
}

function displayStored(
  column: ColumnDto,
  value: unknown,
  users: ReadonlyMap<string, UserSummaryDto>,
): CellDisplay {
  switch (column.type) {
    case 'status':
      return isRecord(value) ? displayLabel(column, value.labelId) : EMPTY;
    case 'dropdown': {
      if (!isRecord(value)) return EMPTY;
      const labels = labelsOf(column);
      const picked = stringArray(value.labelIds)
        .map((id) => labels.find((label) => label.id === id))
        .filter((label): label is LabelSetting => Boolean(label))
        .map((label) => ({ label: label.name, color: label.color }));
      return picked.length ? { kind: 'labels', labels: picked } : EMPTY;
    }
    case 'people': {
      if (!isRecord(value)) return EMPTY;
      const people = stringArray(value.ids)
        .map((id) => users.get(id))
        .filter((user): user is UserSummaryDto => Boolean(user));
      return people.length ? { kind: 'people', people } : EMPTY;
    }
    case 'date':
      return isRecord(value) && formatIsoDate(value.date)
        ? { kind: 'text', text: formatIsoDate(value.date) ?? '' }
        : EMPTY;
    case 'timeline': {
      if (!isRecord(value)) return EMPTY;
      const from = formatIsoDate(value.from);
      const to = formatIsoDate(value.to);
      return from && to ? { kind: 'text', text: `${from} – ${to}` } : EMPTY;
    }
    case 'number':
    case 'rating':
      return typeof value === 'number' ? { kind: 'text', text: formatNumber(value), align: 'end' } : EMPTY;
    case 'currency':
      return isRecord(value) && typeof value.amount === 'number'
        ? {
            kind: 'text',
            text: formatNumber(value.amount, typeof value.currency === 'string' ? value.currency : 'USD'),
            align: 'end',
          }
        : EMPTY;
    case 'checkbox':
      return { kind: 'check', checked: value === true };
    case 'tags':
      return isRecord(value) && stringArray(value.tags).length
        ? {
            kind: 'text',
            text: stringArray(value.tags)
              .map((tag) => `#${tag}`)
              .join(' '),
          }
        : EMPTY;
    case 'email':
      return isRecord(value) && typeof value.email === 'string' ? { kind: 'text', text: value.email } : EMPTY;
    case 'phone':
      return isRecord(value) && typeof value.phone === 'string' ? { kind: 'text', text: value.phone } : EMPTY;
    case 'link':
      return isRecord(value) && typeof value.url === 'string'
        ? { kind: 'text', text: typeof value.text === 'string' && value.text ? value.text : value.url }
        : EMPTY;
    case 'location':
      return isRecord(value) && typeof value.address === 'string'
        ? { kind: 'text', text: value.address }
        : EMPTY;
    case 'connect_boards': {
      const count = isRecord(value) ? stringArray(value.itemIds).length : 0;
      return count ? { kind: 'text', text: `${count} linked` } : EMPTY;
    }
    case 'files': {
      const count = isRecord(value) ? stringArray(value.fileIds).length : 0;
      return count ? { kind: 'text', text: `${count} file${count === 1 ? '' : 's'}` } : EMPTY;
    }
    default:
      return typeof value === 'string' && value ? { kind: 'text', text: value } : EMPTY;
  }
}

export function cellDisplay(
  column: ColumnDto,
  item: ItemDto,
  users: ReadonlyMap<string, UserSummaryDto>,
): CellDisplay {
  if (column.key in item.computed) return displayComputed(item.computed[column.key]);
  const stored: unknown = item.values[column.key];
  if (stored === undefined || stored === null)
    return column.type === 'checkbox' ? { kind: 'check', checked: false } : EMPTY;
  return displayStored(column, stored, users);
}
