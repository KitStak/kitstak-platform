/**
 * Client-safe contracts for the My work aggregation and the Inbox update feed
 * (module: inbox-mywork). Pure types + Zod schemas only: no server imports.
 */
import { z } from 'zod';
import type { BoardKind, UpdateDto } from './dto';

// ---------------------------------------------------------------------------------------------
// My work
// ---------------------------------------------------------------------------------------------

export interface MyWorkLabelDto {
  readonly id: string;
  readonly name: string;
  /** Token palette name (see LABEL_COLORS). */
  readonly color: string;
  readonly isDone: boolean;
  /** Terminal outcome: done, or a closed state such as Lost / Cancelled / Closed. */
  readonly isClosed: boolean;
}

export interface MyWorkBoardDto {
  readonly id: string;
  readonly name: string;
  readonly kind: BoardKind;
  readonly itemTerminology: string;
  /** Caller can write cells on this board (false for view-only board members). */
  readonly canEdit: boolean;
  /** Reference-record board (contacts, accounts): shown under "Other assigned items". */
  readonly recordList: boolean;
  /** Progress status column for the inline pill; null when no column tracks progress. */
  readonly status: {
    readonly key: string;
    readonly title: string;
    readonly labels: readonly MyWorkLabelDto[];
  } | null;
  /** Due-like date column used for grouping and the inline date editor. */
  readonly date: { readonly key: string; readonly title: string } | null;
}

export interface MyWorkItemDto {
  readonly id: string;
  readonly name: string;
  readonly boardId: string;
  readonly groupId: string;
  readonly groupTitle: string;
  readonly groupColor: string;
  readonly statusLabelId: string | null;
  /** `YYYY-MM-DD` from the board's date column, or null. */
  readonly date: string | null;
  /** Optional `HH:MM` stored with the date; preserved when the date is edited inline. */
  readonly time?: string | null;
  readonly updatedAt: string;
}

export interface MyWorkDto {
  readonly boards: readonly MyWorkBoardDto[];
  readonly items: readonly MyWorkItemDto[];
  /** True when more assigned items exist than the response cap. */
  readonly truncated: boolean;
}

export const MY_WORK_MAX_ITEMS = 1000;

export const myWorkQuerySchema = z.object({
  boardId: z.uuid().optional(),
});
export type MyWorkQuery = z.infer<typeof myWorkQuerySchema>;

// ---------------------------------------------------------------------------------------------
// Inbox feed
// ---------------------------------------------------------------------------------------------

export const INBOX_FILTERS = ['all', 'mentions', 'unread'] as const;
export type InboxFilter = (typeof INBOX_FILTERS)[number];

export const inboxQuerySchema = z.object({
  cursor: z.string().max(512).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  filter: z.enum(INBOX_FILTERS).default('all'),
  boardId: z.uuid().optional(),
});
export type InboxQuery = z.infer<typeof inboxQuerySchema>;

export interface InboxThreadDto {
  /** The top-level update with its replies (oldest first). */
  readonly update: UpdateDto;
  readonly boardId: string;
  readonly boardName: string;
  readonly itemId: string;
  readonly itemName: string;
  readonly groupTitle: string | null;
  /** Latest post in the thread (thread or reply), ISO. */
  readonly lastActivityAt: string;
  /** Thread or a reply is unread by the caller (authored by someone else). */
  readonly unread: boolean;
  /** Caller is mentioned in the thread or a reply. */
  readonly mentionsMe: boolean;
}

export interface InboxBoardOptionDto {
  readonly id: string;
  readonly name: string;
}

export const inboxReadSchema = z.object({
  updateIds: z.array(z.uuid()).min(1).max(200),
  read: z.boolean().default(true),
});
export type InboxReadInput = z.infer<typeof inboxReadSchema>;
