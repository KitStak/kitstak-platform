/** Client-safe home page DTOs and pure helpers (no db imports). */
import type { BoardKind } from './contracts/dto';

export interface HomeGroupSummary {
  readonly title: string;
  readonly color: string;
  readonly count: number;
}

export interface HomeRecentDto {
  readonly entityType: 'board' | 'dashboard';
  readonly id: string;
  readonly name: string;
  readonly workspaceName: string | null;
  readonly visitedAt: string;
  readonly boardKind: BoardKind | null;
  readonly itemTerminology: string | null;
  /** Items on a board, widgets on a dashboard. */
  readonly count: number;
  readonly groups: readonly HomeGroupSummary[];
}

export interface HomeWorkItemDto {
  readonly id: string;
  readonly name: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly boardKind: BoardKind;
  readonly groupTitle: string;
  readonly groupColor: string;
  readonly dueDate: string;
  readonly overdue: boolean;
  readonly status: { readonly name: string; readonly color: string } | null;
}

export interface HomeUpdateDto {
  readonly id: string;
  readonly excerpt: string;
  readonly createdAt: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly boardId: string;
  readonly boardName: string;
  readonly author: { readonly id: string; readonly name: string; readonly image: string | null } | null;
}

export interface HomeDto {
  readonly recents: readonly HomeRecentDto[];
  readonly work: readonly HomeWorkItemDto[];
  readonly updates: readonly HomeUpdateDto[];
}

export interface WorkCandidate extends Omit<HomeWorkItemDto, 'overdue'> {
  readonly done: boolean;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Open (not done) work due on or before `weekEnd`, overdue first, then by due date and name.
 * Items without a valid date are dropped; overdue = due before `today`.
 */
export function pickDueWork(
  candidates: readonly WorkCandidate[],
  today: string,
  weekEnd: string,
  limit: number,
): HomeWorkItemDto[] {
  const seen = new Set<string>();
  return candidates
    .filter((candidate) => {
      if (candidate.done || !ISO_DATE.test(candidate.dueDate) || candidate.dueDate > weekEnd) return false;
      if (seen.has(candidate.id)) return false;
      seen.add(candidate.id);
      return true;
    })
    .map(
      (entry): HomeWorkItemDto => ({
        id: entry.id,
        name: entry.name,
        boardId: entry.boardId,
        boardName: entry.boardName,
        boardKind: entry.boardKind,
        groupTitle: entry.groupTitle,
        groupColor: entry.groupColor,
        dueDate: entry.dueDate,
        status: entry.status,
        overdue: entry.dueDate < today,
      }),
    )
    .sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.name.localeCompare(b.name))
    .slice(0, limit);
}

export const OVERDUE_WINDOW_DAYS = 30;

/** Local YYYY-MM-DD for today, the coming Sunday (end of week) and the overdue horizon. */
export function weekWindow(now: Date): {
  readonly today: string;
  readonly weekEnd: string;
  readonly overdueFrom: string;
} {
  const pad = (value: number) => String(value).padStart(2, '0');
  const iso = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + ((7 - now.getDay()) % 7));
  const from = new Date(now.getFullYear(), now.getMonth(), now.getDate() - OVERDUE_WINDOW_DAYS);
  return { today: iso(now), weekEnd: iso(end), overdueFrom: iso(from) };
}

/** True for date columns that express a deadline (Due, Close date, Follow-up…), not history. */
export function isDeadlineColumnTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (/(last|created|contacted|start|joined|birth|signed)/.test(t)) return false;
  return /(due|deadline|close|follow|end|target|renewal|expir|launch|go.?live|when|date)/.test(t);
}

interface StatusColumnLike {
  readonly title: string;
  readonly labels: readonly { readonly isDone?: boolean }[];
}

/**
 * Index of the column that best represents an item's progress: one with a "done" label, then
 * one titled status/stage, then the first. -1 when there are none.
 */
export function pickStatusColumn(columns: readonly StatusColumnLike[]): number {
  if (columns.length === 0) return -1;
  const done = columns.findIndex((column) => column.labels.some((label) => label.isDone));
  if (done >= 0) return done;
  const named = columns.findIndex((column) => /status|stage/i.test(column.title));
  return named >= 0 ? named : 0;
}

/** Terminal label names that mean "no longer due" even without an isDone flag. */
export function isClosedLabelName(name: string | undefined): boolean {
  return Boolean(name && /^(done|completed?|cancel+ed|won|lost|closed|archived|skipped)\b/i.test(name.trim()));
}
