/** Inbox tabs, shared by the server page (reads `?filter=`) and the client view. */
export const INBOX_FILTERS = ['all', 'unread', 'mentions', 'assigned', 'comments', 'due', 'archived'] as const;

export type InboxFilter = (typeof INBOX_FILTERS)[number];

/** Reads `?filter=`; unknown values fall back to All. */
export function parseInboxFilter(value: string | string[] | undefined): InboxFilter {
  const raw = Array.isArray(value) ? value[0] : value;
  return (INBOX_FILTERS as readonly string[]).includes(raw ?? '') ? (raw as InboxFilter) : 'all';
}
