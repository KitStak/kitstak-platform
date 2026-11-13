/**
 * Sibling-app deep links on integration links are stored as a path ("/receiving/<id>",
 * "/northwind-robotics/boards/<board>?item=<id>") and turned into an absolute href when they are
 * read, from the current NEXT_PUBLIC_CRM_URL / NEXT_PUBLIC_WMS_URL. A domain change, a preview
 * deploy or a sibling app on another dev port never leaves a stale host behind. Older rows that
 * still hold an absolute URL are rebased the same way.
 */
import 'server-only';
import { appUrls } from '@/server/env';
import { linkPathOf, siblingAppOf } from '@/lib/link-path';

export { linkPathOf };

/** Absolute href for a stored link path (or legacy absolute URL), using today's app origins. */
export function linkHref(targetType: string, stored: string | null | undefined): string | null {
  if (!stored) return null;
  const app = siblingAppOf(targetType);
  if (!app) return stored;
  const path = linkPathOf(stored);
  if (!path) return null;
  return `${appUrls()[app]}${path}`;
}
