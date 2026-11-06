/**
 * Template-center filtering (pure). Fuzzy search matches template names, descriptions, tags,
 * item terminology and column titles ("probability", "close date"), ranked by relevance.
 */
import type { GalleryCategory, TemplateGalleryEntry } from '@/server/services/wizards-gallery';

export type GalleryNav = 'recommended' | 'all' | GalleryCategory;

export interface GalleryNavItem {
  readonly id: GalleryNav;
  readonly label: string;
}

export const GALLERY_NAV: readonly GalleryNavItem[] = [
  { id: 'recommended', label: 'Recommended' },
  { id: 'all', label: 'All templates' },
  { id: 'crm', label: 'CRM' },
  { id: 'sales', label: 'Sales' },
  { id: 'marketing', label: 'Marketing' },
  { id: 'customer-success', label: 'Customer success' },
  { id: 'projects', label: 'Projects' },
  { id: 'operations', label: 'Operations' },
  { id: 'hr', label: 'HR' },
  { id: 'blank', label: 'Start from scratch' },
];

export function normalize(value: string): string {
  return value
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9%]+/g, ' ')
    .trim();
}

/** True when every character of `needle` appears in order in `haystack` (subsequence match). */
export function isSubsequence(needle: string, haystack: string): boolean {
  let index = 0;
  for (const char of haystack) {
    if (char === needle[index]) index += 1;
    if (index === needle.length) return true;
  }
  return needle.length === 0;
}

const WEIGHTS = { name: 12, tag: 6, column: 5, terminology: 5, description: 3, board: 4 } as const;

/** Relevance of one query token against an entry (0 = no match). */
function tokenScore(token: string, entry: TemplateGalleryEntry): number {
  const fields: [string, number][] = [
    [normalize(entry.name), WEIGHTS.name],
    [normalize(entry.itemTerminology), WEIGHTS.terminology],
    [normalize(entry.description), WEIGHTS.description],
    ...entry.tags.map((tag): [string, number] => [normalize(tag), WEIGHTS.tag]),
    ...entry.boards.flatMap((board) => [
      [normalize(board.name), WEIGHTS.board] as [string, number],
      ...board.columns.map((column): [string, number] => [normalize(column.title), WEIGHTS.column]),
    ]),
  ];
  let best = 0;
  for (const [field, weight] of fields) {
    if (!field) continue;
    if (field.split(' ').some((word) => word.startsWith(token))) best = Math.max(best, weight * 2);
    else if (field.includes(token)) best = Math.max(best, weight * 1.5);
    else if (token.length >= 4 && isSubsequence(token, field.replace(/ /g, ''))) best = Math.max(best, weight * 0.5);
  }
  return best;
}

/** Score for a whole query: every token must match somewhere. */
export function scoreEntry(query: string, entry: TemplateGalleryEntry): number {
  const tokens = normalize(query).split(' ').filter(Boolean);
  if (tokens.length === 0) return 1;
  let total = 0;
  for (const token of tokens) {
    const score = tokenScore(token, entry);
    if (score === 0) return 0;
    total += score;
  }
  return total;
}

export function inNav(nav: GalleryNav, entry: TemplateGalleryEntry): boolean {
  if (nav === 'all') return true;
  if (nav === 'recommended') return entry.popular || entry.type === 'solution' || entry.id === 'blank';
  return entry.category === nav;
}

/** Entries for the current rail selection and search query, best match first. */
export function filterGallery(
  entries: readonly TemplateGalleryEntry[],
  nav: GalleryNav,
  query: string,
): TemplateGalleryEntry[] {
  const searching = normalize(query).length > 0;
  const scoped = searching ? entries : entries.filter((entry) => inNav(nav, entry));
  if (!searching) return [...scoped];
  return scoped
    .map((entry, index) => ({ entry, index, score: scoreEntry(query, entry) }))
    .filter((row) => row.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((row) => row.entry);
}

/** Count per rail item (search ignored), for the category badges. */
export function navCounts(entries: readonly TemplateGalleryEntry[]): Record<GalleryNav, number> {
  const counts = Object.fromEntries(GALLERY_NAV.map((item) => [item.id, 0])) as Record<GalleryNav, number>;
  for (const item of GALLERY_NAV) counts[item.id] = entries.filter((entry) => inNav(item.id, entry)).length;
  return counts;
}

/** "1 view", "3 views". */
export function countLabel(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** Boards, views and columns summary line for a card ("5 boards · 23 views"). */
export function entrySummary(entry: TemplateGalleryEntry): string {
  const views = entry.boards.reduce((sum, board) => sum + board.views.length, 0);
  const columns = entry.boards.reduce((sum, board) => sum + board.columns.length, 0);
  const parts =
    entry.boards.length > 1
      ? [countLabel(entry.boards.length, 'board'), countLabel(views, 'view')]
      : [countLabel(columns, 'column'), countLabel(views, 'view')];
  return parts.join(' · ');
}

const PREFIX_NAV: readonly (readonly [string, GalleryNav])[] = [
  ['crm', 'crm'],
  ['sales', 'sales'],
  ['mkt', 'marketing'],
  ['marketing', 'marketing'],
  ['cs', 'customer-success'],
  ['proj', 'projects'],
  ['ops', 'operations'],
  ['hr', 'hr'],
  ['solution', 'crm'],
];

/** Category a (possibly removed) template id most likely belonged to, from its id prefix. */
export function navForTemplateId(templateId: string): GalleryNav {
  const head = templateId.toLowerCase().split('-')[0] ?? '';
  return PREFIX_NAV.find(([prefix]) => prefix === head)?.[1] ?? 'recommended';
}
