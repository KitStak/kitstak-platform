/**
 * Client-safe types and pure matching helpers for the command palette (no db imports).
 */
import { hasPermission, type OrgRole, type Permission } from '@/server/rbac/permissions';
import type { BoardKind } from './contracts/dto';

export interface PaletteStatusDto {
  readonly name: string;
  readonly color: string;
}

export interface PaletteItemDto {
  readonly id: string;
  readonly name: string;
  /** Matching cell text when the name itself did not match. */
  readonly snippet: string | null;
  readonly boardId: string;
  readonly boardName: string;
  readonly boardKind: BoardKind;
  readonly itemTerminology: string;
  readonly groupTitle: string;
  readonly groupColor: string;
  readonly status: PaletteStatusDto | null;
}

export interface PaletteBoardDto {
  readonly id: string;
  readonly name: string;
  readonly kind: BoardKind;
  readonly workspaceId: string;
  readonly workspaceName: string;
  readonly folderName: string | null;
}

export interface PaletteDashboardDto {
  readonly id: string;
  readonly name: string;
  readonly workspaceId: string | null;
  readonly workspaceName: string | null;
}

export interface PalettePersonDto {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly image: string | null;
  readonly title: string | null;
  readonly role: string;
}

export interface PaletteWorkspaceDto {
  readonly id: string;
  readonly name: string;
  readonly color: string;
  readonly kind: 'open' | 'closed';
}

export const PALETTE_GROUPS = ['items', 'boards', 'dashboards', 'people', 'workspaces'] as const;
export type PaletteGroup = (typeof PALETTE_GROUPS)[number];

/**
 * Org permission each palette group needs. Boards and items are additionally limited by
 * board visibility (guests only see boards explicitly shared with them).
 */
export const PALETTE_GROUP_PERMISSION: Readonly<Record<PaletteGroup, Permission>> = {
  items: 'item:read',
  boards: 'board:read',
  dashboards: 'dashboard:read',
  people: 'member:read',
  workspaces: 'workspace:read',
};

/** Groups the caller is allowed to search (system contexts see everything). */
export function allowedPaletteGroups(ctx: { readonly roles: readonly OrgRole[]; readonly userId: string | null }): ReadonlySet<PaletteGroup> {
  if (ctx.userId === null) return new Set(PALETTE_GROUPS);
  return new Set(PALETTE_GROUPS.filter((group) => hasPermission(ctx.roles, PALETTE_GROUP_PERMISSION[group])));
}

export interface PaletteSearchDto {
  readonly query: string;
  /** Groups that have more matches than were returned (palette shows "See all"). */
  readonly more?: Readonly<Record<PaletteGroup, boolean>>;
  readonly items: readonly PaletteItemDto[];
  readonly boards: readonly PaletteBoardDto[];
  readonly dashboards: readonly PaletteDashboardDto[];
  readonly people: readonly PalettePersonDto[];
  readonly workspaces: readonly PaletteWorkspaceDto[];
}

/** Lowercased word tokens of a query. */
export function queryTokens(query: string): string[] {
  return query
    .normalize('NFKC')
    .toLowerCase()
    .split(/[^\p{L}\p{N}@.]+/u)
    .filter((token) => token.length > 0)
    .slice(0, 8);
}

/** Strict: every query token appears as a substring of the text (case-insensitive). */
export function matchesStrictly(query: string, text: string): boolean {
  const tokens = queryTokens(query);
  if (tokens.length === 0) return false;
  const haystack = text.normalize('NFKC').toLowerCase();
  return tokens.every((token) => haystack.includes(token));
}

/** 3 exact, 2 prefix, 1 word-prefix, 0 substring. */
export function matchScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  const t = text.toLowerCase();
  if (!q) return 0;
  if (t === q) return 3;
  if (t.startsWith(q)) return 2;
  if (t.split(/\s+/).some((word) => word.startsWith(q))) return 1;
  return 0;
}

/** Stable sort: best match first, then shorter names, then alphabetical. */
export function rankByMatch<T>(query: string, rows: readonly T[], name: (row: T) => string): T[] {
  return rows
    .map((row, index) => ({ row, index, score: matchScore(query, name(row)), length: name(row).length }))
    .sort((a, b) => b.score - a.score || a.length - b.length || a.index - b.index)
    .map((entry) => entry.row);
}

export interface HighlightPart {
  readonly text: string;
  readonly match: boolean;
}

/** Split `text` into parts, marking every occurrence of any query token. */
export function highlightParts(text: string, query: string): HighlightPart[] {
  const tokens = queryTokens(query).sort((a, b) => b.length - a.length);
  if (tokens.length === 0 || !text) return [{ text, match: false }];
  const lower = text.toLowerCase();
  const marks = new Array<boolean>(text.length).fill(false);
  for (const token of tokens) {
    let from = 0;
    for (;;) {
      const index = lower.indexOf(token, from);
      if (index < 0) break;
      for (let i = index; i < index + token.length; i += 1) marks[i] = true;
      from = index + token.length;
    }
  }
  const parts: HighlightPart[] = [];
  let start = 0;
  for (let i = 1; i <= text.length; i += 1) {
    if (i === text.length || marks[i] !== marks[start]) {
      parts.push({ text: text.slice(start, i), match: marks[start] ?? false });
      start = i;
    }
  }
  return parts;
}

/**
 * While a newer query is still loading, the palette may only show rows of the previous result
 * that also match the current query; anything else would be a stale, wrong target for Enter.
 */
export function filterToQuery(query: string, data: PaletteSearchDto): PaletteSearchDto {
  const hit = (...texts: (string | null | undefined)[]) =>
    matchesStrictly(query, texts.filter((text): text is string => Boolean(text)).join(' '));
  return {
    ...data,
    query,
    items: data.items.filter((item) => hit(item.name, item.snippet)),
    boards: data.boards.filter((board) => hit(board.name)),
    dashboards: data.dashboards.filter((dashboard) => hit(dashboard.name)),
    people: data.people.filter((person) => hit(person.name, person.email, person.title)),
    workspaces: data.workspaces.filter((workspace) => hit(workspace.name)),
  };
}

/** Row value to open on Enter: the selected row if it is still listed, else the first row. */
export function pickEnterTarget(selected: string, values: readonly string[]): string | null {
  if (values.includes(selected)) return selected;
  return values[0] ?? null;
}

/** Best match score of one group's names (-1 when the group is empty). */
function bestScore(query: string, names: readonly string[]): number {
  return names.reduce((best, name) => Math.max(best, matchScore(query, name)), -1);
}

/**
 * Order of the record groups in the palette: groups whose best name match is stronger come
 * first (exact > prefix > word-prefix > substring), so the board "Deals" outranks items that
 * merely contain "deal". Ties keep the default order (items, boards, dashboards, people,
 * workspaces). Empty groups are dropped.
 */
export function orderPaletteGroups(query: string, data: PaletteSearchDto): PaletteGroup[] {
  const names: Record<PaletteGroup, readonly string[]> = {
    items: data.items.map((item) => item.name),
    boards: data.boards.map((board) => board.name),
    dashboards: data.dashboards.map((dashboard) => dashboard.name),
    people: data.people.map((person) => person.name),
    workspaces: data.workspaces.map((workspace) => workspace.name),
  };
  return PALETTE_GROUPS.map((group, index) => ({ group, index, score: bestScore(query, names[group]) }))
    .filter((entry) => entry.score >= 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((entry) => entry.group);
}
