/** Destination defaults (board name, record type) and validation. Pure and client-safe. */
import type { BoardKind } from '@/server/services/contracts/dto';
import { normalizeHeader } from './text';

export type NewDestination = {
  readonly type: 'new';
  readonly workspaceId: string | null;
  readonly name: string;
  readonly kind: BoardKind;
  /** The user edited the name or type, so file-based defaults no longer apply. */
  readonly touched: boolean;
};

export type ExistingDestination = {
  readonly type: 'existing';
  readonly boardId: string | null;
  /** `null` = first group; `'__new__'` = create `newGroupTitle`. */
  readonly groupId: string | null;
  readonly newGroupTitle: string;
};

export type Destination = NewDestination | ExistingDestination;

/** "import contacts" → "Import contacts" (sentence case; words the user capitalized are kept). */
export function boardNameFromFile(stem: string): string {
  const clean = stem.replace(/\s+/g, ' ').trim();
  if (!clean) return 'Imported data';
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

const KIND_SIGNALS: readonly [BoardKind, RegExp, number][] = [
  ['deals', /\b(amount|deal|deal value|deal stage|stage|close date|expected close|probability|pipeline|opportunity|revenue|arr)\b/, 2],
  ['leads', /\b(lead|lead source|lead status|source|campaign|mql|sql)\b/, 2],
  ['accounts', /\b(company|account|industry|employees|domain|website|annual revenue|headcount)\b/, 1],
  ['contacts', /\b(email|e mail|phone|mobile|first name|last name|full name|job title|title|linkedin)\b/, 1],
];

/** Best-guess record type from the file headers (falls back to "Something else"). */
export function guessBoardKind(headers: readonly string[]): BoardKind {
  const scores = new Map<BoardKind, number>();
  for (const header of headers) {
    const normalized = normalizeHeader(header);
    for (const [kind, pattern, weight] of KIND_SIGNALS) {
      if (pattern.test(normalized)) scores.set(kind, (scores.get(kind) ?? 0) + weight);
    }
  }
  // Explicit file names win ties: "leads.csv" style stems are handled by the caller.
  const ranked = [...scores.entries()].sort((a, b) => b[1] - a[1]);
  const best = ranked[0];
  if (!best || best[1] < 2) return 'custom';
  return best[0];
}

/** Record type implied by a file name ("Q3 deals.xlsx" → deals), if any. */
export function kindFromFileName(name: string): BoardKind | null {
  const normalized = normalizeHeader(name);
  if (/\b(deals?|opportunit(y|ies)|pipeline)\b/.test(normalized)) return 'deals';
  if (/\bleads?\b/.test(normalized)) return 'leads';
  if (/\b(accounts?|compan(y|ies)|organi[sz]ations?)\b/.test(normalized)) return 'accounts';
  if (/\b(contacts?|people|customers?)\b/.test(normalized)) return 'contacts';
  return null;
}

export function emptyNewDestination(): NewDestination {
  return { type: 'new', workspaceId: null, name: '', kind: 'custom', touched: false };
}

export function emptyExistingDestination(boardId: string | null = null): ExistingDestination {
  return { type: 'existing', boardId, groupId: null, newGroupTitle: '' };
}

/** File-based defaults for an untouched new-board draft. */
export function withFileDefaults(destination: NewDestination, fileStem: string, headers: readonly string[]): NewDestination {
  if (destination.touched) return destination;
  return {
    ...destination,
    name: boardNameFromFile(fileStem),
    kind: kindFromFileName(fileStem) ?? guessBoardKind(headers),
  };
}

/** Fill the workspace from the first available one (derived at render time, never raced). */
export function resolveDestination(destination: Destination, defaultWorkspaceId: string | null): Destination {
  if (destination.type !== 'new' || destination.workspaceId) return destination;
  return { ...destination, workspaceId: defaultWorkspaceId };
}

export const DESTINATION_ERRORS = {
  name: 'Give the new board a name.',
  workspace: 'Choose a workspace for the new board.',
  board: 'Choose the board to import into.',
  group: 'Name the new group.',
} as const;

export function destinationError(destination: Destination): string | null {
  if (destination.type === 'new') {
    if (!destination.name.trim()) return DESTINATION_ERRORS.name;
    if (!destination.workspaceId) return DESTINATION_ERRORS.workspace;
    return null;
  }
  if (!destination.boardId) return DESTINATION_ERRORS.board;
  if (destination.groupId === '__new__' && !destination.newGroupTitle.trim()) return DESTINATION_ERRORS.group;
  return null;
}
