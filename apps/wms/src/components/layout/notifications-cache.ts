/** Pure optimistic-update helpers for the notifications cache (bell + /notifications). */
import type { ApiQueryData } from '@/lib/query-client';
import type { NotificationView } from './notification-item';

export interface MarkReadInput {
  readonly ids?: readonly string[];
  readonly all?: true;
}

/** New cache entry with the targeted rows read and `meta.unread` lowered to match. */
export function markReadInCache(
  entry: ApiQueryData<readonly NotificationView[]> | undefined,
  input: MarkReadInput,
  nowIso: string,
): ApiQueryData<readonly NotificationView[]> | undefined {
  if (!entry || !Array.isArray(entry.data)) return entry;
  const targets = input.all ? null : new Set(input.ids ?? []);
  let changed = 0;
  const data = entry.data.map((n) => {
    if (n.readAt || (targets && !targets.has(n.id))) return n;
    changed += 1;
    return { ...n, readAt: nowIso };
  });
  if (!entry.meta) return { ...entry, data };
  const unread = typeof entry.meta.unread === 'number' ? entry.meta.unread : null;
  const nextUnread = unread === null ? undefined : input.all ? 0 : Math.max(0, unread - changed);
  return {
    ...entry,
    data,
    meta: nextUnread === undefined ? entry.meta : { ...entry.meta, unread: nextUnread },
  };
}
