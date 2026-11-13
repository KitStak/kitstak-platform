/** CRM display formatting (pure, locale-aware via Intl). */

export function formatMoney(value: number, currency = 'USD', options: { compact?: boolean } = {}): string {
  const compact = options.compact ?? Math.abs(value) >= 100_000;
  return new Intl.NumberFormat('en-US', {
    style: 'currency',
    currency,
    notation: compact ? 'compact' : 'standard',
    minimumFractionDigits: 0,
    maximumFractionDigits: compact ? 1 : 0,
  }).format(value);
}

export function formatExactMoney(value: number, currency = 'USD'): string {
  return new Intl.NumberFormat('en-US', { style: 'currency', currency, maximumFractionDigits: 0 }).format(value);
}

export function formatPercent(ratio: number | null | undefined, digits = 0): string {
  if (ratio === null || ratio === undefined || !Number.isFinite(ratio)) return 'None';
  return `${(ratio * 100).toFixed(digits)}%`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "2026-11" → "Nov 2026" ("Nov" when `short`), "overdue" → "Overdue". */
export function formatMonth(month: string, short = false): string {
  if (month === 'overdue') return 'Overdue';
  const [year, index] = month.split('-');
  const name = MONTHS[Number(index) - 1] ?? month;
  return short ? name : `${name} ${year}`;
}

/** "2026-11-05" → "Nov 5, 2026" (year omitted when it matches `today`). */
export function formatDay(isoDate: string | null | undefined, today = new Date()): string {
  if (!isoDate) return 'None';
  const [year, month, day] = isoDate.slice(0, 10).split('-').map(Number);
  if (!year || !month || !day) return isoDate;
  const name = MONTHS[month - 1] ?? '';
  return year === today.getUTCFullYear() ? `${name} ${day}` : `${name} ${day}, ${year}`;
}

/** Whole days from `isoDate` to today (negative = in the future). */
export function daysFrom(isoDate: string, today = new Date()): number {
  const start = Date.parse(isoDate.length === 10 ? `${isoDate}T00:00:00Z` : isoDate);
  const end = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
  return Math.floor((end - start) / 86_400_000);
}

export function relativeDay(isoDate: string | null | undefined, today = new Date()): string {
  if (!isoDate) return 'None';
  const days = daysFrom(isoDate, today);
  if (days === 0) return 'Today';
  if (days === 1) return 'Yesterday';
  if (days === -1) return 'Tomorrow';
  if (days > 1 && days < 30) return `${days} days ago`;
  if (days < -1 && days > -30) return `In ${-days} days`;
  return formatDay(isoDate, today);
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count.toLocaleString('en-US')} ${count === 1 ? singular : pluralForm}`;
}

/** Lowercase noun form of a board's item terminology ("Deal" → "deal", "deals"). */
export function noun(term: string, count = 1): string {
  const lower = term.toLowerCase();
  if (count === 1) return lower;
  if (/(s|x|ch|sh)$/.test(lower)) return `${lower}es`;
  if (/[^aeiou]y$/.test(lower)) return `${lower.slice(0, -1)}ies`;
  return `${lower}s`;
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0]?.[0] ?? '';
  const last = parts.length > 1 ? (parts[parts.length - 1]?.[0] ?? '') : (parts[0]?.[1] ?? '');
  return `${first}${last}`.toUpperCase() || '?';
}

export function todayIso(now = new Date()): string {
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 10);
}
